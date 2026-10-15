namespace Minivac.Core;

public static class Contract
{
    public const string CONTRACT = "1.1.0";
}

public abstract class CordEnd
{
    private protected CordEnd(string discriminator) => k = discriminator;

    public string k { get; }

    public sealed class Hole : CordEnd
    {
        public Hole(string hole) : base("hole") => this.hole = hole;
        public string hole { get; }
    }

    public sealed class Touch : CordEnd
    {
        public Touch(string term) : base("touch") => this.term = term;
        public string term { get; }
    }

    public sealed class Free : CordEnd
    {
        public Free() : base("free") { }
    }
}

public abstract class Command
{
    private protected Command(string discriminator) => k = discriminator;

    public string k { get; }

    public sealed class Power : Command
    {
        public Power(bool on) : base("power") => this.on = on;
        public bool on { get; }
    }

    public sealed class Breaker : Command
    {
        public Breaker() : base("breaker") { }
        public bool reset => true;
    }

    public sealed class Connect : Command
    {
        public Connect(int cord, CordEnd a, CordEnd b, long? r_uohm = null) : base("connect")
        {
            this.cord = cord;
            this.a = a;
            this.b = b;
            this.r_uohm = r_uohm;
        }

        public int cord { get; }
        public CordEnd a { get; }
        public CordEnd b { get; }
        public long? r_uohm { get; }
    }

    public sealed class Disconnect : Command
    {
        public Disconnect(int cord) : base("disconnect") => this.cord = cord;
        public int cord { get; }
    }

    public sealed class Button : Command
    {
        public Button(int n, int target) : base("button")
        {
            this.n = n;
            this.target = target;
        }

        public int n { get; }
        public int target { get; }
    }

    public sealed class Switch : Command
    {
        public Switch(int n, int target) : base("switch")
        {
            this.n = n;
            this.target = target;
        }

        public int n { get; }
        public int target { get; }
    }

    public sealed class RelayGrab : Command
    {
        public RelayGrab(int n, int target) : base("relayGrab")
        {
            this.n = n;
            this.target = target;
        }

        public int n { get; }
        public int target { get; }
    }

    public sealed class RelayRelease : Command
    {
        public RelayRelease(int n) : base("relayRelease") => this.n = n;
        public int n { get; }
    }

    public sealed class DialGrab : Command
    {
        public DialGrab(long targetUdeg) : base("dialGrab") => this.targetUdeg = targetUdeg;
        public long targetUdeg { get; }
    }

    public sealed class DialRelease : Command
    {
        public DialRelease() : base("dialRelease") { }
    }
}

public abstract class CmdResult
{
    private protected CmdResult(bool result) => ok = result;

    public bool ok { get; }

    public sealed class Success : CmdResult
    {
        public Success() : base(true) { }
    }

    public sealed class Failure : CmdResult
    {
        public Failure(CmdWhy why) : base(false) => this.why = why;
        public CmdWhy why { get; }
    }
}

public enum CmdWhy
{
    hole_occupied,
    unknown_hole,
    unknown_terminal,
    unknown_cord,
    cord_exists,
    bad_cord_id,
    bad_target,
}

public enum ChatterDev
{
    relay1,
    relay2,
    relay3,
    relay4,
    relay5,
    relay6,
    pb1,
    pb2,
    pb3,
    pb4,
    pb5,
    pb6,
    sw1,
    sw2,
    sw3,
    sw4,
    sw5,
    sw6,
    dial,
}

public abstract class TraceAnomaly
{
    private protected TraceAnomaly(string discriminator) => k = discriminator;

    public string k { get; }

    public sealed class Chatter : TraceAnomaly
    {
        public Chatter(ChatterDev dev, int transitions, int windowTicks, int quietTicks) : base("chatter")
        {
            this.dev = dev;
            this.transitions = transitions;
            this.windowTicks = windowTicks;
            this.quietTicks = quietTicks;
        }

        public ChatterDev dev { get; }
        public int transitions { get; }
        public int windowTicks { get; }
        public int quietTicks { get; }
    }

    public sealed class NoSettle : TraceAnomaly
    {
        public NoSettle(int waitedTicks) : base("no-settle") => this.waitedTicks = waitedTicks;
        public int waitedTicks { get; }
    }
}

public abstract class Note
{
    private protected Note(string discriminator) => k = discriminator;

    public string k { get; }

    public sealed class CoilStarved : Note
    {
        public CoilStarved(int relay, int coilUa, int needsUa, Drop[] drops) : base("coil-starved")
        {
            this.relay = relay;
            this.coilUa = coilUa;
            this.needsUa = needsUa;
            this.drops = drops;
        }

        public int relay { get; }
        public int coilUa { get; }
        public int needsUa { get; }
        public Drop[] drops { get; }
    }

    public sealed class LampInCoilPath : Note
    {
        public LampInCoilPath(int relay, int lampMv) : base("lamp-in-coil-path")
        {
            this.relay = relay;
            this.lampMv = lampMv;
        }

