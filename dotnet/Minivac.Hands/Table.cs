using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Minivac.Core;

namespace Minivac.Hands;

// The C# port of `src/hands/table.ts`: the hands tool table's replay, batch and state logic over
// one live machine. Like the TypeScript it takes an already-loaded netlist and profile and never
// touches a filesystem, a process or a clock.
//
// Arguments stay JavaScript values. The TypeScript handlers read `args.n`, `args.ms` and the rest
// as whatever JSON.parse made of the request, and the machine's `Number.isInteger` checks decide
// what is refused, so the port keeps the parsed JSON (`JsonElement`, absent = undefined) and
// applies the same checks before it builds a typed `Minivac.Core` command. Every refusal reason and
// detail string is the TypeScript's, byte for byte: Node renders them into the text the model sees.

/// <summary>Thrown for a session that cannot be replayed (table.ts:157 `SessionError`).</summary>
public sealed class SessionError : Exception
{
    public SessionError(string message) : base(message) { }
}

/// <summary>The table's plain `new Error('hands: ...')` faults (table.ts:769, 907).</summary>
public sealed class HandsError : Exception
{
    public HandsError(string message) : base(message) { }
}

/// <summary>One accepted step of the session script (table.ts:49 `SessionStep`).</summary>
public abstract class SessionStep
{
    private protected SessionStep(string discriminator) => k = discriminator;

    public string k { get; }

    /// <summary>
    /// A contract command. A step the table applied carries the typed command it built; a step
    /// replayed from a session carries the command exactly as the session spelled it (`raw`), since
    /// replay logs the parsed object itself (table.ts:977 via 394) and the export re-prints it.
    /// </summary>
    public sealed class Do : SessionStep
    {
        public Do(Command cmd) : base("do") => this.cmd = cmd;

        public Do(JsonElement raw) : base("do") => this.raw = raw;

        public Command? cmd { get; }
        public JsonElement? raw { get; }
    }

    public sealed class Advance : SessionStep
    {
        public Advance(int ms) : base("advance") => this.ms = ms;
        public int ms { get; }
    }

    public sealed class Settle : SessionStep
    {
        public Settle(int maxMs) : base("settle") => this.maxMs = maxMs;
        public int maxMs { get; }
    }

    public sealed class Load : SessionStep
    {
        public Load(string program, int cords) : base("load")
        {
            this.program = program;
            this.cords = cords;
        }

        public string program { get; }
        public int cords { get; }
    }
}

/// <summary>A `minivac.session/1` session (table.ts:55).</summary>
public sealed record Session(
    string schema,
    string profile,
    string contract,
    string netlistHash,
    string profileHash,
    IReadOnlyList<SessionStep> script);

/// <summary>A plugged cord as the table projects it (table.ts:65). `b` is null for a free end.</summary>
public sealed record CordView(int id, string a, string? b, string wire);

/// <summary>One call: `{ name, args }` as JSON.parse made it.</summary>
public sealed class ToolCall
{
    public ToolCall(JsonElement? raw) => Raw = raw;

    public JsonElement? Raw { get; }

    public static ToolCall Of(string name, string argsJson) =>
        new(Js.Parse("{\"name\":" + Js.Quote(name) + ",\"args\":" + argsJson + "}"));
}

/// <summary>table.ts:102 `ToolResult`.</summary>
public abstract class ToolResult
{
    private protected ToolResult(bool result) => ok = result;

    public bool ok { get; }

    public sealed class Ok : ToolResult
    {
        public Ok(CordView? cord = null, IReadOnlyList<CordView>? cords = null, StateView? view = null) : base(true)
        {
            this.cord = cord;
            this.cords = cords;
            this.view = view;
        }

        public CordView? cord { get; }
        public IReadOnlyList<CordView>? cords { get; }
        public StateView? view { get; }
    }

    public sealed class Fail : ToolResult
    {
        public Fail(string why, string detail) : base(false)
        {
            this.why = why;
            this.detail = detail;
        }

        public string why { get; }
        public string detail { get; }
    }
}

public sealed record ObservableView(string name, string value);

/// <summary>table.ts:106 `StateView`.</summary>
public sealed record StateView(int tick, IReadOnlyList<ObservableView> observables, IReadOnlyList<CordView> cords, State snapshot);

/// <summary>table.ts:208 `SettleOutcome`.</summary>
public sealed record SettleOutcome(
    bool settled,
    int waitedTicks,
    IReadOnlyList<string> moving,
    IReadOnlyList<string> chattering,
    int dialMrpm,
    bool dialHeld,
    IReadOnlyList<string> lampsMoving);

/// <summary>table.ts:776 `Change`.</summary>
public sealed record Change(string name, IReadOnlyList<string> values, int transitions, bool elided);

/// <summary>table.ts:787 `BatchOutcome`.</summary>
public abstract class BatchOutcome
{
    private protected BatchOutcome(bool result) => ok = result;

    public bool ok { get; }

    public sealed class Accepted : BatchOutcome
    {
        public Accepted(IReadOnlyList<ToolResult> results, SettleOutcome settle, IReadOnlyList<Change> changes) : base(true)
        {
            this.results = results;
            this.settle = settle;
            this.changes = changes;
        }

        public IReadOnlyList<ToolResult> results { get; }
        public SettleOutcome settle { get; }
        public IReadOnlyList<Change> changes { get; }
    }
}

/// <summary>table.ts:797: `failedAt === calls.length` means the settle step was refused.</summary>
public sealed class BatchRejection : BatchOutcome
{
    public BatchRejection(int failedAt, ToolResult.Fail result) : base(false)
    {
        this.failedAt = failedAt;
        this.result = result;
    }

    public int failedAt { get; }
    public ToolResult.Fail result { get; }
}

/// <summary>First values of an observable's change path, its latest value, and how many transitions.</summary>
public sealed class Watch
{
    public Watch(int first)
    {
        head.Add(first);
        last = first;
    }

    public List<int> head { get; } = [];
    public int last { get; set; }
    public int count { get; set; }
}

/// <summary>
/// A live machine plus the bookkeeping the table needs (table.ts:75). Mutable; owned by one
/// caller. The constructor shares the lists it is given, as `{ ...rig, machine }` does in the
/// TypeScript tests that wrap a rig's machine.
/// </summary>
public sealed class Rig
{
    public Rig(Machine machine, LoadedNetlist netlist, Profile profile, int[] previous, CordView?[] cords, List<SessionStep> log)
    {
        this.machine = machine;
        this.netlist = netlist;
        this.profile = profile;
        this.previous = previous;
        this.cords = cords;
        this.log = log;
    }

