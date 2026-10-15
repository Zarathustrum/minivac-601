using System;
using System.Collections;
using System.Collections.Generic;

namespace Minivac.Core;

public sealed class MachineException : Exception
{
    public MachineException(string message) : base("machine: " + message) { }
}

internal sealed class PrimitivePage
{
    internal readonly sbyte[] tag = new sbyte[MachineImpl.STORE_PAGE_SIZE];
    internal readonly int[] f0 = new int[MachineImpl.STORE_PAGE_SIZE];
    internal readonly int[] f1 = new int[MachineImpl.STORE_PAGE_SIZE];
    internal readonly int[] f2 = new int[MachineImpl.STORE_PAGE_SIZE];
    internal readonly int[] f3 = new int[MachineImpl.STORE_PAGE_SIZE];
    internal readonly int[] f4 = new int[MachineImpl.STORE_PAGE_SIZE];
    internal readonly int[] f5 = new int[MachineImpl.STORE_PAGE_SIZE];
    internal readonly int[] f6 = new int[MachineImpl.STORE_PAGE_SIZE];
    internal readonly int[] f7 = new int[MachineImpl.STORE_PAGE_SIZE];
    internal int end;
    internal PrimitivePage? next;
}

internal sealed class PrimitiveStore
{
    internal PrimitivePage? head;
    internal PrimitivePage? tail;
    internal PrimitivePage? free;
    internal int count;

    internal void Append(
        int tag,
        int f0 = 0,
        int f1 = 0,
        int f2 = 0,
        int f3 = 0,
        int f4 = 0,
        int f5 = 0,
        int f6 = 0,
        int f7 = 0)
    {
        var page = tail;
        if (page is null || page.end == MachineImpl.STORE_PAGE_SIZE)
        {
            page = Acquire();
            if (tail is null) head = page;
            else tail.next = page;
            tail = page;
        }
        var at = page.end;
        page.tag[at] = (sbyte)tag;
        page.f0[at] = f0;
        page.f1[at] = f1;
        page.f2[at] = f2;
        page.f3[at] = f3;
        page.f4[at] = f4;
        page.f5[at] = f5;
        page.f6[at] = f6;
        page.f7[at] = f7;
        page.end++;
        count++;
    }

    internal void CopyInto(PrimitiveStore target)
    {
        var page = head;
        while (page is not null)
        {
            for (var i = 0; i < page.end; i++)
                target.Append(page.tag[i], page.f0[i], page.f1[i], page.f2[i], page.f3[i],
                    page.f4[i], page.f5[i], page.f6[i], page.f7[i]);
            page = page.next;
        }
        Clear();
    }

    internal void Clear()
    {
        var page = head;
        while (page is not null)
        {
            var next = page.next;
            page.end = 0;
            page.next = free;
            free = page;
            page = next;
        }
        head = null;
        tail = null;
        count = 0;
    }

    private PrimitivePage Acquire()
    {
        var page = free;
        if (page is null) return new PrimitivePage();
        free = page.next;
        page.next = null;
        return page;
    }
}

internal sealed class CordView : IReadOnlyList<ResolvedCord>
{
    private readonly ResolvedCord[] Slots = new ResolvedCord[Graph.GRAPH_MAX_CORDS];

    internal CordView()
    {
        for (var i = 0; i < Slots.Length; i++) Slots[i] = new ResolvedCord(i, -1, -1, 0);
    }

    internal ResolvedCord Slot(int index) => Slots[index];
    public int Count { get; internal set; }
    public ResolvedCord this[int index] => Slots[index];
    public IEnumerator<ResolvedCord> GetEnumerator()
    {
        for (var i = 0; i < Count; i++) yield return Slots[i];
    }
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}

internal sealed class SByteIntView : IReadOnlyList<int>
{
    private readonly sbyte[] Values;

    internal SByteIntView(sbyte[] values) => Values = values;
    public int Count => Values.Length;
    public int this[int index] => Values[index];
    public IEnumerator<int> GetEnumerator()
    {
        for (var i = 0; i < Values.Length; i++) yield return Values[i];
    }
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}

internal sealed class CordTable
{
    internal readonly byte[] live = new byte[Graph.GRAPH_MAX_CORDS];
    internal readonly sbyte[] aKind = new sbyte[Graph.GRAPH_MAX_CORDS];
    internal readonly short[] aTerminal = new short[Graph.GRAPH_MAX_CORDS];
    internal readonly short[] aHole = new short[Graph.GRAPH_MAX_CORDS];
    internal readonly sbyte[] bKind = new sbyte[Graph.GRAPH_MAX_CORDS];
    internal readonly short[] bTerminal = new short[Graph.GRAPH_MAX_CORDS];
    internal readonly short[] bHole = new short[Graph.GRAPH_MAX_CORDS];
    internal readonly int[] rUohm = new int[Graph.GRAPH_MAX_CORDS];
    internal readonly short[] holeOwner = new short[Terminals.HOLE_COUNT];

    internal CordTable()
    {
        Array.Fill(aTerminal, (short)-1);
        Array.Fill(aHole, (short)-1);
        Array.Fill(bTerminal, (short)-1);
        Array.Fill(bHole, (short)-1);
        Array.Fill(holeOwner, (short)-1);
    }
}

internal sealed class MachineImpl : Machine
{
    private const int SECTIONS = 6;
    private const int LAMPS = 12;
    private const int CONTACTS = 31;
    private const int NOTE_STRIDE = Graph.GRAPH_MAX_ELEMENTS;
    internal const int STORE_PAGE_SIZE = 64;

    private const int END_FREE = 0;
    private const int END_TOUCH = 1;
    private const int END_HOLE = 2;

    private const int CMD_POWER = 1;
    private const int CMD_BREAKER = 2;
    private const int CMD_CONNECT = 3;
    private const int CMD_DISCONNECT = 4;
    private const int CMD_BUTTON = 5;
    private const int CMD_SWITCH = 6;
    private const int CMD_DIAL_GRAB = 7;
    private const int CMD_DIAL_RELEASE = 8;
    private const int CMD_RELAY_GRAB = 9;
    private const int CMD_RELAY_RELEASE = 10;

    private const int EV_POWER_ON = 1;
    private const int EV_POWER_OFF = 2;
    private const int EV_BREAKER_TRIP = 3;
    private const int EV_BREAKER_RESET = 4;
    private const int EV_RELAY_PULL = 5;
    private const int EV_RELAY_DROP = 6;
    private const int EV_CONTACT_MAKE = 7;
    private const int EV_CONTACT_BREAK = 8;
    private const int EV_LAMP_ON = 9;
    private const int EV_LAMP_OFF = 10;
    private const int EV_DIAL_MAKE = 11;
    private const int EV_DIAL_BREAK = 12;
    private const int EV_CHATTER = 13;

