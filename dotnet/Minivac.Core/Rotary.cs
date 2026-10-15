using System;

namespace Minivac.Core;

public enum RotaryEdgeKind
{
    make,
    @break,
}

public delegate void RotaryEdgeSink(RotaryEdgeKind kind, int pos);

public sealed class RotaryState
{
    public long udeg { get; set; }
    public int? contact { get; set; }
    public bool held { get; set; }
    public long targetUdeg { get; set; }
    public int mrpm { get; set; }
    public long remainder { get; set; }
    public int lastMotorMrpm { get; set; }
    // Ticks the one-shot coast has waited for a mid-transfer contact to land (0 = not waiting). While it
    // is non-zero, lastMotorMrpm keeps the last driven rate: the coast is still owed, in that direction.
    public int coastDeferTicks { get; set; }
}

public static class Rotary
{
    private const long FULL_UDEG = 360_000_000;
    private const long HALF_UDEG = FULL_UDEG / 2;
    private const long PITCH_UDEG = FULL_UDEG / 16;
    private const ulong RATE_DENOMINATOR = 1000;
    private const ulong INT32_MIN_MAGNITUDE = 2_147_483_648;

    public static int? contactAt(long udeg, Profile profile)
    {
        var offset = Ints.mod(profile.v.wiper_offset_udeg, FULL_UDEG);
        var phi = Ints.mod(udeg - offset, FULL_UDEG);
        var k = Ints.idivRound(phi, PITCH_UDEG);
        var raw = phi - k * PITCH_UDEG;
        var distance = Ints.iabs(raw);
        return distance * 2 <= profile.v.contact_arc_udeg ? (int)(k % 16) : null;
    }

    public static RotaryState createRotaryState(Profile profile) => new()
    {
        udeg = 0,
        contact = contactAt(0, profile),
        held = false,
        targetUdeg = 0,
        mrpm = 0,
        remainder = 0,
        lastMotorMrpm = 0,
        coastDeferTicks = 0,
    };

    public static void grabRotary(RotaryState state, long targetUdeg)
    {
        state.held = true;
        state.targetUdeg = targetUdeg;
        state.mrpm = 0;
        state.remainder = 0;
        state.lastMotorMrpm = 0;
        state.coastDeferTicks = 0;
    }

    public static void releaseRotary(RotaryState state)
    {
        if (!state.held)
            return;
        state.held = false;
        state.mrpm = 0;
        state.remainder = 0;
        state.lastMotorMrpm = 0;
        state.coastDeferTicks = 0;
    }

    public static int motorRateMrpm(int? vMotorMv, Profile profile, PortFlags flags)
    {
        if (vMotorMv is null or 0)
            return 0;

        var voltage = vMotorMv.Value;
        // vMotorMv is V(D18)-V(D19); travel is positive (increasing numbers) when it is negative,
        // i.e. with D17 at + and D18 at - (Book I p.23 Exp 13; docs/DECISIONS.md 2026-10-13).
        var negativeTravel = voltage > 0;
        var voltageMagnitude = (ulong)(voltage < 0 ? -(long)voltage : voltage);
        var numerator = checked((ulong)profile.v.run_mrpm * voltageMagnitude);
        var divisor = (ulong)profile.derived.vMotorRunMv;
        var quotient = numerator / divisor;
        var remainder = numerator - quotient * divisor;
        if (remainder * 2 >= divisor)
            quotient++;

        if (!negativeTravel && quotient > int.MaxValue)
        {
            flags.nonPortable = true;
            return int.MaxValue;
        }
        if (negativeTravel && quotient > INT32_MIN_MAGNITUDE)
        {
            flags.nonPortable = true;
            return int.MinValue;
        }
        if (negativeTravel && quotient == INT32_MIN_MAGNITUDE)
            return int.MinValue;
        var result = negativeTravel ? -(int)quotient : (int)quotient;
        return result == 0 ? 0 : result;
    }

    private static long HandDelta(long udeg, long targetUdeg)
    {
        var positive = Ints.mod(targetUdeg - udeg, FULL_UDEG);
        return positive > HALF_UDEG ? positive - FULL_UDEG : positive;
    }

