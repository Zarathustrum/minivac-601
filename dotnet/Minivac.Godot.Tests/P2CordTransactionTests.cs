using System;
using System.Collections.Generic;
using System.Linq;
using Minivac.Core;
using Xunit;

namespace Minivac.Godot.Tests;

public sealed class P2CordTransactionTests
{
    private static readonly State.Cord Original = new(
        7,
        new CordEnd.Hole("1A#1"),
        new CordEnd.Hole("1B#1"),
        123);

    [Fact]
    public void Replace_reports_all_five_outcomes_and_restores_byte_identical_original()
    {
        var endpoint = new EndpointRef(7, CordSide.A);
        var next = new CordEnd.Hole("2A#1");

        Assert.IsType<ReplacementResult.Noop>(CordModel.ReplaceCordEndpoint(
            [Original], endpoint, Original.a, _ => new CmdResult.Success()));

        var committedCommands = new List<Command>();
        var committed = Assert.IsType<ReplacementResult.Committed>(CordModel.ReplaceCordEndpoint(
            [Original], endpoint, next, command => Accept(committedCommands, command)));
        Assert.Equal(2, committedCommands.Count);
        Assert.Equal("2A#1", Assert.IsType<CordEnd.Hole>(committed.Cords[0].a).hole);
        Assert.Equal(123, committed.Cords[0].r_uohm);

        var disconnectRejected = Assert.IsType<ReplacementResult.DisconnectRejected>(
            CordModel.ReplaceCordEndpoint([Original], endpoint, next, _ => Reject(CmdWhy.unknown_cord)));
        Assert.Equal(CmdWhy.unknown_cord, disconnectRejected.Why);

        var connectCalls = 0;
        var connectRejectedCommands = new List<Command>();
        var connectRejected = Assert.IsType<ReplacementResult.ConnectRejected>(CordModel.ReplaceCordEndpoint(
            [Original],
            endpoint,
            next,
            command =>
            {
                connectRejectedCommands.Add(command);
                if (command is Command.Connect && ++connectCalls == 1) return Reject(CmdWhy.hole_occupied);
                return new CmdResult.Success();
            }));
        Assert.Equal(CmdWhy.hole_occupied, connectRejected.Why);
        Assert.Equal(3, connectRejectedCommands.Count);
        var rollback = Assert.IsType<Command.Connect>(connectRejectedCommands[2]);
        Assert.Equal(Trace.formatCommand(0, new Command.Connect(7, Original.a, Original.b, 123)), Trace.formatCommand(0, rollback));

        connectCalls = 0;
        var rollbackRejected = Assert.IsType<ReplacementResult.RollbackRejected>(CordModel.ReplaceCordEndpoint(
            [Original],
            endpoint,
            next,
            command => command is Command.Disconnect
                ? new CmdResult.Success()
                : ++connectCalls == 1
                    ? Reject(CmdWhy.hole_occupied)
                    : Reject(CmdWhy.bad_target)));
        Assert.Equal(CmdWhy.hole_occupied, rollbackRejected.Why);
        Assert.Equal(CmdWhy.bad_target, rollbackRejected.RollbackWhy);
        Assert.Null(rollbackRejected.Cords);
    }

    [Fact]
    public void Cord_id_allocation_uses_lowest_unused_value_and_reports_exhaustion()
    {
        var cords = new[]
        {
            new State.Cord(0, new CordEnd.Free(), new CordEnd.Free(), 0),
            new State.Cord(2, new CordEnd.Free(), new CordEnd.Free(), 0),
        };
        var result = Assert.IsType<AddCordResult.Added>(CordModel.AddFreeCord(cords, _ => new CmdResult.Success()));
        Assert.Equal(1, result.Cord);

        var full = Enumerable.Range(0, 256)
            .Select(id => new State.Cord(id, new CordEnd.Free(), new CordEnd.Free(), 0))
            .ToArray();
        Assert.IsType<AddCordResult.Full>(CordModel.AddFreeCord(full, _ => throw new InvalidOperationException()));
    }

    [Fact]
    public void Tray_slots_are_cord_id_order_with_a_before_b_and_never_enter_state()
    {
        State.Cord[] cords =
        [
            new(9, new CordEnd.Free(), new CordEnd.Hole("1A#1"), 0),
            new(2, new CordEnd.Free(), new CordEnd.Free(), 0),
        ];

        Assert.Equal(
            [(2, CordSide.A, 0), (2, CordSide.B, 1), (9, CordSide.A, 2)],
            CordModel.FreeTraySlots(cords).Select(slot => (slot.Endpoint.Cord, slot.Endpoint.Side, slot.Index)));
        Assert.All(cords, cord =>
        {
            Assert.DoesNotContain("tray", cord.a.k, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("tray", cord.b.k, StringComparison.OrdinalIgnoreCase);
        });
    }

    [Fact]
    public void Occupancy_excludes_dragged_endpoint_before_same_end_detection()
    {
        State.Cord[] cords =
        [
            Original,
            new(8, new CordEnd.Hole("2A#1"), new CordEnd.Free(), 0),
        ];
        var endpoint = new EndpointRef(7, CordSide.A);

        Assert.False(CordModel.IsHoleOccupied(cords, "1A#1", endpoint));
        Assert.True(CordModel.IsHoleOccupied(cords, "2A#1", endpoint));
        Assert.IsType<DropResolution.Noop>(CordModel.ResolveCordDrop(
            cords,
            CordModel.BeginCordDrag(cords, endpoint),
            new CordDropTarget.Hole("1A#1")));
        var occupied = Assert.IsType<DropResolution.Cancelled>(CordModel.ResolveCordDrop(
            cords,
            CordModel.BeginCordDrag(cords, endpoint),
            new CordDropTarget.Hole("2A#1")));
        Assert.Equal(DropCancelReason.Occupied, occupied.Reason);
    }

    private static CmdResult Accept(List<Command> commands, Command command)
    {
        commands.Add(command);
        return new CmdResult.Success();
    }

    private static CmdResult Reject(CmdWhy why) => new CmdResult.Failure(why);
}
