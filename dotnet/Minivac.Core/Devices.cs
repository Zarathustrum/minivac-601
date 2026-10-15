using System;

namespace Minivac.Core;

public sealed record MoverBank(int[] travel, sbyte[] dir, int[] acc);

public enum ContactEdge
{
    @break,
    make,
}

public delegate void ContactEdgeSink(ContactEdge edge, string arm, string to);

public sealed class BreakerState
{
    public int overloadTicks { get; set; }
    public bool tripPending { get; set; }
    public bool tripped { get; set; }
}

public static class Devices
{
    public const int CONTACT_NC = Graph.CONTACT_NC;
    public const int CONTACT_NO = Graph.CONTACT_NO;
    public const int CONTACT_OPEN = Graph.CONTACT_OPEN;

    public const int RELAY_DROP_OUT = -1;
    public const int RELAY_NO_EVENT = 0;
    public const int RELAY_PULL_IN = 1;

    public const int LAMP_OFF = -1;
    public const int LAMP_NO_EVENT = 0;
    public const int LAMP_ON = 1;

    public static void coldResetElectrical(
        MoverBank relays,
        double[] iCoil,
        double[] rLamp,
        double rColdOhm,
        byte[]? held = null,
        sbyte[]? lastPhysicalDir = null)
    {
        for (var n = 0; n < relays.travel.Length; n++)
        {
            if ((held?[n] ?? 0) == 0)
            {
                relays.travel[n] = 0;
                if (lastPhysicalDir is not null)
                    lastPhysicalDir[n] = 0;
            }
            relays.dir[n] = 0;
            relays.acc[n] = 0;
        }
        for (var n = 0; n < iCoil.Length; n++)
            iCoil[n] = 0.0;
        for (var n = 0; n < rLamp.Length; n++)
            rLamp[n] = rColdOhm;
    }

    private static int TargetDirection(int travel, int target)
    {
        if (target > travel) return 1;
        if (target < travel) return -1;
        return 0;
    }

    private static void AdvanceMover(MoverBank bank, int n, int requested, int target, long strokeTicks)
    {
        var travel = bank.travel[n];
        var direction = requested;
        if ((direction > 0 && travel >= target) || (direction < 0 && travel <= target))
            direction = 0;

        var prior = bank.dir[n];
        long acc = direction == prior ? bank.acc[n] : 0;
        bank.dir[n] = (sbyte)direction;
        if (direction == 0)
        {
            bank.acc[n] = 0;
            return;
        }

        acc += 1000;
        var step = Ints.idiv(acc, strokeTicks);
        acc -= step * strokeTicks;
        var next = travel + direction * step;
        if ((direction > 0 && next >= target) || (direction < 0 && next <= target))
        {
            bank.travel[n] = target;
            bank.dir[n] = 0;
            bank.acc[n] = 0;
        }
        else
        {
            bank.travel[n] = (int)next;
            bank.acc[n] = (int)acc;
        }
    }

    public static void advanceTargetMover(MoverBank bank, int n, int target, long strokeTicks) =>
        AdvanceMover(bank, n, TargetDirection(bank.travel[n], target), target, strokeTicks);

    public static RelayBand relayBand(int coilUa, int pullInUa, int dropOutUa)
    {
        var ua = Ints.iabs(coilUa);
        if (ua >= pullInUa) return RelayBand.above;
        if (ua <= dropOutUa) return RelayBand.below;
        return RelayBand.hold;
    }

    public static int relayMarginUa(int eventCode, int coilUa, int pullInUa, int dropOutUa)
    {
        var ua = Ints.iabs(coilUa);
        if (eventCode == RELAY_PULL_IN) return (int)(ua - pullInUa);
        if (eventCode == RELAY_DROP_OUT) return (int)(dropOutUa - ua);
        return 0;
    }

    public static int advanceRelay(
        MoverBank bank,
        int n,
        int coilUa,
        int pullInUa,
        int dropOutUa,
        long operateTicks,
        long releaseTicks,
        int stoppedMidstrokeDirection = 0)
    {
        var travel = bank.travel[n];
        var band = relayBand(coilUa, pullInUa, dropOutUa);
        int requested;
        if (band == RelayBand.above)
            requested = 1;
        else if (band == RelayBand.below)
            requested = -1;
        else
            requested = travel is 0 or 1000 ? 0 : bank.dir[n] != 0 ? bank.dir[n] : stoppedMidstrokeDirection;

        var target = requested < 0 ? 0 : 1000;
        var effective = requested;
        if ((effective > 0 && travel >= target) || (effective < 0 && travel <= target))
            effective = 0;
        var eventCode = effective != bank.dir[n] && effective != 0 ? effective : RELAY_NO_EVENT;
        AdvanceMover(bank, n, effective, target, effective < 0 ? releaseTicks : operateTicks);
        return eventCode;
    }

    public static int transferPosition(int travel, long breakMilli, long makeMilli)
    {
        if (travel < breakMilli) return Graph.CONTACT_NC;
        if (travel > makeMilli) return Graph.CONTACT_NO;
        return Graph.CONTACT_OPEN;
    }

    private static int TransferTravel(NetContact row, MoverBank relays, MoverBank buttons, MoverBank switches) =>
        row switch
        {
            RelayContactDef relay => relays.travel[relay.n - 1],
            ButtonContactDef button => buttons.travel[button.n - 1],
            SlideContactDef slide => switches.travel[slide.n - 1],
            _ => throw new InvalidOperationException("wiper has no transfer travel"),
        };