    private static void ApplyDisplacement(
        RotaryState state,
        bool negative,
        ulong displacement,
        Profile profile,
        RotaryEdgeSink emit)
    {
        if (displacement == 0)
            return;

        var radius = profile.v.contact_arc_udeg / 2;
        var offset = Ints.mod(profile.v.wiper_offset_udeg, FULL_UDEG);
        var cursor = state.udeg;
        var remaining = displacement;

        while (true)
        {
            var found = false;
            long nextDistance = 0;
            long nextUdeg = 0;
            var nextKind = RotaryEdgeKind.make;
            var nextPos = 0;

            for (var pos = 0; pos < 16; pos++)
            {
                var center = offset + pos * PITCH_UDEG;
                var makeUdeg = Ints.mod(negative ? center + radius : center - radius, FULL_UDEG);
                var breakUdeg = Ints.mod(negative ? center - radius - 1 : center + radius + 1, FULL_UDEG);
                var makeDistance = negative ? cursor - makeUdeg : makeUdeg - cursor;
                var breakDistance = negative ? cursor - breakUdeg : breakUdeg - cursor;
                if (makeDistance <= 0) makeDistance += FULL_UDEG;
                if (breakDistance <= 0) breakDistance += FULL_UDEG;

                if (!found || makeDistance < nextDistance)
                {
                    found = true;
                    nextDistance = makeDistance;
                    nextUdeg = makeUdeg;
                    nextKind = RotaryEdgeKind.make;
                    nextPos = pos;
                }
                if (breakDistance < nextDistance)
                {
                    nextDistance = breakDistance;
                    nextUdeg = breakUdeg;
                    nextKind = RotaryEdgeKind.@break;
                    nextPos = pos;
                }
            }

            if (!found || remaining < (ulong)nextDistance)
                break;
            remaining -= (ulong)nextDistance;
            cursor = nextUdeg;
            emit(nextKind, nextPos);
        }

        var signedRemaining = (long)remaining;
        state.udeg = Ints.mod(cursor + (negative ? -signedRemaining : signedRemaining), FULL_UDEG);
        state.contact = contactAt(state.udeg, profile);
    }

    private static bool IntegrateAndMove(
        RotaryState state,
        int rate,
        long clampMagnitude,
        Profile profile,
        RotaryEdgeSink emit)
    {
        var negative = rate < 0;
        var magnitude = (ulong)(negative ? -(long)rate : rate);
        var numerator = checked(checked(magnitude * (ulong)profile.v.tick_us) * 6);

        var carried = state.remainder;
        if (carried != 0)
        {
            var carriedNegative = carried < 0;
            var carriedMagnitude = (ulong)(carriedNegative ? -carried : carried);
            if (carriedNegative == negative)
                numerator += carriedMagnitude;
            else if (numerator < carriedMagnitude)
            {
                numerator = carriedMagnitude - numerator;
                negative = !negative;
            }
            else if (numerator == carriedMagnitude)
            {
                numerator = 0;
                negative = false;
            }
            else
                numerator -= carriedMagnitude;
        }

        var quotient = numerator / RATE_DENOMINATOR;
        var remainder = numerator - quotient * RATE_DENOMINATOR;
        state.remainder = remainder == 0 ? 0 : negative ? -(long)remainder : (long)remainder;

        if (clampMagnitude > 0 && quotient >= (ulong)clampMagnitude)
        {
            state.remainder = 0;
            ApplyDisplacement(state, negative, (ulong)clampMagnitude, profile, emit);
            return true;
        }
        ApplyDisplacement(state, negative, quotient, profile, emit);
        return false;
    }

    // The longest relay, pushbutton or slide stroke: the cap on a deferred coast (stepRotary).
    private static long LongestStrokeTicks(Profile profile)
    {
        var d = profile.derived;
        var ticks = d.relayOperateTicks;
        if (d.relayReleaseTicks > ticks) ticks = d.relayReleaseTicks;
        if (d.pushbuttonTicks > ticks) ticks = d.pushbuttonTicks;
        if (d.slideTicks > ticks) ticks = d.slideTicks;
        return ticks;
    }

    // COAST SCALES WITH SPEED ([unverified], fallback COAST-SCALES-WITH-SPEED, open-questions.md O-R13;
    // the offsets themselves are INVENTED, O-R5).
    // The configured offsets are read as the overrun from RUN speed. A permanent-magnet armature under
    // dynamic (back-EMF) braking decelerates in proportion to its speed, so its stopping distance is
    // proportional to the speed it stops from: coast * min(1, speed / run_mrpm). Without this a creep
    // of a few per cent of RUN (V-EXP12's coil-flyback reverse drive) took the whole 20° jump and
    // landed a pad short of Books V-VI p.23's "will turn to the number drawn on the matrix".
    //
    // Capped at 1: power across STOP runs the motor faster than RUN (Maintenance p.9), and the cap
    // keeps every stop at or above RUN speed on exactly the configured offset, so no stop overruns
    // further than the pad-tuned numbers allow. Stops at or above the unloaded RUN rate keep the configured
    // offset; a loaded RUN stop, typically 96-99.5% of run_mrpm, shrinks by that fraction.
    //
    // Exact integer coast * speed / run_mrpm, rounded half away from zero like Ints.idivRound (§4.4).
    // Below the cap speed < run_mrpm <= int.MaxValue and coast <= int.MaxValue, so the 64-bit product
    // is below 2^62 and exact; the TypeScript core reaches the same quotient through 16-bit limbs.
    private static long ScaledCoastUdeg(long coastUdeg, long speedMrpm, long runMrpm)
    {
        if (speedMrpm >= runMrpm)
            return coastUdeg;
        var product = coastUdeg * speedMrpm;
        var quotient = product / runMrpm;
        var remainder = product - quotient * runMrpm;
        return remainder * 2 >= runMrpm ? quotient + 1 : quotient;
    }