    public Machine machine { get; }
    public LoadedNetlist netlist { get; }
    public Profile profile { get; }
    public int[] previous { get; }
    public CordView?[] cords { get; }
    public List<SessionStep> log { get; }
    public Watch[]? watch { get; set; }
}

public static class Table
{
    public const string SESSION_SCHEMA = "minivac.session/1";
    public const string DEFAULT_PROFILE = "MV601-REF-A"; // src/session.ts DEFAULT_PROFILE_ID
    public const int DEFAULT_SETTLE_MS = 500;
    public const int MAX_STEP_MS = 60000;
    public const int PRESS_MS = 100;
    private const int INT32_MAX = int.MaxValue;
    public const int PATH_LIMIT = 6;
    private const int MAX_CORDS = 256;
    public const int DIAL_UDEG_LIMIT = 360_000_000;
    private const int SECTIONS = 6;
    private const string FREE = "free";

    // table.ts:39. JavaScript's `$` (no m flag) matches only at the very end; .NET's `$` also
    // matches before a final "\n", so the port anchors with `\z`.
    public static readonly Regex PROGRAM_ID = new(@"^[A-Z0-9]+(?:-[A-Z0-9]+)*\z", RegexOptions.CultureInvariant);

    private static readonly int FIRST_LAMP = FindObservable("outLamp1");

    private static readonly string[] ChatterNames =
    [
        "relay1", "relay2", "relay3", "relay4", "relay5", "relay6",
        "pb1", "pb2", "pb3", "pb4", "pb5", "pb6",
        "sw1", "sw2", "sw3", "sw4", "sw5", "sw6",
        "dial",
    ];

    private static int FindObservable(string name)
    {
        for (var i = 0; i < Trace.OBSERVABLE_COUNT; i++)
        {
            if (string.Equals(Trace.OBSERVABLES[i].name, name, StringComparison.Ordinal)) return i;
        }
        return -1;
    }

    private static string I(long value) => value.ToString(CultureInfo.InvariantCulture);

    /// <summary>A chatter device's contract name (the enum's declared names are the contract's).</summary>
    public static string ChatterName(ChatterDev dev) => ChatterNames[(int)dev];

    // -----------------------------------------------------------------------------------------
    // Rig, ticks and settle

    public static Rig createRig(LoadedNetlist netlist, Profile profile)
    {
        if (profile.v.tick_us != 100) throw new SessionError("profile " + profile.id + " needs tick_us=100");
        var machine = Machine.CreateMachine(netlist, profile);
        var previous = (int[])machine.Observables().Clone();
        return new Rig(machine, netlist, profile, previous, new CordView?[MAX_CORDS], []);
    }

    private static void NoteObservables(Watch[] watch, int[] current)
    {
        for (var i = 0; i < Trace.OBSERVABLE_COUNT; i++)
        {
            var seen = watch[i];
            var value = current[i];
            if (seen.last == value) continue;
            seen.last = value;
            seen.count++;
            if (seen.head.Count <= PATH_LIMIT) seen.head.Add(value);
        }
    }

    /// <summary>One tick, the runner's `advanceOne` (table.ts:195).</summary>
    private static bool AdvanceOne(Rig rig)
    {
        rig.machine.Advance(1);
        rig.machine.DrainEvents();
        var after = rig.machine.Observables();
        var changed = false;
        for (var i = 0; i < Trace.OBSERVABLE_COUNT; i++)
        {
            if (rig.previous[i] != after[i]) changed = true;
        }
        Array.Copy(after, rig.previous, Trace.OBSERVABLE_COUNT);
        if (rig.watch is not null) NoteObservables(rig.watch, after);
        return changed;
    }

    private static int[] LampMilli(Rig rig)
    {
        var state = rig.machine.Snapshot();
        var milli = new int[state.outLamps.Length + state.indLamps.Length];
        for (var i = 0; i < state.outLamps.Length; i++) milli[i] = state.outLamps[i].milli;
        for (var i = 0; i < state.indLamps.Length; i++) milli[state.outLamps.Length + i] = state.indLamps[i].milli;
        return milli;
    }

    private static List<string> MovingLamps(int[]? before, Rig rig)
    {
        var output = new List<string>();
        if (before is null) return output;
        var after = LampMilli(rig);
        for (var i = 0; i < after.Length; i++)
        {
            if (after[i] != before[i]) output.Add(Trace.OBSERVABLES[FIRST_LAMP + i].name);
        }
        return output;
    }

    /// <summary>Run and log one settle step capped at `maxMs` (table.ts:246). Callers validate it.</summary>
    private static SettleOutcome Settle(Rig rig, int maxMs)
    {
        var maxTicks = maxMs * 10;
        var quietNeeded = rig.profile.v.settle_quiet_ticks;
        long quiet = 0;
        var waited = 0;
        int[]? lampsBefore = null;
        while (waited < maxTicks && quiet < quietNeeded)
        {
            // Only a tick that can end the settle needs the pre-tick lamp reading.
            lampsBefore = quiet + 1 >= quietNeeded || waited + 1 == maxTicks ? LampMilli(rig) : null;
            var changed = AdvanceOne(rig);
            waited++;
            if (!changed && rig.machine.MotionMask() == 0) quiet++;
            else quiet = 0;
        }
        rig.log.Add(new SessionStep.Settle(maxMs));
        var settled = quiet >= quietNeeded;
        var state = rig.machine.Snapshot();
        var mask = rig.machine.MotionMask();
        var moving = new List<string>();
        var chattering = new List<string>();
        if (!settled)
        {
            for (var bit = 0; bit < Trace.CHATTER_DEVICES.Count; bit++)
            {
                if ((mask & (1 << bit)) != 0) moving.Add(ChatterName(Trace.CHATTER_DEVICES[bit]));
            }
            foreach (var dev in state.flags.chattering) chattering.Add(ChatterName(dev));
        }
        return new SettleOutcome(settled, waited, moving, chattering, state.dial.mrpm, state.dial.held, MovingLamps(lampsBefore, rig));
    }

    /// <summary>Run and log one advance step of exactly `ms` (table.ts:276). Callers validate it.</summary>
    private static void AdvanceMs(Rig rig, int ms)
    {
        for (var i = 0; i < ms * 10; i++) AdvanceOne(rig);
        rig.log.Add(new SessionStep.Advance(ms));
    }