    public static void writeContactPositions(
        LoadedNetlist netlist,
        MoverBank relays,
        MoverBank buttons,
        MoverBank switches,
        int? wiperContact,
        long breakMilli,
        long makeMilli,
        sbyte[] output)
    {
        for (var i = 0; i < netlist.contacts.Count; i++)
        {
            var row = netlist.contacts[i];
            output[i] = row is WiperContactDef
                ? (sbyte)(wiperContact ?? Graph.CONTACT_OPEN)
                : (sbyte)transferPosition(TransferTravel(row, relays, buttons, switches), breakMilli, makeMilli);
        }
    }

    public static void emitTransferEdges(
        NetContact row,
        int before,
        int after,
        ContactEdgeSink sink)
    {
        if (before == after)
            return;

        string arm;
        string nc;
        string no;
        switch (row)
        {
            case RelayContactDef relay:
                (arm, nc, no) = (relay.arm, relay.nc, relay.no);
                break;
            case ButtonContactDef button:
                (arm, nc, no) = (button.arm, button.nc, button.no);
                break;
            case SlideContactDef slide:
                (arm, nc, no) = (slide.arm, slide.nc, slide.no);
                break;
            default:
                throw new InvalidOperationException("wiper is not a transfer contact");
        }

        if (before != Graph.CONTACT_OPEN)
            sink(ContactEdge.@break, arm, before == Graph.CONTACT_NC ? nc : no);
        if (after != Graph.CONTACT_OPEN)
            sink(ContactEdge.make, arm, after == Graph.CONTACT_NC ? nc : no);
    }

    public static double advanceLampFilament(double rLampOhm, double currentA, Pwl pwl, double kThermal)
    {
        var target = Solve.pwlLookup(pwl, currentA < 0 ? -currentA : currentA);
        return rLampOhm + (target - rLampOhm) * kThermal;
    }

    private static double RoundHalfAwayDouble(double value)
    {
        var truncated = Math.Truncate(value);
        var fraction = value - truncated;
        if (fraction >= 0.5) return truncated + 1;
        if (fraction <= -0.5) return truncated - 1;
        return truncated == 0 ? 0 : truncated;
    }

    public static int lampBrightnessMilli(double rLampOhm, double rColdOhm, double rHotOhm)
    {
        if (!double.IsFinite(rColdOhm) || !double.IsFinite(rHotOhm) || rColdOhm <= 0 || rHotOhm <= 0)
            throw new InvalidOperationException("lamp brightness resistance endpoints must be finite, positive, and increasing");
        var spanOhm = rHotOhm - rColdOhm;
        if (!double.IsFinite(spanOhm) || spanOhm <= 0)
            throw new InvalidOperationException("lamp brightness resistance endpoints must be finite, positive, and increasing");
        var scaled = (1000 * (rLampOhm - rColdOhm)) / spanOhm;
        var milli = RoundHalfAwayDouble(scaled);
        if (milli < 0) return 0;
        if (milli > 1000) return 1000;
        return (int)milli;
    }

    public static LampClass lampClass(int milli, long dimMilli, long onMilli)
    {
        if (milli >= onMilli) return LampClass.@on;
        if (milli >= dimMilli) return LampClass.dim;
        return LampClass.@off;
    }

    public static int lampClassEvent(LampClass before, LampClass after)
    {
        if (before == LampClass.@off && after != LampClass.@off) return LAMP_ON;
        if (before != LampClass.@off && after == LampClass.@off) return LAMP_OFF;
        return LAMP_NO_EVENT;
    }

    public static bool sourceEnabled(bool power, BreakerState breaker) => power && !breaker.tripped;

    public static void clearBreakerDwell(BreakerState breaker) => breaker.overloadTicks = 0;

    public static bool breakerOverThreshold(int supplyUa, int tripUa) => Ints.iabs(supplyUa) >= tripUa;

    public static bool sampleBreaker(
        BreakerState breaker,
        bool enabled,
        int supplyUa,
        int tripUa,
        int deadShortUa,
        int tripDelayTicks)
    {
        if (!enabled)
        {
            breaker.overloadTicks = 0;
            return false;
        }
        var ua = Ints.iabs(supplyUa);
        if (ua >= deadShortUa)
            breaker.tripPending = true;
        else if (ua >= tripUa)
        {
            if (breaker.overloadTicks < tripDelayTicks)
                breaker.overloadTicks++;
            if (breaker.overloadTicks >= tripDelayTicks)
                breaker.tripPending = true;
        }
        else
            breaker.overloadTicks = 0;
        return ua >= tripUa;
    }

    public static bool latchBreakerPending(BreakerState breaker)
    {
        var pending = breaker.tripPending;
        breaker.tripPending = false;
        return pending;
    }

    public static bool resetBreaker(BreakerState breaker)
    {
        var changed = breaker.tripped;
        breaker.tripped = false;
        breaker.tripPending = false;
        breaker.overloadTicks = 0;
        return changed;
    }

    public static bool applyLatchedBreakerTrip(BreakerState breaker, bool pending)
    {
        if (!pending)
            return false;
        breaker.tripped = true;
        breaker.overloadTicks = 0;
        return true;
    }
}