    // Advance the rotary by one tick.
    //
    // vMotorMv is the quantized V(D18)-V(D19) from this tick's solve, or null for a floating
    // armature. sourceEnabled is the final power/breaker gate and stopShorted is exact D18/D19
    // graph-node equality. Structural equality
    // selects the STOP-shorted coast only while the source is enabled; power loss always selects
    // drive-removed coast, even when those terminals remain unioned. moversInTransit is Machine's
    // MotionMask() != 0: some relay, pushbutton or slide is mid-stroke. A held dial ignores all of
    // these and keeps following the hand target.
    //
    // COAST DEFERRED ACROSS A CONTACT TRANSFER (Tom's ruling, option B, 2026-10-13; [unverified],
    // fallback TRANSFER-COAST-DEFER, open-questions.md O-R12).
    // Circuits such as Tic-Tac-Toe and the elevators stop the motor with one transfer set: the arm leaves
    // the contact that feeds RUN and lands on the one that shorts STOP. Between the two (under 1 ms for a
    // relay release at MV601-REF-A: the 450-550 both-open band of its 8 ms stroke; about 6 ms for a
    // slide) the armature is undriven but not yet braked. Choosing the offset on the
    // first undriven tick locks in the weak drive-removed coast, ignoring the strong brake that arrives a
    // moment later. That overshot Tic-Tac-Toe's first move off the centre square (Book VI p.55: "always
    // to the center"; tools/motor-claims.ts, docs/research/motor-sensitivity.md).
    //
    // So when the drive goes while the source is on, STOP is not shorted and a mover is mid-stroke, the
    // dial holds and the decision waits. The one-shot offset already lumps all overrun into one jump;
    // waiting changes only WHICH offset applies, never adds motion. The wait ends at the first of these:
    // - STOP shorted: STOP-shorted offset;
    // - drive back: no coast, motion resumes;
    // - every mover landed with no short: drive-removed offset;
    // - power lost: drive-removed offset, as before;
    // - LongestStrokeTicks waited: whatever the circuit selects now.
    // The cap comes from the profile's own stroke times, not from an added constant. The sources say
    // nothing about momentum at all (rotary.md §3.3, O-R5), so this rule is a modelling choice, not a
    // sourced fact.
    //
    // Whichever offset applies is then scaled by the rate in force when the drive left (previous,
    // held across the wait): ScaledCoastUdeg, fallback COAST-SCALES-WITH-SPEED (O-R13).
    public static void stepRotary(
        RotaryState state,
        int? vMotorMv,
        bool sourceEnabled,
        bool stopShorted,
        bool moversInTransit,
        Profile profile,
        PortFlags flags,
        RotaryEdgeSink emit)
    {
        if (state.held)
        {
            state.lastMotorMrpm = 0;
            var delta = HandDelta(state.udeg, state.targetUdeg);
            if (delta == 0)
            {
                state.mrpm = 0;
                state.remainder = 0;
                return;
            }

            var rate = delta > 0 ? (int)profile.v.hand_slew_mrpm : -(int)profile.v.hand_slew_mrpm;
            state.mrpm = IntegrateAndMove(state, rate, Ints.iabs(delta), profile, emit) ? 0 : rate;
            return;
        }

        var motorRate = motorRateMrpm(vMotorMv, profile, flags);
        var previous = state.lastMotorMrpm;

        if (motorRate == 0 && previous != 0)
        {
            // Mid-transfer: hold and keep the coast owed (see above). lastMotorMrpm stays previous.
            if (sourceEnabled && !stopShorted && moversInTransit && state.coastDeferTicks < LongestStrokeTicks(profile))
            {
                state.coastDeferTicks++;
                state.remainder = 0;
                state.mrpm = 0;
                return;
            }
            state.coastDeferTicks = 0;
            var coast = sourceEnabled && stopShorted
                ? profile.v.coast_udeg_stop_shorted
                : profile.v.coast_udeg_drive_removed;
            state.remainder = 0;
            var speed = previous < 0 ? -(long)previous : previous;
            ApplyDisplacement(
                state, previous < 0, (ulong)ScaledCoastUdeg(coast, speed, profile.v.run_mrpm), profile, emit);
        }
        else if (motorRate != 0)
        {
            state.coastDeferTicks = 0;
            if (previous != 0 && (previous < 0) != (motorRate < 0))
                state.remainder = 0;
            IntegrateAndMove(state, motorRate, 0, profile, emit);
        }
        else
            state.remainder = 0;

        state.mrpm = motorRate;
        state.lastMotorMrpm = motorRate;
    }
}