    private static readonly CmdResult CMD_OK = new CmdResult.Success();
    private static readonly CmdResult BAD_CORD_ID = new CmdResult.Failure(CmdWhy.bad_cord_id);
    private static readonly CmdResult CORD_EXISTS = new CmdResult.Failure(CmdWhy.cord_exists);
    private static readonly CmdResult UNKNOWN_CORD = new CmdResult.Failure(CmdWhy.unknown_cord);
    private static readonly CmdResult UNKNOWN_HOLE = new CmdResult.Failure(CmdWhy.unknown_hole);
    private static readonly CmdResult UNKNOWN_TERMINAL = new CmdResult.Failure(CmdWhy.unknown_terminal);
    private static readonly CmdResult HOLE_OCCUPIED = new CmdResult.Failure(CmdWhy.hole_occupied);
    private static readonly CmdResult BAD_TARGET = new CmdResult.Failure(CmdWhy.bad_target);

    private readonly LoadedNetlist netlist;
    private readonly Profile profile;
    private readonly SolveCfg cfg;
    private readonly GraphWorkspace graph;
    private readonly SolveWorkspace solve;
    private readonly Carried carried;
    private readonly PortFlags flags = new();

    private readonly MoverBank relays = Movers();
    private readonly MoverBank buttons = Movers();
    private readonly MoverBank switches = Movers();
    private readonly int[] buttonTargets = new int[SECTIONS];
    private readonly int[] switchTargets = new int[SECTIONS];
    private readonly int[] relayTargets = new int[SECTIONS];
    private readonly byte[] relayHeld = new byte[SECTIONS];
    private readonly byte[] relayHeldPriorTick = new byte[SECTIONS];
    private readonly sbyte[] relayLastPhysicalDir = new sbyte[SECTIONS];
    private readonly RotaryState rotary;
    private readonly BreakerState breaker = new();

    private readonly CordTable actual = new();
    private readonly CordTable projected = new();
    private readonly CordView cords = new();
    private readonly PrimitiveStore commandStore = new();
    private readonly PrimitiveStore eventStore = new();
    private readonly PrimitiveStore dialEventStore = new();

    private readonly sbyte[] contactBefore = new sbyte[CONTACTS];
    private readonly sbyte[] contactAfter = new sbyte[CONTACTS];
    private readonly GraphInput graphInput;
    private readonly int[] priorTravel = new int[SECTIONS * 3];
    private readonly sbyte[] relayDirection = new sbyte[SECTIONS];
    private int? priorDialContact;

    private readonly int[] nodeMv = new int[Graph.GRAPH_MAX_NODES];
    private readonly int[] elementMv = new int[Graph.GRAPH_MAX_ELEMENTS];
    private readonly int[] elementAbsMv = new int[Graph.GRAPH_MAX_ELEMENTS];
    private readonly int[] terminalMv = new int[Graph.GRAPH_TERMINALS];
    private readonly byte[] terminalFloating = new byte[Graph.GRAPH_TERMINALS];
    private readonly int[] relayCoilMv = new int[SECTIONS];
    private readonly int[] relayCoilUa = new int[SECTIONS];
    private readonly int[] relayIndicatorUa = new int[SECTIONS];
    private readonly byte[] relayCoilShorted = new byte[SECTIONS];
    private readonly int[] outLampUa = new int[SECTIONS];
    private readonly int[] indLampUa = new int[SECTIONS];
    private readonly int[] outLampMilli = new int[SECTIONS];
    private readonly int[] indLampMilli = new int[SECTIONS];
    private readonly sbyte[] outLampClass = new sbyte[SECTIONS];
    private readonly sbyte[] indLampClass = new sbyte[SECTIONS];
    private readonly sbyte[] beforeLampClass = new sbyte[LAMPS];
    private int railMv;
    private int supplyUa;
    private bool overCurrent;

    private readonly short[] outElement = new short[SECTIONS];
    private readonly short[] indElement = new short[SECTIONS];
    private readonly short[] coilElement = new short[SECTIONS];
    private readonly sbyte[] outCarried = new sbyte[SECTIONS];
    private readonly sbyte[] indCarried = new sbyte[SECTIONS];
    private readonly sbyte[] relaySet1Row = new sbyte[SECTIONS];
    private readonly sbyte[] relaySet2Row = new sbyte[SECTIONS];
    private readonly sbyte[] buttonRow = new sbyte[SECTIONS];
    private readonly sbyte[] switchSet1Row = new sbyte[SECTIONS];
    private readonly sbyte[] switchSet2Row = new sbyte[SECTIONS];
    private int motorElement = -1;
    private int motorA = -1;
    private int motorB = -1;
    private int plusTerminal = -1;

    private readonly string[] holeIds = new string[Terminals.HOLE_COUNT];
    private readonly sbyte[] validatedKind = new sbyte[2];
    private readonly short[] validatedTerminal = new short[2];
    private readonly short[] validatedHole = new short[2];

    private readonly int[] publicObservables = new int[Trace.OBSERVABLE_COUNT];
    private readonly int[] currentObservables = new int[Trace.OBSERVABLE_COUNT];
    private readonly int[] previousObservables = new int[Trace.OBSERVABLE_COUNT];
    private readonly ChatterWorkspace chatter;

    private int steadyTicks;
    private readonly byte[] noteCoil = new byte[SECTIONS];
    private readonly byte[] noteLamp = new byte[SECTIONS];
    private readonly int[] noteLampMv = new int[SECTIONS];
    private readonly short[] noteDropCount = new short[SECTIONS];
    private readonly short[] noteDropElement = new short[SECTIONS * NOTE_STRIDE];
    private readonly int[] noteDropMv = new int[SECTIONS * NOTE_STRIDE];
    private readonly byte[] chainVisited = new byte[Graph.GRAPH_MAX_ELEMENTS];

    private readonly string netlistHash;
    private readonly string profileHash;
    private bool power;
    private int tick;
    /// <summary>Tick of the last dial chatter reseed (coast or reversal) this power epoch; -1 for none.</summary>
    private int lastDialReseedTick = -1;

    private readonly ContactEdgeSink contactSink;
    private readonly RotaryEdgeSink rotarySink;