    private static string? CheckMs(JsonElement? ms, string what)
    {
        if (!Js.IsInteger(ms) || Js.Num(ms!.Value) < 1 || Js.Num(ms.Value) > MAX_STEP_MS)
            return what + " must be an integer number of milliseconds in 1.." + I(MAX_STEP_MS);
        return null;
    }

    private static string TickLimit(int tick) =>
        "the session is at tick " + I(tick) + "; this would pass the int32 tick limit " + I(INT32_MAX) +
        "; start a new session";

    /// <summary>table.ts:294: null when `ms` is valid and within the int32 tick limit, else why.</summary>
    private static string? CheckStep(Rig rig, JsonElement? ms, string what)
    {
        var bad = CheckMs(ms, what);
        if (bad is not null) return bad;
        var tick = rig.machine.Snapshot().tick;
        return tick > INT32_MAX - (long)Js.Num(ms!.Value) * 10 ? TickLimit(tick) : null;
    }

    // -----------------------------------------------------------------------------------------
    // Cords: lowest free hole, lowest unused id, terminal-pair lookup

    private static List<CordView> LiveCords(Rig rig)
    {
        var live = new List<CordView>();
        foreach (var cord in rig.cords)
        {
            if (cord is not null) live.Add(cord);
        }
        return live;
    }

    private static string? LowestFreeHole(Rig rig, string? terminal, IReadOnlyList<string> taken)
    {
        // table.ts:309 indexes TERMINALS by terminalIndex(terminal): a null terminal (a `free` wire
        // in a load-program list) throws there with "terminals: invalid physical terminal null",
        // and Terminals.terminalIndex(null) throws the same text.
        var def = Terminals.TERMINALS[Terminals.terminalIndex(terminal!)];
        var used = new List<string>(taken);
        foreach (var cord in LiveCords(rig))
        {
            used.Add(cord.a);
            if (cord.b is not null) used.Add(cord.b);
        }
        for (var hole = 1; hole <= def.holes; hole++)
        {
            var id = Terminals.holeAt(terminal!, hole).id;
            if (!used.Contains(id)) return id;
        }
        return null;
    }

    private static string CordsOn(Rig rig, string terminal)
    {
        var ids = new List<string>();
        foreach (var cord in LiveCords(rig))
        {
            if (EndName(cord.a) == terminal || EndName(cord.b) == terminal) ids.Add(I(cord.id));
        }
        return string.Join(", ", ids);
    }

    /// <summary>A cord end as the manual's shorthand writes it: its terminal, or `free`.</summary>
    private static string EndName(string? hole) => hole is null ? FREE : Terminals.parseHoleId(hole).terminal;

    private static string WireOf(string a, string? b) => EndName(a) + "/" + EndName(b);

    /// <summary>table.ts:341 `text.toLowerCase() === 'free'`, with V8's TypeError on a non-string.</summary>
    private static bool IsFree(JsonElement? text) => IsFree(Js.StringFor(text, "text", "toLowerCase"));

    // No character but F, R and E lower-cases to f, r or e, so the invariant simple mapping
    // agrees with JavaScript's full mapping on this comparison.
    private static bool IsFree(string text) => string.Equals(text.ToLowerInvariant(), FREE, StringComparison.Ordinal);

    private static ToolResult.Fail Reject(string why, string detail) => new(why, detail);

    private static ToolResult UnknownTerminal(JsonElement? text) => Reject("unknown_terminal", Js.Stringify(text) + " is not a terminal");

    private static string? ParseTerminal(JsonElement? text)
    {
        if (!Js.IsString(text)) return null;
        try
        {
            return Terminals.parseTerminalId(Js.Text(text!.Value));
        }
        catch (TerminalsException)
        {
            return null;
        }
    }

    private static bool IsTerminal(string text)
    {
        try
        {
            Terminals.parseTerminalId(text);
            return true;
        }
        catch (TerminalsException)
        {
            return false;
        }
    }

    /// <summary>
    /// table.ts:370 `parseWire`: the manual's `A/B` shorthand, either side may be `free`. The
    /// refusal text is `parseTerminalWire`'s message without its `terminals: ` prefix, rebuilt here
    /// with JSON.stringify's quoting: `Terminals.cs` quotes with JsonSerializer, which escapes `+`
    /// and non-ASCII (`"1+"`), and render.ts reads `"+"` and `−` out of this very text.
    /// </summary>
    public static (string a, string b)? parseWire(string text, out ToolResult.Fail? rejection)
    {
        rejection = null;
        var sides = text.Split('/');
        if (sides.Length == 2 && (IsFree(sides[0]) || IsFree(sides[1])) && sides[0].Length > 0 && sides[1].Length > 0)
        {
            return (IsFree(sides[0]) ? FREE : sides[0], IsFree(sides[1]) ? FREE : sides[1]);
        }
        // terminals.ts:172 parseTerminalWire.
        var slash = text.IndexOf('/', StringComparison.Ordinal);
        if (slash <= 0 || slash != text.LastIndexOf('/') || slash == text.Length - 1)
        {
            rejection = Reject("unknown_terminal", "invalid terminal wire " + Js.Quote(text));
            return null;
        }
        var a = text[..slash];
        var b = text[(slash + 1)..];
        if (!IsTerminal(a))
        {
            rejection = Reject("unknown_terminal", "invalid physical terminal " + Js.Quote(a));
            return null;
        }
        if (!IsTerminal(b))
        {
            rejection = Reject("unknown_terminal", "invalid physical terminal " + Js.Quote(b));
            return null;
        }
        return (a, b);
    }

    /// <summary>parseWire over a JS value: `text.split` throws V8's TypeError on a non-string.</summary>
    private static (string a, string b)? ParseWireValue(JsonElement? text, out ToolResult.Fail? rejection) =>
        parseWire(Js.StringFor(text, "text", "split"), out rejection);

    /// <summary>Apply one contract command; on success log it and update the projected cord table.</summary>
    private static CmdResult ApplyCommand(Rig rig, Command cmd)
    {
        var result = rig.machine.Apply(cmd);
        if (!result.ok) return result;
        if (cmd is Command.Connect { a: CordEnd.Hole aHole } connect && connect.b is not CordEnd.Touch)
        {
            var b = connect.b is CordEnd.Hole bHole ? bHole.hole : null;
            rig.cords[connect.cord] = new CordView(connect.cord, aHole.hole, b, WireOf(aHole.hole, b));
        }
        else if (cmd is Command.Disconnect disconnect)
        {
            rig.cords[disconnect.cord] = null;
        }
        rig.log.Add(new SessionStep.Do(cmd));
        if (rig.watch is not null) NoteObservables(rig.watch, rig.machine.Observables());
        return result;
    }

