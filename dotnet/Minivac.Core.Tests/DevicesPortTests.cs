using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Minivac.Conformance;
using Xunit;

namespace Minivac.Core.Tests;

public sealed class DevicesPortTests
{
    private static readonly FileSystemSource Artifacts = new(FindRepositoryRoot());
    private static readonly Profile ReferenceProfile = LoadProfile();
    private static readonly LoadedNetlist ReferenceNetlist =
        Netlist.LoadNetlist(Artifacts.ReadAllBytes("data/netlist.json"));

    [Fact]
    public void Mover_lands_all_profile_strokes_on_their_exact_tick_counts()
    {
        var profile = ReferenceProfile;
        var relay = Movers();
        for (var tick = 0; tick < profile.derived.relayOperateTicks - 1; tick++)
        {
            Assert.Equal(
                tick == 0 ? Devices.RELAY_PULL_IN : Devices.RELAY_NO_EVENT,
                Devices.advanceRelay(
                    relay, 0, profile.derived.relayPullInUa[0], profile.derived.relayPullInUa[0],
                    profile.derived.relayDropOutUa[0], profile.derived.relayOperateTicks,
                    profile.derived.relayReleaseTicks));
        }
        Assert.True(relay.travel[0] < 1000);
        Devices.advanceRelay(
            relay, 0, profile.derived.relayPullInUa[0], profile.derived.relayPullInUa[0],
            profile.derived.relayDropOutUa[0], profile.derived.relayOperateTicks,
            profile.derived.relayReleaseTicks);
        AssertMover(relay, 1000, 0, 0);

        for (var tick = 0; tick < profile.derived.relayReleaseTicks - 1; tick++)
        {
            Assert.Equal(
                tick == 0 ? Devices.RELAY_DROP_OUT : Devices.RELAY_NO_EVENT,
                Devices.advanceRelay(
                    relay, 0, profile.derived.relayDropOutUa[0], profile.derived.relayPullInUa[0],
                    profile.derived.relayDropOutUa[0], profile.derived.relayOperateTicks,
                    profile.derived.relayReleaseTicks));
        }
        Assert.True(relay.travel[0] > 0);
        Devices.advanceRelay(
            relay, 0, profile.derived.relayDropOutUa[0], profile.derived.relayPullInUa[0],
            profile.derived.relayDropOutUa[0], profile.derived.relayOperateTicks,
            profile.derived.relayReleaseTicks);
        AssertMover(relay, 0, 0, 0);

        foreach (var strokeTicks in new[] { profile.derived.pushbuttonTicks, profile.derived.slideTicks })
        {
            var state = Movers();
            RunTarget(state, 1000, strokeTicks, strokeTicks - 1);
            Assert.True(state.travel[0] < 1000);
            RunTarget(state, 1000, strokeTicks, 1);
            AssertMover(state, 1000, 0, 0);
            RunTarget(state, 0, strokeTicks, strokeTicks - 1);
            Assert.True(state.travel[0] > 0);
            RunTarget(state, 0, strokeTicks, 1);
            AssertMover(state, 0, 0, 0);
        }
    }

    [Fact]
    public void Mover_clears_remainder_on_reversal_and_clamps_arbitrary_targets()
    {
        var reversed = Movers([500], [1], [119]);
        Devices.advanceTargetMover(reversed, 0, 0, 120);
        AssertMover(reversed, 492, -1, 40);

        var midway = Movers();
        RunTarget(midway, 500, ReferenceProfile.derived.pushbuttonTicks, 124);
        Assert.Equal(496, midway.travel[0]);
        RunTarget(midway, 500, ReferenceProfile.derived.pushbuttonTicks, 1);
        AssertMover(midway, 500, 0, 0);

        var nonDividing = Movers();
        RunTarget(nonDividing, 501, ReferenceProfile.derived.pushbuttonTicks, 125);
        Assert.Equal(500, nonDividing.travel[0]);
        RunTarget(nonDividing, 501, ReferenceProfile.derived.pushbuttonTicks, 1);
        AssertMover(nonDividing, 501, 0, 0);
    }