    internal MachineImpl(LoadedNetlist netlist, Profile profile)
    {
        this.netlist = netlist;
        this.profile = CopyProfile(profile);
        cfg = SolveConfig(this.profile);
        graph = Graph.createGraphWorkspace();
        solve = Solve.createSolveWorkspace();
        carried = new Carried(new double[SECTIONS], new double[LAMPS]);
        Array.Fill(carried.rLamp, this.profile.v.R_cold_uohm * 1e-6);
        rotary = Rotary.createRotaryState(this.profile);
        chatter = Trace.createChatterWorkspace(this.profile);
        graphInput = new GraphInput(cords, new SByteIntView(contactBefore));
        netlistHash = "fnv1a64:" + netlist.hash;
        profileHash = "fnv1a64:" + this.profile.hash;

        Array.Fill(outElement, (short)-1);
        Array.Fill(indElement, (short)-1);
        Array.Fill(coilElement, (short)-1);
        Array.Fill(relaySet1Row, (sbyte)-1);
        Array.Fill(relaySet2Row, (sbyte)-1);
        Array.Fill(buttonRow, (sbyte)-1);
        Array.Fill(switchSet1Row, (sbyte)-1);
        Array.Fill(switchSet2Row, (sbyte)-1);
        IndexNetlist();
        IndexHoles();

        contactSink = RecordContactEdge;
        rotarySink = RecordRotaryEdge;

        WriteContacts(contactBefore);
        Array.Copy(contactBefore, contactAfter, contactBefore.Length);
        RebuildCordView();
        Graph.buildGraphInto(netlist, this.profile, graphInput, false, graph);
        Solve.tickSolveGraphInto(graph, carried, cfg, solve);
        QuantizeElectrical(false);
        WriteObservables(currentObservables);
        Array.Copy(currentObservables, previousObservables, currentObservables.Length);
        Trace.resetChatter(chatter, currentObservables);
    }

    private static MoverBank Movers() => new(new int[SECTIONS], new sbyte[SECTIONS], new int[SECTIONS]);

    private static Profile CopyProfile(Profile source)
    {
        var values = new long[Profile.SCALAR_KEYS.Count];
        for (var i = 0; i < values.Length; i++) values[i] = source.v.At(i);
        var relayPullIn = new int[SECTIONS];
        var relayDropOut = new int[SECTIONS];
        for (var i = 0; i < SECTIONS; i++)
        {
            relayPullIn[i] = source.derived.relayPullInUa[i];
            relayDropOut[i] = source.derived.relayDropOutUa[i];
        }
        var derived = new Derived(
            source.derived.pullInUa, source.derived.dropOutUa,
            Array.AsReadOnly(relayPullIn), Array.AsReadOnly(relayDropOut),
            source.derived.relayOperateTicks, source.derived.relayReleaseTicks,
            source.derived.pushbuttonTicks, source.derived.slideTicks,
            source.derived.kThermal, source.derived.arcStepUa,
            source.derived.tripDelayTicks, source.derived.deadShortUa,
            source.derived.rMotorParUohm, source.derived.vMotorRunMv,
            source.derived.relayCycleTicks, source.derived.buttonCycleTicks,
            source.derived.switchCycleTicks, source.derived.dialCycleTicks,
            source.derived.settleCapTicks);
        var dVRelayMv = new long[source.dVRelayMv.Count];
        for (var i = 0; i < dVRelayMv.Length; i++) dVRelayMv[i] = source.dVRelayMv[i];
        var pwl = new PwlPoint[source.pwl.Count];
        for (var i = 0; i < pwl.Length; i++) pwl[i] = new PwlPoint(source.pwl[i][0], source.pwl[i][1]);
        return new Profile(
            source.id, source.marginal, source.provenance, source.hash,
            new Profile.Values(values), Array.AsReadOnly(dVRelayMv), Array.AsReadOnly(pwl), derived);
    }

    private static SolveCfg SolveConfig(Profile profile)
    {
        var xs = new double[profile.pwl.Count];
        var ys = new double[profile.pwl.Count];
        for (var i = 0; i < profile.pwl.Count; i++)
        {
            xs[i] = profile.pwl[i][0] * 1e-6;
            ys[i] = profile.pwl[i][1] * 1e-6;
        }
        return new SolveCfg(
            profile.v.tick_us * 1e-6,
            profile.v.V_arc_clamp_mv * 1e-3,
            profile.derived.kThermal,
            profile.v.gmin_ns * 1e-9,
            new Pwl(xs, ys),
            0);
    }

    private void IndexNetlist()
    {
        var lampCarried = 0;
        for (var i = 0; i < netlist.elements.Count; i++)
        {
            var element = netlist.elements[i];
            switch (element)
            {
                case LampDef lamp:
                    var section = lamp.id[^1] - '1';
                    if (lamp.id.StartsWith("out", StringComparison.Ordinal))
                    {
                        outElement[section] = (short)i;
                        outCarried[section] = (sbyte)lampCarried;
                    }
                    else
                    {
                        indElement[section] = (short)i;
                        indCarried[section] = (sbyte)lampCarried;
                    }
                    lampCarried++;
                    break;
                case CoilDef coil:
                    coilElement[coil.relay - 1] = (short)i;
                    break;
                case ResDef resistor when resistor.drives == ResDrive.dial:
                    motorElement = i;
                    motorA = Terminals.terminalIndex(resistor.a);
                    motorB = Terminals.terminalIndex(resistor.b);
                    break;
            }
        }
        for (var i = 0; i < netlist.contacts.Count; i++)
        {
            switch (netlist.contacts[i])
            {
                case RelayContactDef relay when relay.set == 1:
                    relaySet1Row[relay.n - 1] = (sbyte)i;
                    break;
                case RelayContactDef relay:
                    relaySet2Row[relay.n - 1] = (sbyte)i;
                    break;
                case ButtonContactDef button:
                    buttonRow[button.n - 1] = (sbyte)i;
                    break;
                case SlideContactDef slide when slide.set == 1:
                    switchSet1Row[slide.n - 1] = (sbyte)i;
                    break;
                case SlideContactDef slide:
                    switchSet2Row[slide.n - 1] = (sbyte)i;
                    break;
            }
        }
        plusTerminal = Terminals.terminalIndex(netlist.plusMembers[0]);
        if (lampCarried != LAMPS || motorElement < 0 || plusTerminal < 0)
            throw new MachineException("validated netlist indexes are incomplete");
    }

    private void IndexHoles()
    {
        for (var hole = 0; hole < Terminals.HOLE_COUNT; hole++)
            holeIds[hole] = Terminals.holeByIndex(hole).id;
    }