    private static string WhyText(CmdWhy why) => why switch
    {
        CmdWhy.hole_occupied => "hole_occupied",
        CmdWhy.unknown_hole => "unknown_hole",
        CmdWhy.unknown_terminal => "unknown_terminal",
        CmdWhy.unknown_cord => "unknown_cord",
        CmdWhy.cord_exists => "cord_exists",
        CmdWhy.bad_cord_id => "bad_cord_id",
        _ => "bad_target",
    };

    private static ToolResult CommandResult(Rig rig, Command cmd, string detail)
    {
        var result = ApplyCommand(rig, cmd);
        return result is CmdResult.Failure failure ? Reject(WhyText(failure.why), detail) : new ToolResult.Ok();
    }

    // The machine's own argument checks (machine.ts:616-700), run on the JS values before a typed
    // command can be built: a value the typed command cannot hold is one the machine refuses.

    private static bool InRange(JsonElement? value, double low, double high) =>
        Js.IsInteger(value) && Js.Num(value!.Value) >= low && Js.Num(value.Value) <= high;

    /// <summary>machine.ts:619: a cord id that is not an integer in 0..255 is `bad_cord_id`.</summary>
    private static bool CordId(JsonElement? value, out int id)
    {
        id = InRange(value, 0, MAX_CORDS - 1) ? (int)Js.Num(value!.Value) : -1;
        return id >= 0;
    }

    /// <summary>A button, switch or relayGrab command, or null for machine.ts:676's `bad_target`.</summary>
    private static Command? Mover(string kind, JsonElement? n, JsonElement? target)
    {
        if (!InRange(n, 1, SECTIONS) || !InRange(target, 0, 1000)) return null;
        var section = (int)Js.Num(n!.Value);
        var travel = (int)Js.Num(target!.Value);
        return kind switch
        {
            "button" => new Command.Button(section, travel),
            "switch" => new Command.Switch(section, travel),
            _ => new Command.RelayGrab(section, travel),
        };
    }

    private static ToolResult Checked(Rig rig, Command? cmd, string refusal, string detail) =>
        cmd is null ? Reject(refusal, detail) : CommandResult(rig, cmd, detail);

    // -----------------------------------------------------------------------------------------
    // Handlers

    private static ToolResult Power(Rig rig, JsonElement? args)
    {
        var on = Js.Prop(args, "on");
        return Checked(rig, Js.IsBoolean(on) ? new Command.Power(Js.IsTrue(on)) : null, "bad_target", "power needs on: true or false");
    }

    private static ToolResult Connect(Rig rig, JsonElement? args)
    {
        var aText = Js.Prop(args, "a");
        if (IsFree(aText) || IsFree(Js.Prop(args, "b"))) return ConnectFree(rig, IsFree(aText) ? Js.Prop(args, "b") : aText);
        var a = ParseTerminal(aText);
        if (a is null) return UnknownTerminal(aText);
        var bText = Js.Prop(args, "b");
        var b = ParseTerminal(bText);
        if (b is null) return UnknownTerminal(bText);

        var aHole = LowestFreeHole(rig, a, []);
        if (aHole is null)
            return Reject("hole_occupied", "every hole of " + a + " is in use (cords " + CordsOn(rig, a) + ")");
        var bHole = LowestFreeHole(rig, b, [aHole]);
        if (bHole is null)
        {
            if (a == b)
            {
                var others = CordsOn(rig, a);
                return Reject("hole_occupied", "connecting " + a + " to itself needs two free holes on " + a +
                    "; only one is free" + (others.Length == 0 ? "" : " (cords " + others + " use the rest)"));
            }
            return Reject("hole_occupied", "every hole of " + b + " is in use (cords " + CordsOn(rig, b) + ")");
        }
        var id = Array.IndexOf(rig.cords, null);
        if (id < 0) return Reject("bad_cord_id", "all " + I(MAX_CORDS) + " cord ids 0..255 are in use");

        var cmd = new Command.Connect(id, new CordEnd.Hole(aHole), new CordEnd.Hole(bHole));
        var result = CommandResult(rig, cmd, "connect " + a + "/" + b + " rejected by the machine");
        return result.ok ? new ToolResult.Ok(cord: rig.cords[id]) : result;
    }

    /// <summary>A cord plugged into `terminal` at one end, its other end hanging free (table.ts:440).</summary>
    private static ToolResult ConnectFree(Rig rig, JsonElement? terminal)
    {
        if (IsFree(terminal)) return Reject("unknown_terminal", "a cord needs a terminal at one end at least: connect <A>/free");
        var a = ParseTerminal(terminal);
        if (a is null) return UnknownTerminal(terminal);
        var aHole = LowestFreeHole(rig, a, []);
        if (aHole is null) return Reject("hole_occupied", "every hole of " + a + " is in use (cords " + CordsOn(rig, a) + ")");
        var id = Array.IndexOf(rig.cords, null);
        if (id < 0) return Reject("bad_cord_id", "all " + I(MAX_CORDS) + " cord ids 0..255 are in use");
        var cmd = new Command.Connect(id, new CordEnd.Hole(aHole), new CordEnd.Free());
        var result = CommandResult(rig, cmd, "connect " + a + "/" + FREE + " rejected by the machine");
        return result.ok ? new ToolResult.Ok(cord: rig.cords[id]) : result;
    }

    private static ToolResult Disconnect(Rig rig, JsonElement? args)
    {
        if (Js.In(args, "all"))
        {
            foreach (var cord in LiveCords(rig))
            {
                var result = CommandResult(rig, new Command.Disconnect(cord.id), "no cord " + I(cord.id) + " is plugged in");
                if (!result.ok) return result;
            }
            return new ToolResult.Ok();
        }
        if (Js.In(args, "cord"))
        {
            var value = Js.Prop(args, "cord");
            // 'no cord ' + args.cord: the id as JavaScript prints it (1.5, 1e+22, "x").
            var detail = "no cord " + Js.ToJsString(value) + " is plugged in";
            return Checked(rig, CordId(value, out var id) ? new Command.Disconnect(id) : null, "bad_cord_id", detail);
        }
        var aText = Js.Prop(args, "a");
        var a = IsFree(aText) ? FREE : ParseTerminal(aText);
        if (a is null) return UnknownTerminal(aText);
        var bText = Js.Prop(args, "b");
        var b = IsFree(bText) ? FREE : ParseTerminal(bText);
        if (b is null) return UnknownTerminal(bText);
        var matches = new List<CordView>();
        foreach (var cord in LiveCords(rig))
        {
            var ta = EndName(cord.a);
            var tb = EndName(cord.b);
            if ((ta == a && tb == b) || (ta == b && tb == a)) matches.Add(cord);
        }
        if (matches.Count == 0) return Reject("unknown_cord", "no cord runs between " + a + " and " + b);
        if (matches.Count > 1)
        {
            var ids = new List<string>();
            foreach (var match in matches) ids.Add(I(match.id));
            return Reject("ambiguous_cord", "cords " + string.Join(", ", ids) + " all run between " + a + " and " + b +
                "; disconnect one by id");
        }
        var only = matches[0].id;
        return CommandResult(rig, new Command.Disconnect(only), "no cord " + I(only) + " is plugged in");
    }