    [Fact]
    public void Relay_equality_is_outside_the_hold_band_and_only_midstroke_holds_direction()
    {
        var pull = ReferenceProfile.derived.relayPullInUa[0];
        var drop = ReferenceProfile.derived.relayDropOutUa[0];
        var relay = Movers();

        Assert.Equal(RelayBand.above, Devices.relayBand(pull, pull, drop));
        Assert.Equal(Devices.RELAY_PULL_IN, Devices.advanceRelay(relay, 0, -pull, pull, drop, 120, 80));
        Assert.Equal(0, Devices.relayMarginUa(Devices.RELAY_PULL_IN, -pull, pull, drop));
        var movingTravel = relay.travel[0];
        Assert.Equal(Devices.RELAY_NO_EVENT, Devices.advanceRelay(relay, 0, (pull + drop) / 2, pull, drop, 120, 80));
        Assert.True(relay.travel[0] > movingTravel);
        Assert.Equal(1, relay.dir[0]);

        Assert.Equal(RelayBand.below, Devices.relayBand(drop, pull, drop));
        Assert.Equal(Devices.RELAY_DROP_OUT, Devices.advanceRelay(relay, 0, -drop, pull, drop, 120, 80));
        Assert.Equal(0, Devices.relayMarginUa(Devices.RELAY_DROP_OUT, -drop, pull, drop));
        Assert.Equal(-1, relay.dir[0]);

        var released = Movers();
        Assert.Equal(Devices.RELAY_NO_EVENT, Devices.advanceRelay(released, 0, (pull + drop) / 2, pull, drop, 120, 80));
        AssertMover(released, 0, 0, 0);
        var operated = Movers([1000]);
        Assert.Equal(Devices.RELAY_NO_EVENT, Devices.advanceRelay(operated, 0, pull + 1, pull, drop, 120, 80));
        AssertMover(operated, 1000, 0, 0);
    }

    [Fact]
    public void Transfer_positions_use_the_four_exact_break_make_boundaries()
    {
        Assert.Equal(Graph.CONTACT_NC, Devices.transferPosition(449, 450, 550));
        Assert.Equal(Graph.CONTACT_OPEN, Devices.transferPosition(450, 450, 550));
        Assert.Equal(Graph.CONTACT_OPEN, Devices.transferPosition(550, 450, 550));
        Assert.Equal(Graph.CONTACT_NO, Devices.transferPosition(551, 450, 550));
    }

    [Fact]
    public void Transfer_edges_emit_break_before_make_with_loaded_terminals()
    {
        var row = ReferenceNetlist.contacts[0];
        var got = new List<(ContactEdge Edge, string Arm, string To)>();
        Devices.emitTransferEdges(row, Graph.CONTACT_NC, Graph.CONTACT_NO,
            (edge, arm, to) => got.Add((edge, arm, to)));
        var relay = Assert.IsType<RelayContactDef>(row);
        Assert.Equal(
            [(ContactEdge.@break, relay.arm, relay.nc), (ContactEdge.make, relay.arm, relay.no)],
            got);
        Assert.Equal("break", got[0].Edge.ToString());
        Assert.Equal("make", got[1].Edge.ToString());
    }