    public CmdResult Apply(Command command)
    {
        if (command is Command.Connect connect)
        {
            var id = connect.cord;
            if (id < 0 || id >= Graph.GRAPH_MAX_CORDS) return BAD_CORD_ID;
            if (projected.live[id] != 0) return CORD_EXISTS;
            var invalidA = ValidateEnd(0, connect.a);
            if (invalidA is not null) return invalidA;
            var invalidB = ValidateEnd(1, connect.b);
            if (invalidB is not null) return invalidB;
            var resistance = connect.r_uohm ?? 0;
            if (resistance < 0 || resistance > int.MaxValue) return BAD_TARGET;
            var aHole = validatedHole[0];
            var bHole = validatedHole[1];
            if (aHole >= 0 && projected.holeOwner[aHole] >= 0) return HOLE_OCCUPIED;
            if (bHole >= 0 && bHole == aHole) return HOLE_OCCUPIED;
            if (bHole >= 0 && projected.holeOwner[bHole] >= 0) return HOLE_OCCUPIED;
            SetCord(projected, id, validatedKind[0], validatedTerminal[0], aHole,
                validatedKind[1], validatedTerminal[1], bHole, (int)resistance);
            commandStore.Append(CMD_CONNECT, id, validatedKind[0], validatedTerminal[0], aHole,
                validatedKind[1], validatedTerminal[1], bHole, (int)resistance);
            return CMD_OK;
        }
        if (command is Command.Disconnect disconnect)
        {
            var id = disconnect.cord;
            if (id < 0 || id >= Graph.GRAPH_MAX_CORDS) return BAD_CORD_ID;
            if (projected.live[id] == 0) return UNKNOWN_CORD;
            RemoveCord(projected, id);
            commandStore.Append(CMD_DISCONNECT, id);
            return CMD_OK;
        }
        switch (command)
        {
            case Command.Power value:
                commandStore.Append(CMD_POWER, value.on ? 1 : 0);
                return CMD_OK;
            case Command.Breaker:
                commandStore.Append(CMD_BREAKER);
                return CMD_OK;
            case Command.Button value:
                return QueueTarget(CMD_BUTTON, value.n, value.target);
            case Command.Switch value:
                return QueueTarget(CMD_SWITCH, value.n, value.target);
            case Command.RelayGrab value:
                return QueueTarget(CMD_RELAY_GRAB, value.n, value.target);
            case Command.RelayRelease value:
                if (value.n < 1 || value.n > SECTIONS) return BAD_TARGET;
                commandStore.Append(CMD_RELAY_RELEASE, value.n - 1);
                return CMD_OK;
            case Command.DialGrab value:
                if (value.targetUdeg < 0 || value.targetUdeg >= 360_000_000) return BAD_TARGET;
                commandStore.Append(CMD_DIAL_GRAB, (int)value.targetUdeg);
                return CMD_OK;
            case Command.DialRelease:
                commandStore.Append(CMD_DIAL_RELEASE);
                return CMD_OK;
            default:
                return BAD_TARGET;
        }
    }

    private CmdResult QueueTarget(int tag, int n, int target)
    {
        if (n < 1 || n > SECTIONS || target < 0 || target > 1000) return BAD_TARGET;
        commandStore.Append(tag, n - 1, target);
        return CMD_OK;
    }

    public void Advance(int ticks)
    {
        if (ticks < 0)
            throw new ArgumentOutOfRangeException(nameof(ticks), "machine: ticks must be an int32 in 0..2147483647");
        if (ticks == 0) return;
        if (!QueuedPowerRise() && tick > int.MaxValue - ticks)
            throw new ArgumentOutOfRangeException(nameof(ticks), "machine: tick would exceed int32");
        for (var i = 0; i < ticks; i++) AdvanceOne();
    }

    public int[] Observables()
    {
        WriteObservables(publicObservables);
        return publicObservables;
    }

    public int MotionMask()
    {
        var mask = 0;
        for (var n = 0; n < SECTIONS; n++)
        {
            if (relays.dir[n] != 0) mask |= 1 << n;
            if (buttons.dir[n] != 0) mask |= 1 << (SECTIONS + n);
            if (switches.dir[n] != 0) mask |= 1 << (SECTIONS * 2 + n);
        }
        return mask;
    }

    public State Snapshot()
    {
        var relayStates = new State.Relay[SECTIONS];
        var outLamps = new State.Lamp[SECTIONS];
        var indLamps = new State.Lamp[SECTIONS];
        var buttonStates = new State.Button[SECTIONS];
        var switchStates = new State.Switch[SECTIONS];
        for (var n = 0; n < SECTIONS; n++)
        {
            var set1 = contactAfter[relaySet1Row[n]];
            var set2 = contactAfter[relaySet2Row[n]];
            var button = contactAfter[buttonRow[n]];
            var sw1 = contactAfter[switchSet1Row[n]];
            var sw2 = contactAfter[switchSet2Row[n]];
            var coilUa = relayCoilUa[n];
            var pullInUa = profile.derived.relayPullInUa[n];
            var dropOutUa = profile.derived.relayDropOutUa[n];
            relayStates[n] = new State.Relay(
                relays.travel[n], relayCoilMv[n], coilUa, pullInUa, dropOutUa,
                Devices.relayBand(coilUa, pullInUa, dropOutUa), relayCoilShorted[n] != 0,
                new State.RelayContacts(set1 == Graph.CONTACT_NC, set1 == Graph.CONTACT_NO),
                new State.RelayContacts(set2 == Graph.CONTACT_NC, set2 == Graph.CONTACT_NO),
                relayIndicatorUa[n], relayHeld[n] != 0);
            outLamps[n] = new State.Lamp(outLampUa[n], outLampMilli[n], ClassFromCode(outLampClass[n]));
            indLamps[n] = new State.Lamp(indLampUa[n], indLampMilli[n], ClassFromCode(indLampClass[n]));
            buttonStates[n] = new State.Button(buttons.travel[n], button == Graph.CONTACT_NC, button == Graph.CONTACT_NO);
            switchStates[n] = new State.Switch(switches.travel[n], ClosedPair(sw1), ClosedPair(sw2));
        }

        var cordCount = 0;
        for (var id = 0; id < Graph.GRAPH_MAX_CORDS; id++) if (actual.live[id] != 0) cordCount++;
        var cordStates = new State.Cord[cordCount];
        var cordAt = 0;
        for (var id = 0; id < Graph.GRAPH_MAX_CORDS; id++)
        {
            if (actual.live[id] == 0) continue;
            cordStates[cordAt++] = new State.Cord(id,
                MaterializeEnd(actual.aKind[id], actual.aTerminal[id], actual.aHole[id]),
                MaterializeEnd(actual.bKind[id], actual.bTerminal[id], actual.bHole[id]),
                actual.rUohm[id]);
        }

        var terminalState = new int?[Graph.GRAPH_TERMINALS];
        for (var i = 0; i < terminalState.Length; i++)
            terminalState[i] = terminalFloating[i] != 0 ? null : terminalMv[i];
        var chatterCount = 0;
        for (var i = 0; i < Trace.CHATTER_DEVICE_COUNT; i++) if (chatter.suppressed[i] != 0) chatterCount++;
        var chattering = new ChatterDev[chatterCount];
        var chatterAt = 0;
        for (var i = 0; i < Trace.CHATTER_DEVICE_COUNT; i++)
            if (chatter.suppressed[i] != 0) chattering[chatterAt++] = Trace.CHATTER_DEVICES[i];

        return new State(
            Contract.CONTRACT, netlistHash, profile.id, profileHash, tick, power, breaker.tripped,
            railMv, supplyUa, relayStates, outLamps, indLamps, buttonStates, switchStates,
            new State.Dial(rotary.udeg, rotary.contact, rotary.mrpm, rotary.held),
            cordStates, terminalState, MaterializeNotes(),
            new State.Flags(chattering, overCurrent, flags.nonPortable));
    }