        public int relay { get; }
        public int lampMv { get; }
    }

    public sealed record Drop(string el, int mv);
}

public abstract class Event
{
    private protected Event(int timestamp, string discriminator)
    {
        t = timestamp;
        k = discriminator;
    }

    public int t { get; }
    public string k { get; }

    public sealed class PowerOn : Event { public PowerOn(int t) : base(t, "power.on") { } }
    public sealed class PowerOff : Event { public PowerOff(int t) : base(t, "power.off") { } }
    public sealed class BreakerTrip : Event { public BreakerTrip(int t) : base(t, "breaker.trip") { } }
    public sealed class BreakerReset : Event { public BreakerReset(int t) : base(t, "breaker.reset") { } }

    public sealed class RelayPullIn : Event
    {
        public RelayPullIn(int t, int n, int coilUa, int marginUa) : base(t, "relay.pullIn")
        {
            this.n = n;
            this.coilUa = coilUa;
            this.marginUa = marginUa;
        }

        public int n { get; }
        public int coilUa { get; }
        public int marginUa { get; }
    }

    public sealed class RelayDropOut : Event
    {
        public RelayDropOut(int t, int n, int coilUa, int marginUa) : base(t, "relay.dropOut")
        {
            this.n = n;
            this.coilUa = coilUa;
            this.marginUa = marginUa;
        }

        public int n { get; }
        public int coilUa { get; }
        public int marginUa { get; }
    }

    public sealed class ContactMake : Event
    {
        public ContactMake(int t, string arm, string to) : base(t, "contact.make")
        {
            this.arm = arm;
            this.to = to;
        }

        public string arm { get; }
        public string to { get; }
    }

    public sealed class ContactBreak : Event
    {
        public ContactBreak(int t, string arm, string to) : base(t, "contact.break")
        {
            this.arm = arm;
            this.to = to;
        }

        public string arm { get; }
        public string to { get; }
    }

    public sealed class LampOn : Event
    {
        public LampOn(int t, LampKind kind, int n) : base(t, "lamp.on")
        {
            this.kind = kind;
            this.n = n;
        }

        public LampKind kind { get; }
        public int n { get; }
    }

    public sealed class LampOff : Event
    {
        public LampOff(int t, LampKind kind, int n) : base(t, "lamp.off")
        {
            this.kind = kind;
            this.n = n;
        }

        public LampKind kind { get; }
        public int n { get; }
    }

    public sealed class DialMake : Event
    {
        public DialMake(int t, int pos) : base(t, "dial.make") => this.pos = pos;
        public int pos { get; }
    }

    public sealed class DialBreak : Event
    {
        public DialBreak(int t, int pos) : base(t, "dial.break") => this.pos = pos;
        public int pos { get; }
    }

    public sealed class Chatter : Event
    {
        public Chatter(int t, ChatterDev dev, int transitions, int windowTicks, int quietTicks) : base(t, "chatter")
        {
            this.dev = dev;
            this.transitions = transitions;
            this.windowTicks = windowTicks;
            this.quietTicks = quietTicks;
        }

        public ChatterDev dev { get; }
        public int transitions { get; }
        public int windowTicks { get; }
        public int quietTicks { get; }
    }

    public enum LampKind
    {
        @out,
        ind,
    }
}

public enum RelayBand
{
    below,
    hold,
    above,
}

public enum LampClass
{
    @off,
    dim,
    @on,
}

public sealed record State(
    string contract,
    string netlistHash,
    string profileId,
    string profileHash,
    int tick,
    bool power,
    bool breakerTripped,
    int railMv,
    int supplyUa,
    State.Relay[] relays,
    State.Lamp[] outLamps,
    State.Lamp[] indLamps,
    State.Button[] buttons,
    State.Switch[] switches,
    State.Dial dial,
    State.Cord[] cords,
    int?[] terminalMv,
    Note[] notes,
    State.Flags flags)
{
    public sealed record RelayContacts(bool nc, bool no);

    public sealed record Relay(
        int travel,
        int coilMv,
        int coilUa,
        int pullInUa,
        int dropOutUa,
        RelayBand band,
        bool coilShorted,
        RelayContacts set1,
        RelayContacts set2,
        int indicatorUa,
        bool held);

    public sealed record Lamp(int ua, int milli, LampClass cls);
    public sealed record Button(int travel, bool nc, bool no);
    public sealed record Switch(int travel, (bool, bool) set1, (bool, bool) set2);
    public sealed record Dial(long udeg, int? contact, int mrpm, bool held);
    public sealed record Cord(int id, CordEnd a, CordEnd b, long r_uohm);
    public sealed record Flags(ChatterDev[] chattering, bool overCurrent, bool nonPortable);
}

public interface Machine
{
    static Machine CreateMachine(LoadedNetlist netlist, Profile profile) => new MachineImpl(netlist, profile);

    CmdResult Apply(Command c);
    void Advance(int ticks);
    State Snapshot();
    int[] Observables();
    int MotionMask();
    Event[] DrainEvents();
}