    [Fact]
    public void Contact_writer_walks_all_31_loaded_rows_in_netlist_order()
    {
        var relays = Movers([0, 1000, 500, 449, 450, 551]);
        var buttons = Movers([1000, 0, 500, 551, 449, 550]);
        var switches = Movers([500, 551, 450, 449, 1000, 0]);
        var output = new sbyte[ReferenceNetlist.contacts.Count];
        Devices.writeContactPositions(ReferenceNetlist, relays, buttons, switches, 7, 450, 550, output);

        Assert.Equal(31, output.Length);
        for (var i = 0; i < ReferenceNetlist.contacts.Count; i++)
        {
            var row = ReferenceNetlist.contacts[i];
            if (row is WiperContactDef)
                Assert.Equal(7, output[i]);
            else
            {
                var travel = row switch
                {
                    RelayContactDef relay => relays.travel[relay.n - 1],
                    ButtonContactDef button => buttons.travel[button.n - 1],
                    SlideContactDef slide => switches.travel[slide.n - 1],
                    _ => throw new InvalidOperationException(),
                };
                Assert.Equal(Devices.transferPosition(travel, 450, 550), output[i]);
            }
        }

        var graph = Graph.buildGraph(ReferenceNetlist, ReferenceProfile, new GraphInput([], Array.ConvertAll(output, value => (int)value)));
        for (var i = 0; i < ReferenceNetlist.contacts.Count; i++)
        {
            var row = ReferenceNetlist.contacts[i];
            switch (row)
            {
                case WiperContactDef wiper:
                    Assert.Equal(Node(graph, wiper.arm), Node(graph, wiper.pads[output[i]]));
                    break;
                case RelayContactDef relay when output[i] == Graph.CONTACT_NC:
                    Assert.Equal(Node(graph, relay.arm), Node(graph, relay.nc));
                    break;
                case RelayContactDef relay when output[i] == Graph.CONTACT_NO:
                    Assert.Equal(Node(graph, relay.arm), Node(graph, relay.no));
                    break;
                case ButtonContactDef button when output[i] == Graph.CONTACT_NC:
                    Assert.Equal(Node(graph, button.arm), Node(graph, button.nc));
                    break;
                case ButtonContactDef button when output[i] == Graph.CONTACT_NO:
                    Assert.Equal(Node(graph, button.arm), Node(graph, button.no));
                    break;
                case SlideContactDef slide when output[i] == Graph.CONTACT_NC:
                    Assert.Equal(Node(graph, slide.arm), Node(graph, slide.nc));
                    break;
                case SlideContactDef slide when output[i] == Graph.CONTACT_NO:
                    Assert.Equal(Node(graph, slide.arm), Node(graph, slide.no));
                    break;
            }
        }

        Devices.writeContactPositions(ReferenceNetlist, relays, buttons, switches, null, 450, 550, output);
        Assert.Equal(-1, output[30]);
    }

    [Fact]
    public void Lamp_filament_relaxes_toward_the_magnitude_selected_pwl_target()
    {
        var pwl = new Pwl([0.0, 1.0], [18.0, 160.0]);
        Assert.Equal(124.5, Devices.advanceLampFilament(160, 0, pwl, 0.25));
        Assert.Equal(53.5, Devices.advanceLampFilament(18, -1, pwl, 0.25));
    }

    [Fact]
    public void Lamp_brightness_uses_the_literal_resistance_map_and_clamps()
    {
        Assert.Equal(0, Devices.lampBrightnessMilli(18, 18, 160));
        Assert.Equal(500, Devices.lampBrightnessMilli(89, 18, 160));
        Assert.Equal(1000, Devices.lampBrightnessMilli(160, 18, 160));
        Assert.Equal(0, Devices.lampBrightnessMilli(1, 18, 160));
        Assert.Equal(1000, Devices.lampBrightnessMilli(400, 18, 160));
    }

    [Fact]
    public void Lamp_brightness_rejects_invalid_resistance_endpoints()
    {
        foreach (var pair in new[]
                 {
                     (18.0, 18.0), (160.0, 18.0), (0.0, 160.0), (-1.0, 160.0),
                     (18.0, 0.0), (18.0, -1.0), (double.NaN, 160.0),
                     (double.PositiveInfinity, 160.0), (18.0, double.NaN),
                     (18.0, double.PositiveInfinity),
                 })
        {
            var error = Assert.Throws<InvalidOperationException>(() =>
                Devices.lampBrightnessMilli(89, pair.Item1, pair.Item2));
            Assert.Equal("lamp brightness resistance endpoints must be finite, positive, and increasing", error.Message);
        }
    }