    private static ToolResult MoverHandler(Rig rig, JsonElement? args, string kind, string detail)
    {
        var n = Js.Prop(args, "n");
        var target = Js.Prop(args, "target");
        return Checked(rig, Mover(kind, n, target), "bad_target", detail);
    }

    // A pushbutton springs back on the real machine: a press is down, held, up, then the same time
    // released, so presses sent back to back in one batch are each seen.
    private static ToolResult Press(Rig rig, JsonElement? args)
    {
        var msValue = Js.Prop(args, "ms");
        var ms = Js.IsNullish(msValue) ? Js.Number(PRESS_MS) : msValue!.Value;
        var n = Js.Prop(args, "n");
        if (!InRange(n, 1, SECTIONS)) return Reject("bad_target", "press needs n in 1..6");
        // checkStep(ms * 2): `ms` passed checkMs, so it is an integer number here.
        var bad = CheckStep(rig, ms, "press time") ?? CheckStep(rig, Js.Number(Js.Num(ms) * 2), "press time");
        if (bad is not null) return Reject("bad_target", bad);
        var section = (int)Js.Num(n!.Value);
        var hold = (int)Js.Num(ms);
        var down = CommandResult(rig, new Command.Button(section, 1000), "press needs n in 1..6");
        if (!down.ok) return down;
        AdvanceMs(rig, hold);
        var up = CommandResult(rig, new Command.Button(section, 0), "press needs n in 1..6");
        if (!up.ok) return up;
        AdvanceMs(rig, hold);
        return new ToolResult.Ok();
    }

    private static ToolResult Breaker(Rig rig, JsonElement? args) =>
        Checked(rig, Js.IsTrue(Js.Prop(args, "reset")) ? new Command.Breaker() : null, "bad_target", "breaker needs reset: true");

    private static ToolResult RelayRelease(Rig rig, JsonElement? args)
    {
        var n = Js.Prop(args, "n");
        return Checked(rig, InRange(n, 1, SECTIONS) ? new Command.RelayRelease((int)Js.Num(n!.Value)) : null,
            "bad_target", "relayRelease needs n in 1..6");
    }

    private static ToolResult DialGrab(Rig rig, JsonElement? args)
    {
        var target = Js.Prop(args, "targetUdeg");
        return Checked(rig, InRange(target, 0, DIAL_UDEG_LIMIT - 1) ? new Command.DialGrab((long)Js.Num(target!.Value)) : null,
            "bad_target", "dialGrab needs targetUdeg an integer 0.." + I(DIAL_UDEG_LIMIT - 1));
    }

    private static ToolResult DialRelease(Rig rig, JsonElement? args) =>
        CommandResult(rig, new Command.DialRelease(), "dialRelease rejected by the machine");

    /// <summary>
    /// table.ts:536: plug every wire of a program, each as `connect` would. All holes and ids are
    /// planned before anything is applied; once all connects are applied, a `load` marker is
    /// inserted in the log just before them.
    /// </summary>
    private static ToolResult LoadProgram(Rig rig, JsonElement? args)
    {
        var programValue = Js.Prop(args, "program");
        var name = Js.Stringify(programValue);
        if (!Js.IsString(programValue) || !PROGRAM_ID.IsMatch(Js.Text(programValue!.Value)))
            return Reject("bad_program", name + " is not a program id");
        var program = Js.Text(programValue!.Value);
        var wiresValue = Js.Prop(args, "wires");
        var count = wiresValue is { ValueKind: JsonValueKind.Array } array ? array.GetArrayLength() : -1;
        if (count <= 0 || count > MAX_CORDS)
            return Reject("bad_program", "program " + program + " needs 1.." + I(MAX_CORDS) + " wires");
        var wires = Js.ArrayLike(wiresValue);
        var taken = new List<string>();
        var ids = new List<int>();
        var planned = new List<Command.Connect>();
        for (var i = 0; i < wires.Count; i++)
        {
            var text = wires[i];
            var where = "load-program " + program + ": wire " + I(i + 1) + " (" + Js.ToJsString(text) + ")";
            var wire = ParseWireValue(text, out var bad);
            if (wire is null) return Reject(bad!.why, where + ": " + bad.detail);
            var a = IsTerminal(wire.Value.a) ? wire.Value.a : null;
            var b = IsTerminal(wire.Value.b) ? wire.Value.b : null;
            var aHole = LowestFreeHole(rig, a, taken);
            string? bHole = null;
            if (aHole is not null)
            {
                var withA = new List<string>(taken) { aHole };
                bHole = LowestFreeHole(rig, b, withA);
            }
            if (aHole is null || bHole is null)
            {
                var full = aHole is null ? a! : b!;
                var others = CordsOn(rig, full);
                return Reject("hole_occupied", where + " cannot be placed: every hole of " + full + " is in use" +
                    (others.Length == 0 ? " by earlier wires of this program" : " (cords " + others + ", and earlier wires of this program)") +
                    "; nothing was plugged");
            }
            var id = 0;
            while (id < MAX_CORDS && (rig.cords[id] is not null || ids.Contains(id))) id++;
            if (id == MAX_CORDS)
                return Reject("bad_cord_id", where + ": all " + I(MAX_CORDS) + " cord ids 0..255 are in use; nothing was plugged");
            taken.Add(aHole);
            taken.Add(bHole);
            ids.Add(id);
            planned.Add(new Command.Connect(id, new CordEnd.Hole(aHole), new CordEnd.Hole(bHole)));
        }
        var markerAt = rig.log.Count;
        var cords = new List<CordView>();
        foreach (var cmd in planned)
        {
            var result = ApplyCommand(rig, cmd);
            if (result is CmdResult.Failure failure) return Reject(WhyText(failure.why), "load-program " + program + " rejected by the machine");
            cords.Add(rig.cords[cmd.cord]!);
        }
        // Only once every connect is in: a marker always has exactly its `cords` connects behind it.
        rig.log.Insert(markerAt, new SessionStep.Load(program, planned.Count));
        return new ToolResult.Ok(cords: cords);
    }