    public Event[] DrainEvents()
    {
        var events = new Event[eventStore.count];
        var at = 0;
        var page = eventStore.head;
        while (page is not null)
        {
            for (var i = 0; i < page.end; i++)
            {
                var tag = page.tag[i];
                var t = page.f0[i];
                events[at++] = tag switch
                {
                    EV_POWER_ON => new Event.PowerOn(t),
                    EV_POWER_OFF => new Event.PowerOff(t),
                    EV_BREAKER_TRIP => new Event.BreakerTrip(t),
                    EV_BREAKER_RESET => new Event.BreakerReset(t),
                    EV_RELAY_PULL => new Event.RelayPullIn(t, page.f1[i] + 1, page.f2[i], page.f3[i]),
                    EV_RELAY_DROP => new Event.RelayDropOut(t, page.f1[i] + 1, page.f2[i], page.f3[i]),
                    EV_CONTACT_MAKE => new Event.ContactMake(t, Terminals.TERMINAL_IDS[page.f1[i]], Terminals.TERMINAL_IDS[page.f2[i]]),
                    EV_CONTACT_BREAK => new Event.ContactBreak(t, Terminals.TERMINAL_IDS[page.f1[i]], Terminals.TERMINAL_IDS[page.f2[i]]),
                    EV_LAMP_ON => new Event.LampOn(t, page.f1[i] == 0 ? Event.LampKind.@out : Event.LampKind.ind, page.f2[i] + 1),
                    EV_LAMP_OFF => new Event.LampOff(t, page.f1[i] == 0 ? Event.LampKind.@out : Event.LampKind.ind, page.f2[i] + 1),
                    EV_DIAL_MAKE => new Event.DialMake(t, page.f1[i]),
                    EV_DIAL_BREAK => new Event.DialBreak(t, page.f1[i]),
                    EV_CHATTER => new Event.Chatter(t, Trace.CHATTER_DEVICES[page.f1[i]], page.f2[i], page.f3[i], page.f4[i]),
                    _ => throw new InvalidOperationException("machine: unknown retained event tag"),
                };
            }
            page = page.next;
        }
        eventStore.Clear();
        return events;
    }

    private CmdResult? ValidateEnd(int at, CordEnd end)
    {
        validatedKind[at] = END_FREE;
        validatedTerminal[at] = -1;
        validatedHole[at] = -1;
        if (end is CordEnd.Free) return null;
        if (end is CordEnd.Hole hole)
        {
            try
            {
                var reference = Terminals.parseHoleId(hole.hole);
                validatedKind[at] = END_HOLE;
                validatedTerminal[at] = (short)Terminals.terminalIndex(reference.terminal);
                validatedHole[at] = (short)reference.index;
                return null;
            }
            catch (TerminalsException)
            {
                return UNKNOWN_HOLE;
            }
        }
        if (end is CordEnd.Touch touch)
        {
            try
            {
                var terminal = Terminals.parseTerminalId(touch.term);
                validatedKind[at] = END_TOUCH;
                validatedTerminal[at] = (short)Terminals.terminalIndex(terminal);
                return null;
            }
            catch (TerminalsException)
            {
                return UNKNOWN_TERMINAL;
            }
        }
        return BAD_TARGET;
    }

    private static void SetCord(
        CordTable table, int id, int aKind, int aTerminal, int aHole,
        int bKind, int bTerminal, int bHole, int resistance)
    {
        table.live[id] = 1;
        table.aKind[id] = (sbyte)aKind;
        table.aTerminal[id] = (short)aTerminal;
        table.aHole[id] = (short)aHole;
        table.bKind[id] = (sbyte)bKind;
        table.bTerminal[id] = (short)bTerminal;
        table.bHole[id] = (short)bHole;
        table.rUohm[id] = resistance;
        if (aHole >= 0) table.holeOwner[aHole] = (short)id;
        if (bHole >= 0) table.holeOwner[bHole] = (short)id;
    }

    private static void RemoveCord(CordTable table, int id)
    {
        var aHole = table.aHole[id];
        var bHole = table.bHole[id];
        if (aHole >= 0) table.holeOwner[aHole] = -1;
        if (bHole >= 0) table.holeOwner[bHole] = -1;
        table.live[id] = 0;
        table.aKind[id] = END_FREE;
        table.aTerminal[id] = -1;
        table.aHole[id] = -1;
        table.bKind[id] = END_FREE;
        table.bTerminal[id] = -1;
        table.bHole[id] = -1;
        table.rUohm[id] = 0;
    }

    private CordEnd MaterializeEnd(int kind, int terminal, int hole)
    {
        if (kind == END_HOLE) return new CordEnd.Hole(holeIds[hole]);
        if (kind == END_TOUCH) return new CordEnd.Touch(Terminals.TERMINAL_IDS[terminal]);
        return new CordEnd.Free();
    }

    private bool QueuedPowerRise()
    {
        var projectedPower = power;
        var rise = false;
        var page = commandStore.head;
        while (page is not null)
        {
            for (var i = 0; i < page.end; i++)
            {
                if (page.tag[i] != CMD_POWER) continue;
                var next = page.f0[i] != 0;
                if (!projectedPower && next) rise = true;
                projectedPower = next;
            }
            page = page.next;
        }
        return rise;
    }