    [Fact]
    public void Lamp_brightness_rounds_opposite_sides_of_the_frozen_half_boundary()
    {
        var below = BitConverter.Int64BitsToDouble(unchecked((long)0x4043af7ced916872UL));
        var above = BitConverter.Int64BitsToDouble(unchecked((long)0x4043af7ced916873UL));
        Assert.Equal(39.370999999999995, below);
        Assert.Equal(39.371, above);
        Assert.Equal(150, Devices.lampBrightnessMilli(below, 18, 160));
        Assert.Equal(151, Devices.lampBrightnessMilli(above, 18, 160));
    }

    [Fact]
    public void Lamp_classes_use_exact_equalities_and_events_only_cross_off()
    {
        Assert.Equal(LampClass.@off, Devices.lampClass(149, 150, 600));
        Assert.Equal(LampClass.dim, Devices.lampClass(150, 150, 600));
        Assert.Equal(LampClass.dim, Devices.lampClass(599, 150, 600));
        Assert.Equal(LampClass.@on, Devices.lampClass(600, 150, 600));
        Assert.Equal(Devices.LAMP_ON, Devices.lampClassEvent(LampClass.@off, LampClass.dim));
        Assert.Equal(Devices.LAMP_ON, Devices.lampClassEvent(LampClass.@off, LampClass.@on));
        Assert.Equal(Devices.LAMP_NO_EVENT, Devices.lampClassEvent(LampClass.dim, LampClass.@on));
        Assert.Equal(Devices.LAMP_NO_EVENT, Devices.lampClassEvent(LampClass.@on, LampClass.dim));
        Assert.Equal(Devices.LAMP_OFF, Devices.lampClassEvent(LampClass.dim, LampClass.@off));
        Assert.Equal(Devices.LAMP_OFF, Devices.lampClassEvent(LampClass.@on, LampClass.@off));
    }

    [Fact]
    public void Breaker_threshold_equality_is_over_current()
    {
        Assert.False(Devices.breakerOverThreshold(999, 1000));
        Assert.True(Devices.breakerOverThreshold(1000, 1000));
        Assert.True(Devices.breakerOverThreshold(-1000, 1000));
    }

    [Fact]
    public void Cold_reset_changes_only_relay_and_electrical_state_and_canonicalizes_zero()
    {
        var relays = Movers([333, 1000], [1, -1], [77, 99]);
        var manual = Movers([500], [1], [3]);
        var breaker = new BreakerState { overloadTicks = 4, tripPending = true, tripped = true };
        var coils = new[] { -0.0, 1.5 };
        var lamps = new[] { 160.0, 80.0, 18.0 };
        Devices.coldResetElectrical(relays, coils, lamps, 18);
        Assert.Equal([0, 0], relays.travel);
        Assert.Equal([0, 0], relays.dir);
        Assert.Equal([0, 0], relays.acc);
        Assert.All(coils, current => Assert.Equal(0L, BitConverter.DoubleToInt64Bits(current)));
        Assert.Equal([18.0, 18.0, 18.0], lamps);
        AssertMover(manual, 500, 1, 3);
        Assert.Equal(4, breaker.overloadTicks);
        Assert.True(breaker.tripPending);
        Assert.True(breaker.tripped);
    }

    [Fact]
    public void Cold_reset_preserves_held_relay_travel_and_physical_direction()
    {
        var relays = Movers([333, 777], [1, -1], [77, 99]);
        var held = new byte[] { 1, 0 };
        var lastPhysicalDir = new sbyte[] { 1, -1 };
        Devices.coldResetElectrical(relays, [1.0, 2.0], [160.0], 18, held, lastPhysicalDir);
        Assert.Equal([333, 0], relays.travel);
        Assert.Equal([0, 0], relays.dir);
        Assert.Equal([0, 0], relays.acc);
        Assert.Equal([1, 0], lastPhysicalDir);
    }