    private static ToolResult Wait(Rig rig, JsonElement? args)
    {
        var ms = Js.Prop(args, "ms");
        var bad = CheckStep(rig, ms, "wait");
        if (bad is not null) return Reject("bad_target", bad);
        AdvanceMs(rig, (int)Js.Num(ms!.Value));
        return new ToolResult.Ok();
    }

    public static StateView stateView(Rig rig)
    {
        var current = rig.machine.Observables();
        var observables = new List<ObservableView>(Trace.OBSERVABLE_COUNT);
        for (var i = 0; i < Trace.OBSERVABLE_COUNT; i++)
            observables.Add(new ObservableView(Trace.OBSERVABLES[i].name, observableText(i, current[i])));
        var snapshot = rig.machine.Snapshot();
        return new StateView(snapshot.tick, observables, LiveCords(rig), snapshot);
    }

    private static ToolResult StateTool(Rig rig, JsonElement? args) => new ToolResult.Ok(view: stateView(rig));

    public static string observableText(int index, int encoded)
    {
        var row = Trace.OBSERVABLES[index];
        var at = (long)encoded - row.minValue;
        return at >= 0 && at < row.values.Count ? row.values[(int)at] : I(encoded);
    }

    // -----------------------------------------------------------------------------------------
    // The table: names in TOOL_TABLE order (table.ts:620). The descriptions and JSON Schemas are
    // adapter metadata; nothing the engine runs reads them, so they are not ported.

    public static readonly IReadOnlyList<string> TOOL_NAMES =
    [
        "power", "connect", "disconnect", "button", "press", "switch", "wait", "state",
        "breaker", "relayGrab", "relayRelease", "dialGrab", "dialRelease", "loadProgram",
    ];

    private static ToolResult Handle(int row, Rig rig, JsonElement? args) => row switch
    {
        0 => Power(rig, args),
        1 => Connect(rig, args),
        2 => Disconnect(rig, args),
        3 => MoverHandler(rig, args, "button", "button needs n in 1..6 and target an integer 0..1000"),
        4 => Press(rig, args),
        5 => MoverHandler(rig, args, "switch", "switch needs n in 1..6 and target an integer 0..1000"),
        6 => Wait(rig, args),
        7 => StateTool(rig, args),
        8 => Breaker(rig, args),
        9 => MoverHandler(rig, args, "relayGrab", "relayGrab needs n in 1..6 and target an integer 0..1000"),
        10 => RelayRelease(rig, args),
        11 => DialGrab(rig, args),
        12 => DialRelease(rig, args),
        _ => LoadProgram(rig, args),
    };

    public static ToolResult callTool(Rig rig, ToolCall call)
    {
        var name = Js.Prop(call.Raw, "name");
        for (var row = 0; row < TOOL_NAMES.Count; row++)
        {
            if (Js.StrictEquals(name, TOOL_NAMES[row])) return Handle(row, rig, Js.Prop(call.Raw, "args"));
        }
        throw new HandsError("hands: no tool " + Js.Stringify(name));
    }

    // -----------------------------------------------------------------------------------------
    // Batches and replay

    private static BatchRejection Refuse(int failedAt, string detail) => new(failedAt, Reject("bad_target", detail));

    /// <summary>
    /// table.ts:804: validate every time step of a batch once, up front: each wait and press time
    /// and the settle cap, and their total against the int32 tick limit. Reads only the tick.
    /// </summary>
    private static BatchRejection? RefuseTime(Rig rig, IReadOnlyList<ToolCall> calls, JsonElement? settleMs)
    {
        var startTick = rig.machine.Snapshot().tick;
        long budget = 0;
        for (var i = 0; i < calls.Count; i++)
        {
            var name = Js.Prop(calls[i].Raw, "name");
            var isWait = Js.StrictEquals(name, "wait");
            if (!isWait && !Js.StrictEquals(name, "press")) continue;
            var ms = Js.Prop(Js.Prop(calls[i].Raw, "args"), "ms");
            if (!isWait && Js.IsNullish(ms)) ms = Js.Number(PRESS_MS);
            var bad = CheckMs(ms, isWait ? "wait" : "press time");
            if (bad is not null) return Refuse(i, bad);
            var value = (long)Js.Num(ms!.Value);
            budget += (isWait ? value : value * 2) * 10;
            if (startTick > INT32_MAX - budget) return Refuse(i, TickLimit(startTick));
        }
        var badSettle = CheckMs(settleMs, "settle cap");
        if (badSettle is not null) return Refuse(calls.Count, badSettle);
        budget += (long)Js.Num(settleMs!.Value) * 10;
        if (startTick > INT32_MAX - budget) return Refuse(calls.Count, TickLimit(startTick));
        return null;
    }

    /// <summary>`settleMs = DEFAULT_SETTLE_MS`: only undefined takes the default (table.ts:830).</summary>
    private static JsonElement? SettleDefault(JsonElement? settleMs) => settleMs ?? Js.Number(DEFAULT_SETTLE_MS);

    public static BatchOutcome runBatch(Rig rig, IReadOnlyList<ToolCall> calls, int settleMs = DEFAULT_SETTLE_MS) =>
        runBatch(rig, calls, Js.Number(settleMs));

    /// <summary>
    /// table.ts:830: apply calls in order, stop at the first rejection, then run one capped
    /// settle. On failure the rig has been partly mutated; callers that need atomicity validate
    /// first (the pane).
    /// </summary>
    public static BatchOutcome runBatch(Rig rig, IReadOnlyList<ToolCall> calls, JsonElement? settleMs)
    {
        settleMs = SettleDefault(settleMs);
        var refused = RefuseTime(rig, calls, settleMs);
        if (refused is not null) return refused;

        var before = rig.machine.Observables();
        rig.watch = new Watch[Trace.OBSERVABLE_COUNT];
        for (var i = 0; i < Trace.OBSERVABLE_COUNT; i++) rig.watch[i] = new Watch(before[i]);
        try
        {
            var results = new List<ToolResult>();
            for (var i = 0; i < calls.Count; i++)
            {
                var call = calls[i];
                // Waits were validated above; run them directly rather than re-checking in the handler.
                ToolResult result = new ToolResult.Ok();
                if (Js.StrictEquals(Js.Prop(call.Raw, "name"), "wait"))
                    AdvanceMs(rig, (int)Js.Num(Js.Prop(Js.Prop(call.Raw, "args"), "ms")!.Value));
                else
                    result = callTool(rig, call);
                if (result is ToolResult.Fail failure) return new BatchRejection(i, failure);
                results.Add(result);
            }
            var outcome = Settle(rig, (int)Js.Num(settleMs!.Value));
            var changes = new List<Change>();
            for (var i = 0; i < Trace.OBSERVABLE_COUNT; i++)
            {
                var seen = rig.watch[i];
                if (seen.count == 0) continue;
                var elided = seen.count > PATH_LIMIT;
                var path = elided ? new List<int> { seen.head[0], seen.last } : seen.head;
                var values = new List<string>();
                foreach (var value in path) values.Add(observableText(i, value));
                changes.Add(new Change(Trace.OBSERVABLES[i].name, values, seen.count, elided));
            }
            return new BatchOutcome.Accepted(results, outcome, changes);
        }
        finally
        {
            rig.watch = null;
        }
    }

