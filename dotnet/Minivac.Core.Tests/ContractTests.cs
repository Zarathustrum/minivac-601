using System;
using System.Reflection;
using Xunit;

namespace Minivac.Core.Tests;

public sealed class ContractTests
{
    [Fact]
    public void contract_and_command_discriminators_are_exact()
    {
        Assert.Equal("1.1.0", Contract.CONTRACT);
        Command[] commands =
        {
            new Command.Power(true),
            new Command.Breaker(),
            new Command.Connect(7, new CordEnd.Hole("1A#1"), new CordEnd.Touch("1B")),
            new Command.Disconnect(7),
            new Command.Button(1, 500),
            new Command.Switch(2, 1000),
            new Command.RelayGrab(3, 750),
            new Command.RelayRelease(3),
            new Command.DialGrab(359_999_999),
            new Command.DialRelease(),
        };
        Assert.Equal(
            new[] { "power", "breaker", "connect", "disconnect", "button", "switch", "relayGrab", "relayRelease", "dialGrab", "dialRelease" },
            Array.ConvertAll(commands, command => command.k));
    }

    [Fact]
    public void end_result_note_event_and_anomaly_discriminators_are_exact()
    {
        CordEnd[] ends = { new CordEnd.Hole("1A#1"), new CordEnd.Touch("1A"), new CordEnd.Free() };
        Assert.Equal(new[] { "hole", "touch", "free" }, Array.ConvertAll(ends, end => end.k));
        Assert.True(new CmdResult.Success().ok);
        var failure = new CmdResult.Failure(CmdWhy.hole_occupied);
        Assert.False(failure.ok);
        Assert.Equal("hole_occupied", failure.why.ToString());
        Assert.Equal("coil-starved", new Note.CoilStarved(1, 40_000, 43_333, Array.Empty<Note.Drop>()).k);
        Assert.Equal("lamp-in-coil-path", new Note.LampInCoilPath(1, 6000).k);
        Assert.Equal("no-settle", new TraceAnomaly.NoSettle(5000).k);
        Assert.Equal("chatter", new Event.Chatter(5, ChatterDev.relay1, 9, 800, 2400).k);
    }

    [Fact]
    public void every_failure_reason_relay_band_and_lamp_class_is_closed_and_spelled_exactly()
    {
        Assert.Equal(
            new[] { "hole_occupied", "unknown_hole", "unknown_terminal", "unknown_cord", "cord_exists", "bad_cord_id", "bad_target" },
            Enum.GetNames<CmdWhy>());
        Assert.Equal(new[] { "below", "hold", "above" }, Enum.GetNames<RelayBand>());
        Assert.Equal(new[] { "off", "dim", "on" }, Enum.GetNames<LampClass>());
        Assert.Equal(new[] { "out", "ind" }, Enum.GetNames<Event.LampKind>());
    }

    [Fact]
    public void every_event_variant_has_a_fixed_discriminator_and_required_payload()
    {
        Event[] events =
        {
            new Event.PowerOn(0),
            new Event.PowerOff(1),
            new Event.BreakerTrip(2),
            new Event.BreakerReset(3),
            new Event.RelayPullIn(4, 1, 44_000, 667),
            new Event.RelayDropOut(5, 2, 16_000, 667),
            new Event.ContactMake(6, "1A", "1B"),
            new Event.ContactBreak(7, "1A", "1C"),
            new Event.LampOn(8, Event.LampKind.@out, 3),
            new Event.LampOff(9, Event.LampKind.ind, 4),
            new Event.DialMake(10, 5),
            new Event.DialBreak(11, 6),
            new Event.Chatter(12, ChatterDev.dial, 9, 800, 2400),
        };

        Assert.Equal(
            new[]
            {
                "power.on", "power.off", "breaker.trip", "breaker.reset",
                "relay.pullIn", "relay.dropOut", "contact.make", "contact.break",
                "lamp.on", "lamp.off", "dial.make", "dial.break", "chatter",
            },
            Array.ConvertAll(events, value => value.k));

        var relay = Assert.IsType<Event.RelayPullIn>(events[4]);
        Assert.Equal((1, 44_000, 667), (relay.n, relay.coilUa, relay.marginUa));
        var contact = Assert.IsType<Event.ContactMake>(events[6]);
        Assert.Equal(("1A", "1B"), (contact.arm, contact.to));
        var lamp = Assert.IsType<Event.LampOn>(events[8]);
        Assert.Equal((Event.LampKind.@out, 3), (lamp.kind, lamp.n));
        var dial = Assert.IsType<Event.DialMake>(events[10]);
        Assert.Equal(5, dial.pos);
        var chatter = Assert.IsType<Event.Chatter>(events[12]);
        Assert.Equal((ChatterDev.dial, 9, 800, 2400),
            (chatter.dev, chatter.transitions, chatter.windowTicks, chatter.quietTicks));
    }

    [Fact]
    public void union_discriminators_are_get_only_and_have_no_record_clone_path()
    {
        foreach (var union in new[]
        {
            (Type: typeof(CordEnd), Property: "k"),
            (Type: typeof(Command), Property: "k"),
            (Type: typeof(CmdResult), Property: "ok"),
            (Type: typeof(TraceAnomaly), Property: "k"),
            (Type: typeof(Note), Property: "k"),
            (Type: typeof(Event), Property: "k"),
        })
        {
            var property = union.Type.GetProperty(union.Property, BindingFlags.Instance | BindingFlags.Public);
            Assert.NotNull(property);
            Assert.True(property!.CanRead);
            Assert.False(property.CanWrite);
            Assert.Null(property.SetMethod);

            Assert.Null(union.Type.GetMethod("<Clone>$", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic));
            foreach (var variant in union.Type.GetNestedTypes(BindingFlags.Public))
                if (variant.IsSubclassOf(union.Type))
                    Assert.Null(variant.GetMethod("<Clone>$", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic));
        }
    }

    [Fact]
    public void union_bases_cannot_be_publicly_constructed_or_externally_derived()
    {
        foreach (var union in new[]
        {
            typeof(CordEnd), typeof(Command), typeof(CmdResult),
            typeof(TraceAnomaly), typeof(Note), typeof(Event),
        })
        {
            Assert.True(union.IsAbstract);
            Assert.Empty(union.GetConstructors(BindingFlags.Instance | BindingFlags.Public));

            var constructors = union.GetConstructors(BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.NotEmpty(constructors);
            foreach (var constructor in constructors)
            {
                Assert.False(constructor.IsPublic);
                Assert.False(constructor.IsFamily);
                Assert.False(constructor.IsFamilyOrAssembly);
            }

            foreach (var variant in union.GetNestedTypes(BindingFlags.Public))
                if (variant.IsSubclassOf(union)) Assert.True(variant.IsSealed);
        }
    }
}