    [Fact]
    public void Breaker_uses_exact_delayed_and_dead_short_thresholds_at_the_next_boundary()
    {
        var delayed = new BreakerState();
        Assert.False(Devices.sampleBreaker(delayed, true, 999, 1000, 5000, 3));
        Assert.Equal(0, delayed.overloadTicks);
        Assert.True(Devices.sampleBreaker(delayed, true, -1000, 1000, 5000, 3));
        Assert.True(Devices.sampleBreaker(delayed, true, 1000, 1000, 5000, 3));
        Assert.False(delayed.tripPending);
        Assert.True(Devices.sampleBreaker(delayed, true, 1000, 1000, 5000, 3));
        Assert.Equal(3, delayed.overloadTicks);
        Assert.True(delayed.tripPending);
        Assert.False(delayed.tripped);
        Devices.sampleBreaker(delayed, true, 1000, 1000, 5000, 3);
        Assert.Equal(3, delayed.overloadTicks);

        var incoming = Devices.latchBreakerPending(delayed);
        Assert.True(incoming);
        Assert.False(delayed.tripPending);
        Assert.False(delayed.tripped);
        Assert.True(Devices.applyLatchedBreakerTrip(delayed, incoming));
        Assert.Equal(0, delayed.overloadTicks);
        Assert.True(delayed.tripped);

        var immediate = new BreakerState();
        Assert.True(Devices.sampleBreaker(immediate, true, -5000, 1000, 5000, 2000));
        Assert.True(immediate.tripPending);
        Assert.False(immediate.tripped);
    }

    [Fact]
    public void Breaker_reset_preserves_an_already_latched_trip()
    {
        var breaker = new BreakerState();
        Devices.sampleBreaker(breaker, true, 1000, 1000, 5000, 3);
        Assert.Equal(1, breaker.overloadTicks);
        Assert.False(Devices.sampleBreaker(breaker, false, 5000, 1000, 5000, 3));
        Assert.Equal(0, breaker.overloadTicks);

        breaker.overloadTicks = 2;
        breaker.tripPending = true;
        Devices.clearBreakerDwell(breaker);
        Assert.Equal(0, breaker.overloadTicks);
        Assert.True(breaker.tripPending);
        var latched = Devices.latchBreakerPending(breaker);
        breaker.tripped = true;
        Assert.True(Devices.resetBreaker(breaker));
        Assert.False(breaker.tripPending);
        Assert.False(breaker.tripped);
        Assert.True(Devices.applyLatchedBreakerTrip(breaker, latched));
        Assert.True(breaker.tripped);
        Assert.True(Devices.resetBreaker(breaker));
        Assert.False(Devices.resetBreaker(breaker));
    }

    [Fact]
    public void Source_gate_combines_power_and_the_latched_breaker()
    {
        var breaker = new BreakerState();
        Assert.False(Devices.sourceEnabled(false, breaker));
        Assert.True(Devices.sourceEnabled(true, breaker));
        breaker.tripped = true;
        Assert.False(Devices.sourceEnabled(true, breaker));
    }

    private static MoverBank Movers(
        int[]? travel = null,
        sbyte[]? direction = null,
        int[]? accumulator = null)
    {
        travel ??= [0];
        return new MoverBank(
            (int[])travel.Clone(),
            direction is null ? new sbyte[travel.Length] : (sbyte[])direction.Clone(),
            accumulator is null ? new int[travel.Length] : (int[])accumulator.Clone());
    }

    private static void RunTarget(MoverBank bank, int target, long strokeTicks, long ticks)
    {
        for (long tick = 0; tick < ticks; tick++)
            Devices.advanceTargetMover(bank, 0, target, strokeTicks);
    }

    private static void AssertMover(MoverBank bank, int travel, sbyte direction, int accumulator)
    {
        Assert.Equal(travel, bank.travel[0]);
        Assert.Equal(direction, bank.dir[0]);
        Assert.Equal(accumulator, bank.acc[0]);
    }

    private static int Node(BuiltGraph graph, string terminal) =>
        graph.nodeByTerminal[Terminals.terminalIndex(terminal)];

    private static Profile LoadProfile()
    {
        using var document = JsonDocument.Parse(Artifacts.ReadAllBytes("data/profiles/MV601-REF-A.json"));
        return Profile.LoadProfile(document.RootElement);
    }

    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
            if (File.Exists(Path.Combine(directory.FullName, "package.json"))) return directory.FullName;
        throw new InvalidOperationException("repository root not found");
    }
}