    public static BatchRejection? validateBatch(Rig rig, IReadOnlyList<ToolCall> calls, int settleMs = DEFAULT_SETTLE_MS) =>
        validateBatch(rig, calls, Js.Number(settleMs));

    /// <summary>
    /// table.ts:888: whether `runBatch(rig, calls, settleMs)` would reject, answered without
    /// touching `rig` or its machine; null when it would not. A rejection is exactly runBatch's.
    /// </summary>
    public static BatchRejection? validateBatch(Rig rig, IReadOnlyList<ToolCall> calls, JsonElement? settleMs)
    {
        settleMs = SettleDefault(settleMs);
        var refused = RefuseTime(rig, calls, settleMs);
        if (refused is not null) return refused;
        var scratch = ScratchRig(rig);
        for (var i = 0; i < calls.Count; i++)
        {
            var call = calls[i];
            if (Js.StrictEquals(Js.Prop(call.Raw, "name"), "wait")) continue;
            if (callTool(scratch, call) is ToolResult.Fail failure) return new BatchRejection(i, failure);
        }
        return null;
    }

    /// <summary>A machine whose clock never moves (table.ts:911): advance does nothing, observables never change.</summary>
    private sealed class StillMachine : Machine
    {
        private readonly Machine _real;
        private readonly int[] _still;

        public StillMachine(Machine real)
        {
            _real = real;
            _still = (int[])real.Observables().Clone();
        }

        public CmdResult Apply(Command c) => _real.Apply(c);
        public void Advance(int ticks) { }
        public State Snapshot() => _real.Snapshot();
        public int[] Observables() => _still;
        public int MotionMask() => _real.MotionMask();
        public Event[] DrainEvents() => _real.DrainEvents();
    }

    /// <summary>A fresh machine holding `rig`'s cords under a rig whose clock never moves (table.ts:902).</summary>
    private static Rig ScratchRig(Rig rig)
    {
        var real = Machine.CreateMachine(rig.netlist, rig.profile);
        foreach (var cord in LiveCords(rig))
        {
            CordEnd b = cord.b is null ? new CordEnd.Free() : new CordEnd.Hole(cord.b);
            var placed = real.Apply(new Command.Connect(cord.id, new CordEnd.Hole(cord.a), b));
            if (placed is CmdResult.Failure failure)
                throw new HandsError("hands: live cord " + I(cord.id) + " cannot be mirrored: " + WhyText(failure.why));
        }
        // With no tick, queued commands never reach the observables, so one reading serves every call.
        var machine = new StillMachine(real);
        return new Rig(machine, rig.netlist, rig.profile, (int[])machine.Observables().Clone(), (CordView?[])rig.cords.Clone(), []);
    }

    /// <summary>An empty session bound to this netlist and profile by their snapshot hashes.</summary>
    public static Session newSession(LoadedNetlist netlist, Profile profile)
    {
        var state = createRig(netlist, profile).machine.Snapshot();
        return new Session(SESSION_SCHEMA, profile.id, Contract.CONTRACT, state.netlistHash, state.profileHash, []);
    }

    /// <summary>table.ts:940 `{ ...base, script: rig.log.slice() }`.</summary>
    public static Session sessionOf(Rig rig, Session @base) => @base with { script = rig.log.ToArray() };

    private static SessionError Corrupt(int index, string message) =>
        new("corrupt session: script[" + I(index) + "] " + message);

    public static Rig replay(LoadedNetlist netlist, Profile profile, Session session) =>
        replay(netlist, profile, Js.Parse(HandsJson.Session(session)));