    private void ApplyQueuedCommands()
    {
        var page = commandStore.head;
        while (page is not null)
        {
            for (var i = 0; i < page.end; i++)
            {
                var tag = page.tag[i];
                if (tag == CMD_POWER)
                {
                    var next = page.f0[i] != 0;
                    if (next != power)
                    {
                        if (next) BeginPowerEpoch();
                        else
                        {
                            power = false;
                            Devices.clearBreakerDwell(breaker);
                            eventStore.Append(EV_POWER_OFF, tick);
                        }
                    }
                }
                else if (tag == CMD_BREAKER)
                {
                    if (Devices.resetBreaker(breaker)) eventStore.Append(EV_BREAKER_RESET, tick);
                }
                else if (tag == CMD_CONNECT)
                    SetCord(actual, page.f0[i], page.f1[i], page.f2[i], page.f3[i],
                        page.f4[i], page.f5[i], page.f6[i], page.f7[i]);
                else if (tag == CMD_DISCONNECT) RemoveCord(actual, page.f0[i]);
                else if (tag == CMD_BUTTON) buttonTargets[page.f0[i]] = page.f1[i];
                else if (tag == CMD_SWITCH) switchTargets[page.f0[i]] = page.f1[i];
                else if (tag == CMD_RELAY_GRAB)
                {
                    var n = page.f0[i];
                    relayHeld[n] = 1;
                    relayTargets[n] = page.f1[i];
                }
                else if (tag == CMD_RELAY_RELEASE) relayHeld[page.f0[i]] = 0;
                else if (tag == CMD_DIAL_GRAB) Rotary.grabRotary(rotary, page.f0[i]);
                else if (tag == CMD_DIAL_RELEASE) Rotary.releaseRotary(rotary);
            }
            page = page.next;
        }
        commandStore.Clear();
    }

    private void BeginPowerEpoch()
    {
        eventStore.Clear();
        dialEventStore.Clear();
        tick = 0;
        lastDialReseedTick = -1;
        Devices.coldResetElectrical(relays, carried.iCoil, carried.rLamp,
            profile.v.R_cold_uohm * 1e-6, relayHeld, relayLastPhysicalDir);
        steadyTicks = 0;
        ClearNotes();
        Array.Clear(outLampUa);
        Array.Clear(indLampUa);
        Array.Clear(outLampMilli);
        Array.Clear(indLampMilli);
        Array.Clear(outLampClass);
        Array.Clear(indLampClass);
        power = true;
        WriteContacts(contactAfter);
        WriteObservables(currentObservables);
        Array.Copy(currentObservables, previousObservables, currentObservables.Length);
        Trace.resetChatter(chatter, currentObservables);
        eventStore.Append(EV_POWER_ON, 0);
    }

    private void AdvanceOne()
    {
        var latchedTrip = Devices.latchBreakerPending(breaker);
        ApplyQueuedCommands();
        if (Devices.applyLatchedBreakerTrip(breaker, latchedTrip))
            eventStore.Append(EV_BREAKER_TRIP, tick);

        WriteContacts(contactBefore);
        Array.Copy(contactBefore, contactAfter, contactBefore.Length);
        for (var n = 0; n < SECTIONS; n++)
        {
            priorTravel[n] = relays.travel[n];
            priorTravel[SECTIONS + n] = buttons.travel[n];
            priorTravel[SECTIONS * 2 + n] = switches.travel[n];
            beforeLampClass[n] = outLampClass[n];
            beforeLampClass[SECTIONS + n] = indLampClass[n];
        }
        priorDialContact = rotary.contact;

        RebuildCordView();
        var enabled = Devices.sourceEnabled(power, breaker);
        Graph.buildGraphInto(netlist, profile, graphInput, enabled, graph);
        Solve.tickSolveGraphInto(graph, carried, cfg, solve);
        if (solve.nonPortable) flags.nonPortable = true;
        QuantizeElectrical(enabled);
        overCurrent = Devices.sampleBreaker(
            breaker, enabled, supplyUa, (int)profile.v.I_trip_ua,
            profile.derived.deadShortUa, profile.derived.tripDelayTicks);

        int? motorMv;
        var motor = graph.elements[motorElement];
        if (enabled && solve.floating[motor.a] == 0 && solve.floating[motor.b] == 0)
            motorMv = elementMv[motorElement];
        else
            motorMv = enabled ? null : 0;
        var stopShorted = graph.nodeByTerminal[motorA] == graph.nodeByTerminal[motorB];
        var priorMotorMrpm = rotary.lastMotorMrpm;
        // A mover mid-stroke may be about to short STOP; stepRotary then waits to pick the coast.
        var moversInTransit = MotionMask() != 0;
        Rotary.stepRotary(rotary, motorMv, enabled, stopShorted, moversInTransit, profile, flags, rotarySink);
        // Architecture §9.2: a coast to zero drive is a modelled discontinuity, so the dial's chatter history
        // is reseeded. A drive-sign reversal (immediate, or resumed after a TRANSFER-COAST-DEFER hold) is one
        // too, but is forgiven at most once per dial chatter window and never while the dial is suppressed:
        // repeated reversals are what a hunting oscillation is made of, and must still trip the detector.
        const int dial = Trace.CHATTER_DEVICE_COUNT - 1;
        var dialCoast = priorMotorMrpm != 0 && rotary.lastMotorMrpm == 0;
        var dialReversal = priorMotorMrpm != 0 && rotary.lastMotorMrpm != 0 &&
            (rotary.lastMotorMrpm < 0) != (priorMotorMrpm < 0) &&
            (lastDialReseedTick < 0 ||
                tick - lastDialReseedTick >= chatter.windowTicks[dial]) &&
            chatter.suppressed[dial] == 0;
        var dialReseed = dialCoast || dialReversal;
        if (dialReseed) lastDialReseedTick = tick;

        for (var n = 0; n < SECTIONS; n++)
        {
            if (relayHeld[n] != 0)
            {
                var target = relayTargets[n];
                var ticks = target < relays.travel[n]
                    ? profile.derived.relayReleaseTicks : profile.derived.relayOperateTicks;
                Devices.advanceTargetMover(relays, n, target, ticks);
                relayDirection[n] = Devices.RELAY_NO_EVENT;
            }
            else
            {
                var direction = Devices.advanceRelay(
                    relays, n, relayCoilUa[n], profile.derived.relayPullInUa[n],
                    profile.derived.relayDropOutUa[n], profile.derived.relayOperateTicks,
                    profile.derived.relayReleaseTicks,
                    relayHeldPriorTick[n] != 0 ? relayLastPhysicalDir[n] : 0);
                relayDirection[n] = (sbyte)(relayHeldPriorTick[n] != 0 ? Devices.RELAY_NO_EVENT : direction);
            }
            var delta = relays.travel[n] - priorTravel[n];
            if (delta != 0) relayLastPhysicalDir[n] = (sbyte)(delta > 0 ? 1 : -1);
        }
        for (var n = 0; n < SECTIONS; n++)
            Devices.advanceTargetMover(buttons, n, buttonTargets[n], profile.derived.pushbuttonTicks);
        for (var n = 0; n < SECTIONS; n++)
            Devices.advanceTargetMover(switches, n, switchTargets[n], profile.derived.slideTicks);

        WriteContacts(contactAfter);
        EmitMoverEvents();
        dialEventStore.CopyInto(eventStore);
        EmitLampEvents();
        FinishObservablesAndNotes(dialReseed);
        Array.Copy(relayHeld, relayHeldPriorTick, relayHeld.Length);
        tick++;
    }