    /// <summary>
    /// table.ts:949: rebuild a machine from scratch by replaying every step of a session as
    /// JSON.parse made it. Throws SessionError on any rejection.
    /// </summary>
    public static Rig replay(LoadedNetlist netlist, Profile profile, JsonElement session)
    {
        if (!Js.StrictEquals(Js.Prop(session, "schema"), SESSION_SCHEMA))
            throw new SessionError("corrupt session: schema is not " + SESSION_SCHEMA);
        var sessionProfile = Js.Prop(session, "profile");
        if (!Js.StrictEquals(sessionProfile, profile.id))
            throw new SessionError("corrupt session: profile " + Js.Stringify(sessionProfile) + " but loaded " + profile.id);
        var contract = Js.Prop(session, "contract");
        if (!Js.StrictEquals(contract, Contract.CONTRACT))
            throw new SessionError("corrupt session: contract " + Js.Stringify(contract) + ", this build is " + Contract.CONTRACT);
        var rig = createRig(netlist, profile);
        var state = rig.machine.Snapshot();
        var netlistHash = Js.Prop(session, "netlistHash");
        if (!Js.StrictEquals(netlistHash, state.netlistHash))
        {
            throw new SessionError("session was recorded against a different netlist (" + Js.ToJsString(netlistHash) +
                ", loaded " + state.netlistHash + "); start a new session");
        }
        var profileHash = Js.Prop(session, "profileHash");
        if (!Js.StrictEquals(profileHash, state.profileHash))
        {
            throw new SessionError("session was recorded against a different profile " + Js.ToJsString(sessionProfile) + " (" +
                Js.ToJsString(profileHash) + ", loaded " + state.profileHash + "); start a new session");
        }
        var script = Js.ArrayLike(Js.Prop(session, "script"));
        for (var i = 0; i < script.Count; i++)
        {
            var step = script[i];
            var kind = Js.Prop(step, "k");
            if (Js.StrictEquals(kind, "do"))
            {
                var cmd = Js.Prop(step, "cmd");
                if (Js.In(step, "collapse")) throw Corrupt(i, "collapse is a fixture-only field");
                var cmdKind = Js.Prop(cmd, "k");
                if (Js.StrictEquals(cmdKind, "connect"))
                {
                    if (!Js.StrictEquals(Js.Prop(Js.Prop(cmd, "a"), "k"), "hole") ||
                        (!Js.StrictEquals(Js.Prop(Js.Prop(cmd, "b"), "k"), "hole") && !Js.StrictEquals(Js.Prop(Js.Prop(cmd, "b"), "k"), "free")) ||
                        Js.Prop(cmd, "r_uohm") is not null)
                    {
                        throw Corrupt(i, "connect must be hole to hole, or hole to free, with no r_uohm");
                    }
                }
                var why = ApplyReplayed(rig, cmd!.Value);
                if (why is not null) throw Corrupt(i, Js.ToJsString(cmdKind) + " was rejected on replay: " + why);
            }
            else if (Js.StrictEquals(kind, "advance"))
            {
                var ms = Js.Prop(step, "ms");
                var bad = CheckStep(rig, ms, "advance");
                if (bad is not null) throw Corrupt(i, bad);
                AdvanceMs(rig, (int)Js.Num(ms!.Value));
            }
            else if (Js.StrictEquals(kind, "settle"))
            {
                var maxMs = Js.Prop(step, "maxMs");
                var bad = CheckStep(rig, maxMs, "settle");
                if (bad is not null) throw Corrupt(i, bad);
                Settle(rig, (int)Js.Num(maxMs!.Value));
            }
            else if (Js.StrictEquals(kind, "load"))
            {
                var program = Js.Prop(step, "program");
                if (!Js.IsString(program) || !PROGRAM_ID.IsMatch(Js.Text(program!.Value)))
                    throw Corrupt(i, "load program is not a program id");
                var cords = Js.Prop(step, "cords");
                if (!InRange(cords, 1, MAX_CORDS)) throw Corrupt(i, "load cords must be in 1.." + I(MAX_CORDS));
                var count = (int)Js.Num(cords!.Value);
                for (var j = i + 1; j <= i + count; j++)
                {
                    if (j >= script.Count || !Js.StrictEquals(Js.Prop(script[j], "k"), "do") ||
                        !Js.StrictEquals(Js.Prop(Js.Prop(script[j], "cmd"), "k"), "connect"))
                    {
                        throw Corrupt(i, "load of " + Js.Text(program!.Value) + " must be followed by its " + I(count) + " connect steps");
                    }
                }
                rig.log.Add(new SessionStep.Load(Js.Text(program!.Value), count));
            }
            else
            {
                throw Corrupt(i, "unknown step kind");
            }
        }
        return rig;
    }

    /// <summary>
    /// Replay's `applyCommand(rig, cmd)` on a command as the session spelled it: machine.ts:616's
    /// checks on the JS values, then the typed command, then the cord table and the log (the raw
    /// command, as table.ts:394 logs the parsed object). Null when applied, else the `why`.
    /// Connect ends were already checked to be a hole and a hole or free end (table.ts:973).
    /// </summary>
    private static string? ApplyReplayed(Rig rig, JsonElement cmd)
    {
        var kind = Js.Prop(cmd, "k");
        Command? typed = null;
        string refusal = "bad_target";
        if (Js.StrictEquals(kind, "connect") || Js.StrictEquals(kind, "disconnect"))
        {
            refusal = "bad_cord_id";
            if (CordId(Js.Prop(cmd, "cord"), out var id))
            {
                if (Js.StrictEquals(kind, "disconnect"))
                {
                    typed = new Command.Disconnect(id);
                }
                else
                {
                    // A hole that is not a string fails parseHoleId's typeof check (unknown_hole);
                    // the empty string fails Terminals.parseHoleId the same way.
                    var aHole = Js.Prop(Js.Prop(cmd, "a"), "hole");
                    var b = Js.Prop(cmd, "b");
                    CordEnd bEnd = Js.StrictEquals(Js.Prop(b, "k"), "free")
                        ? new CordEnd.Free()
                        : new CordEnd.Hole(Js.IsString(Js.Prop(b, "hole")) ? Js.Text(Js.Prop(b, "hole")!.Value) : "");
                    typed = new Command.Connect(id, new CordEnd.Hole(Js.IsString(aHole) ? Js.Text(aHole!.Value) : ""), bEnd);
                }
            }
        }
        else if (Js.StrictEquals(kind, "power"))
        {
            var on = Js.Prop(cmd, "on");
            if (Js.IsBoolean(on)) typed = new Command.Power(Js.IsTrue(on));
        }
        else if (Js.StrictEquals(kind, "breaker"))
        {
            if (Js.IsTrue(Js.Prop(cmd, "reset"))) typed = new Command.Breaker();
        }
        else if (Js.StrictEquals(kind, "button") || Js.StrictEquals(kind, "switch") || Js.StrictEquals(kind, "relayGrab"))
        {
            typed = Mover(Js.Text(kind!.Value), Js.Prop(cmd, "n"), Js.Prop(cmd, "target"));
        }
        else if (Js.StrictEquals(kind, "relayRelease"))
        {
            var n = Js.Prop(cmd, "n");
            if (InRange(n, 1, SECTIONS)) typed = new Command.RelayRelease((int)Js.Num(n!.Value));
        }
        else if (Js.StrictEquals(kind, "dialGrab"))
        {
            var target = Js.Prop(cmd, "targetUdeg");
            if (InRange(target, 0, DIAL_UDEG_LIMIT - 1)) typed = new Command.DialGrab((long)Js.Num(target!.Value));
        }
        else if (Js.StrictEquals(kind, "dialRelease"))
        {
            typed = new Command.DialRelease();
        }
        if (typed is null) return refusal;

        var result = rig.machine.Apply(typed);
        if (result is CmdResult.Failure failure) return WhyText(failure.why);
        if (typed is Command.Connect { a: CordEnd.Hole aEnd } connect)
        {
            var bHole = connect.b is CordEnd.Hole hole ? hole.hole : null;
            rig.cords[connect.cord] = new CordView(connect.cord, aEnd.hole, bHole, WireOf(aEnd.hole, bHole));
        }
        else if (typed is Command.Disconnect disconnect)
        {
            rig.cords[disconnect.cord] = null;
        }
        rig.log.Add(new SessionStep.Do(cmd.Clone()));
        if (rig.watch is not null) NoteObservables(rig.watch, rig.machine.Observables());
        return null;
    }
}