    private void WriteContacts(sbyte[] output) => Devices.writeContactPositions(
        netlist, relays, buttons, switches, rotary.contact,
        profile.v.break_milli, profile.v.make_milli, output);

    private void RebuildCordView()
    {
        var at = 0;
        for (var id = 0; id < Graph.GRAPH_MAX_CORDS; id++)
        {
            if (actual.live[id] == 0) continue;
            var slot = cords.Slot(at);
            slot.id = id;
            slot.a = actual.aTerminal[id];
            slot.b = actual.bTerminal[id];
            slot.rUohm = actual.rUohm[id];
            at++;
        }
        cords.Count = at;
    }

    private void QuantizeElectrical(bool enabled)
    {
        for (var node = 0; node < graph.nodeCount; node++)
        {
            if (node == graph.datum || solve.floating[node] != 0) nodeMv[node] = 0;
            else nodeMv[node] = Ints.quantize(solve.v[node], 1000, flags);
        }
        for (var element = 0; element < graph.elementCount; element++)
        {
            if (!enabled)
            {
                elementMv[element] = 0;
                elementAbsMv[element] = 0;
                continue;
            }
            var definition = graph.elements[element];
            if (solve.floating[definition.a] != 0 || solve.floating[definition.b] != 0)
            {
                elementMv[element] = 0;
                elementAbsMv[element] = 0;
            }
            else
            {
                var branchV = solve.v[definition.a] - solve.v[definition.b];
                elementMv[element] = Ints.quantize(branchV, 1000, flags);
                elementAbsMv[element] = Ints.quantize(Math.Abs(branchV), 1000, flags);
            }
        }
        for (var terminal = 0; terminal < Graph.GRAPH_TERMINALS; terminal++)
        {
            var node = graph.nodeByTerminal[terminal];
            if (node == graph.datum)
            {
                terminalMv[terminal] = 0;
                terminalFloating[terminal] = 0;
            }
            else if (solve.floating[node] != 0)
            {
                terminalMv[terminal] = 0;
                terminalFloating[terminal] = 1;
            }
            else
            {
                terminalMv[terminal] = nodeMv[node];
                terminalFloating[terminal] = 0;
            }
        }
        if (!enabled)
        {
            railMv = 0;
            supplyUa = 0;
        }
        else
        {
            railMv = Ints.quantize(solve.v[graph.nodeByTerminal[plusTerminal]], 1000, flags);
            supplyUa = Ints.quantize(Math.Abs(solve.branchI[graph.elementCount - 1]), 1_000_000, flags);
        }
        for (var n = 0; n < SECTIONS; n++)
        {
            var coil = coilElement[n];
            var indicator = indElement[n];
            var output = outElement[n];
            var coilDefinition = graph.elements[coil];
            relayCoilMv[n] = elementAbsMv[coil];
            relayCoilUa[n] = enabled ? Ints.quantize(Math.Abs(solve.branchI[coil]), 1_000_000, flags) : 0;
            relayIndicatorUa[n] = enabled ? Ints.quantize(Math.Abs(solve.branchI[indicator]), 1_000_000, flags) : 0;
            relayCoilShorted[n] = coilDefinition.a == coilDefinition.b ? (byte)1 : (byte)0;
            outLampUa[n] = enabled ? Ints.quantize(Math.Abs(solve.branchI[output]), 1_000_000, flags) : 0;
            indLampUa[n] = relayIndicatorUa[n];
            outLampMilli[n] = Devices.lampBrightnessMilli(
                carried.rLamp[outCarried[n]], profile.v.R_cold_uohm * 1e-6, profile.v.R_hot_uohm * 1e-6);
            indLampMilli[n] = Devices.lampBrightnessMilli(
                carried.rLamp[indCarried[n]], profile.v.R_cold_uohm * 1e-6, profile.v.R_hot_uohm * 1e-6);
            outLampClass[n] = ClassCode(Devices.lampClass(outLampMilli[n], profile.v.lamp_dim_milli, profile.v.lamp_on_milli));
            indLampClass[n] = ClassCode(Devices.lampClass(indLampMilli[n], profile.v.lamp_dim_milli, profile.v.lamp_on_milli));
        }
    }

    private void EmitMoverEvents()
    {
        for (var n = 0; n < SECTIONS; n++)
        {
            var direction = relayDirection[n];
            if (direction != Devices.RELAY_NO_EVENT)
            {
                var coilUa = relayCoilUa[n];
                var pull = profile.derived.relayPullInUa[n];
                var drop = profile.derived.relayDropOutUa[n];
                eventStore.Append(direction == Devices.RELAY_PULL_IN ? EV_RELAY_PULL : EV_RELAY_DROP,
                    tick, n, coilUa, Devices.relayMarginUa(direction, coilUa, pull, drop));
            }
            EmitContactRow(relaySet1Row[n]);
            EmitContactRow(relaySet2Row[n]);
        }
        for (var n = 0; n < SECTIONS; n++) EmitContactRow(buttonRow[n]);
        for (var n = 0; n < SECTIONS; n++)
        {
            EmitContactRow(switchSet1Row[n]);
            EmitContactRow(switchSet2Row[n]);
        }
    }

    private void EmitContactRow(int index)
    {
        var row = netlist.contacts[index];
        if (row is WiperContactDef) return;
        Devices.emitTransferEdges(row, contactBefore[index], contactAfter[index], contactSink);
    }

    private void RecordContactEdge(ContactEdge edge, string arm, string to) => eventStore.Append(
        edge == ContactEdge.make ? EV_CONTACT_MAKE : EV_CONTACT_BREAK,
        tick, Terminals.terminalIndex(arm), Terminals.terminalIndex(to));

    private void RecordRotaryEdge(RotaryEdgeKind kind, int pos) =>
        dialEventStore.Append(kind == RotaryEdgeKind.make ? EV_DIAL_MAKE : EV_DIAL_BREAK, tick, pos);

    private void EmitLampEvents()
    {
        for (var n = 0; n < SECTIONS; n++) EmitLampEvent(0, n, beforeLampClass[n], outLampClass[n]);
        for (var n = 0; n < SECTIONS; n++) EmitLampEvent(1, n, beforeLampClass[SECTIONS + n], indLampClass[n]);
    }

    private void EmitLampEvent(int kind, int n, int before, int after)
    {
        var eventCode = Devices.lampClassEvent(ClassFromCode(before), ClassFromCode(after));
        if (eventCode == Devices.LAMP_NO_EVENT) return;
        eventStore.Append(eventCode == Devices.LAMP_OFF ? EV_LAMP_OFF : EV_LAMP_ON, tick, kind, n);
    }

    private void WriteObservables(int[] output)
    {
        output[0] = power ? 1 : 0;
        output[1] = breaker.tripped ? 1 : 0;
        for (var n = 0; n < SECTIONS; n++)
        {
            output[2 + n] = ContactEncoding(contactAfter[relaySet1Row[n]]);
            output[8 + n] = ContactEncoding(contactAfter[buttonRow[n]]);
            output[14 + n] = ContactEncoding(contactAfter[switchSet1Row[n]]);
            output[21 + n] = outLampClass[n];
            output[27 + n] = indLampClass[n];
        }
        output[20] = rotary.contact ?? -1;
    }

    private static int ContactEncoding(int position)
    {
        if (position == Graph.CONTACT_NO) return 2;
        if (position == Graph.CONTACT_NC) return 0;
        return 1;
    }

    private void FinishObservablesAndNotes(bool dialReseed)
    {
        WriteObservables(currentObservables);
        if (dialReseed) Trace.reseedDialChatter(chatter, currentObservables);
        var chatterMask = Trace.updateChatter(tick, currentObservables, chatter);
        for (var device = 0; device < Trace.CHATTER_DEVICE_COUNT; device++)
        {
            if ((chatterMask & (1 << device)) == 0) continue;
            eventStore.Append(EV_CHATTER, tick, device, chatter.triggerTransitions,
                chatter.windowTicks[device], chatter.quietTicks[device]);
        }

        var quiet = rotary.mrpm == 0 && priorDialContact == rotary.contact;
        for (var n = 0; n < SECTIONS && quiet; n++)
        {
            if (priorTravel[n] != relays.travel[n] ||
                priorTravel[SECTIONS + n] != buttons.travel[n] ||
                priorTravel[SECTIONS * 2 + n] != switches.travel[n]) quiet = false;
        }
        for (var i = 0; i < Trace.OBSERVABLE_COUNT && quiet; i++)
            if (previousObservables[i] != currentObservables[i]) quiet = false;

        if (!quiet)
        {
            steadyTicks = 0;
            ClearNotes();
        }
        else
        {
            if (steadyTicks < profile.v.settle_quiet_ticks) steadyTicks++;
            if (steadyTicks >= profile.v.settle_quiet_ticks) DeriveNotes();
        }
        Array.Copy(currentObservables, previousObservables, currentObservables.Length);
    }

    private void ClearNotes()
    {
        Array.Clear(noteCoil);
        Array.Clear(noteLamp);
        Array.Clear(noteLampMv);
        Array.Clear(noteDropCount);
    }

    private void DeriveNotes()
    {
        ClearNotes();
        if (!Devices.sourceEnabled(power, breaker)) return;
        for (var relay = 0; relay < SECTIONS; relay++)
        {
            var ua = relayCoilUa[relay];
            var dropOut = profile.derived.relayDropOutUa[relay];
            var pullIn = profile.derived.relayPullInUa[relay];
            if (relays.travel[relay] != 0 || ua <= dropOut || ua >= pullIn) continue;
            var coil = coilElement[relay];
            var coilDefinition = graph.elements[coil];
            Array.Clear(chainVisited);
            chainVisited[coil] = 1;
            WalkChain(coilDefinition.a, coil);
            WalkChain(coilDefinition.b, coil);
            noteCoil[relay] = 1;
            var baseIndex = relay * NOTE_STRIDE;
            var count = 0;
            for (var element = 0; element < graph.elementCount; element++)
            {
                if (chainVisited[element] == 0 || element == coil || element == graph.elementCount - 1) continue;
                var mv = elementAbsMv[element];
                if (mv == 0) continue;
                var insert = count;
                while (insert > 0)
                {
                    var priorMv = noteDropMv[baseIndex + insert - 1];
                    var priorElement = noteDropElement[baseIndex + insert - 1];
                    if (priorMv > mv || (priorMv == mv && priorElement < element)) break;
                    noteDropMv[baseIndex + insert] = priorMv;
                    noteDropElement[baseIndex + insert] = priorElement;
                    insert--;
                }
                noteDropMv[baseIndex + insert] = mv;
                noteDropElement[baseIndex + insert] = (short)element;
                count++;
            }
            noteDropCount[relay] = (short)count;
            var indicator = indElement[relay];
            if (chainVisited[indicator] != 0 && indLampUa[relay] != 0)
            {
                noteLamp[relay] = 1;
                noteLampMv[relay] = elementAbsMv[indicator];
            }
        }
    }

    private void WalkChain(int startNode, int firstIncoming)
    {
        var node = startNode;
        var incoming = firstIncoming;
        while (true)
        {
            var candidate = -1;
            var count = 0;
            for (var element = 0; element < graph.elementCount; element++)
            {
                if (element == incoming) continue;
                var edge = graph.elements[element];
                if (edge.a == edge.b || (edge.a != node && edge.b != node)) continue;
                candidate = element;
                count++;
                if (count > 1) break;
            }
            if (count != 1 || chainVisited[candidate] != 0) return;
            chainVisited[candidate] = 1;
            if (candidate == graph.elementCount - 1) return;
            var next = graph.elements[candidate];
            node = next.a == node ? next.b : next.a;
            incoming = candidate;
        }
    }

    private Note[] MaterializeNotes()
    {
        var count = 0;
        for (var relay = 0; relay < SECTIONS; relay++)
        {
            if (noteCoil[relay] != 0) count++;
            if (noteLamp[relay] != 0) count++;
        }
        var notes = new Note[count];
        var at = 0;
        for (var relay = 0; relay < SECTIONS; relay++)
        {
            if (noteCoil[relay] != 0)
            {
                var drops = new Note.Drop[noteDropCount[relay]];
                var baseIndex = relay * NOTE_STRIDE;
                for (var i = 0; i < drops.Length; i++)
                {
                    var element = noteDropElement[baseIndex + i];
                    drops[i] = new Note.Drop(graph.elementIds[element], noteDropMv[baseIndex + i]);
                }
                notes[at++] = new Note.CoilStarved(relay + 1, relayCoilUa[relay],
                    profile.derived.relayPullInUa[relay], drops);
            }
            if (noteLamp[relay] != 0)
                notes[at++] = new Note.LampInCoilPath(relay + 1, noteLampMv[relay]);
        }
        return notes;
    }

    private static LampClass ClassFromCode(int code) => code switch
    {
        2 => LampClass.@on,
        1 => LampClass.dim,
        _ => LampClass.@off,
    };

    private static sbyte ClassCode(LampClass value) => value switch
    {
        LampClass.@on => 2,
        LampClass.dim => 1,
        _ => 0,
    };

    private static (bool, bool) ClosedPair(int position) =>
        (position == Graph.CONTACT_NC, position == Graph.CONTACT_NO);
}
