using System;
using System.Collections.Generic;
using Minivac.Core;

namespace Minivac.Godot;

public enum CordSide { A, B }

public enum DropCancelReason { Cancel, Occupied, Outside }

public sealed record EndpointRef(int Cord, CordSide Side);

public sealed record FreeTraySlot(string Key, EndpointRef Endpoint, int Index);

public abstract record CordDropTarget
{
    public sealed record Hole(string Id) : CordDropTarget;
    public sealed record Tray : CordDropTarget;
    public sealed record Outside : CordDropTarget;
}

public sealed record CordDrag(EndpointRef Endpoint, CordEnd Origin, CordDropTarget? Preview);

public abstract record DropResolution
{
    public sealed record Replace(EndpointRef Endpoint, CordEnd From, CordEnd To) : DropResolution;
    public sealed record Noop(EndpointRef Endpoint, CordEnd End) : DropResolution;
    public sealed record Cancelled(EndpointRef Endpoint, DropCancelReason Reason, CordEnd End) : DropResolution;
}

public abstract record ReplacementResult
{
    public sealed record Noop(IReadOnlyList<State.Cord> Cords) : ReplacementResult;
    public sealed record Committed(IReadOnlyList<State.Cord> Cords) : ReplacementResult;
    public sealed record DisconnectRejected(CmdWhy Why, IReadOnlyList<State.Cord> Cords) : ReplacementResult;
    public sealed record ConnectRejected(CmdWhy Why, IReadOnlyList<State.Cord> Cords) : ReplacementResult;
    public sealed record RollbackRejected(CmdWhy Why, CmdWhy RollbackWhy, IReadOnlyList<State.Cord>? Cords = null) : ReplacementResult;
}

public abstract record AddCordResult
{
    public sealed record Added(int Cord, IReadOnlyList<State.Cord> Cords) : AddCordResult;
    public sealed record Full(IReadOnlyList<State.Cord> Cords) : AddCordResult;
    public sealed record Rejected(CmdWhy Why, IReadOnlyList<State.Cord> Cords) : AddCordResult;
}

public abstract record RemoveCordResult
{
    public sealed record Removed(int Cord, IReadOnlyList<State.Cord> Cords) : RemoveCordResult;
    public sealed record Rejected(CmdWhy Why, IReadOnlyList<State.Cord> Cords) : RemoveCordResult;
}

public sealed record MomentaryTouch(EndpointRef Endpoint, string Terminal);

public abstract record TouchStartResult
{
    public sealed record NotFree(IReadOnlyList<State.Cord> Cords) : TouchStartResult;
    public sealed record Started(MomentaryTouch Touch, IReadOnlyList<State.Cord> Cords) : TouchStartResult;
    public sealed record Rejected(ReplacementResult Replacement) : TouchStartResult;
}

public static class CordModel
{
    public static IReadOnlyList<EndpointRef> OrderedEndpoints(IReadOnlyList<State.Cord> cords)
    {
        var sorted = CloneCords(cords);
        var mutable = new List<State.Cord>(sorted);
        mutable.Sort((left, right) => left.id.CompareTo(right.id));
        var result = new EndpointRef[mutable.Count * 2];
        for (var index = 0; index < mutable.Count; index++)
        {
            result[index * 2] = new EndpointRef(mutable[index].id, CordSide.A);
            result[index * 2 + 1] = new EndpointRef(mutable[index].id, CordSide.B);
        }
        return Array.AsReadOnly(result);
    }

    public static IReadOnlyList<FreeTraySlot> FreeTraySlots(IReadOnlyList<State.Cord> cords)
    {
        var result = new List<FreeTraySlot>();
        foreach (var endpoint in OrderedEndpoints(cords))
        {
            if (EndpointEnd(cords, endpoint) is not CordEnd.Free) continue;
            result.Add(new FreeTraySlot(EndpointKey(endpoint), endpoint, result.Count));
        }
        return result.AsReadOnly();
    }

    public static bool IsHoleOccupied(
        IReadOnlyList<State.Cord> cords,
        string hole,
        EndpointRef? exclude = null)
    {
        foreach (var endpoint in OrderedEndpoints(cords))
        {
            if (exclude is not null && endpoint.Cord == exclude.Cord && endpoint.Side == exclude.Side)
                continue;
            if (EndpointEnd(cords, endpoint) is CordEnd.Hole candidate && candidate.hole == hole)
                return true;
        }
        return false;
    }

    public static AddCordResult AddFreeCord(
        IReadOnlyList<State.Cord> cords,
        Func<Command, CmdResult> apply)
    {
        var snapshot = CloneCords(cords);
        var used = new bool[256];
        foreach (var cord in snapshot)
            if (cord.id >= 0 && cord.id <= 255) used[cord.id] = true;
        var id = Array.FindIndex(used, value => !value);
        if (id < 0) return new AddCordResult.Full(snapshot);
        var result = apply(new Command.Connect(id, new CordEnd.Free(), new CordEnd.Free(), 0));
        if (result is CmdResult.Failure failure)
            return new AddCordResult.Rejected(failure.why, snapshot);
        var added = new State.Cord(id, new CordEnd.Free(), new CordEnd.Free(), 0);
        var next = new List<State.Cord>(snapshot) { added };
        return new AddCordResult.Added(id, next.AsReadOnly());
    }

    public static RemoveCordResult RemoveCord(
        IReadOnlyList<State.Cord> cords,
        int cord,
        Func<Command, CmdResult> apply)
    {
        var snapshot = CloneCords(cords);
        var result = apply(new Command.Disconnect(cord));
        if (result is CmdResult.Failure failure)
            return new RemoveCordResult.Rejected(failure.why, snapshot);
        var next = new List<State.Cord>();
        foreach (var candidate in snapshot)
            if (candidate.id != cord) next.Add(candidate);
        return new RemoveCordResult.Removed(cord, next.AsReadOnly());
    }

    public static CordDrag BeginCordDrag(IReadOnlyList<State.Cord> cords, EndpointRef endpoint) =>
        new(endpoint, CloneEnd(EndpointEnd(cords, endpoint)), null);

    public static CordDrag PreviewCordDrag(CordDrag drag, CordDropTarget target) =>
        new(drag.Endpoint, CloneEnd(drag.Origin), target);

    public static DropResolution CancelCordDrag(CordDrag drag) =>
        new DropResolution.Cancelled(drag.Endpoint, DropCancelReason.Cancel, CloneEnd(drag.Origin));

    public static DropResolution ResolveCordDrop(
        IReadOnlyList<State.Cord> cords,
        CordDrag drag,
        CordDropTarget? target = null)
    {
        target ??= drag.Preview ?? new CordDropTarget.Outside();
        if (target is CordDropTarget.Outside)
            return new DropResolution.Cancelled(drag.Endpoint, DropCancelReason.Outside, CloneEnd(drag.Origin));
        CordEnd next = target is CordDropTarget.Tray
            ? new CordEnd.Free()
            : new CordEnd.Hole(((CordDropTarget.Hole)target).Id);
        if (target is CordDropTarget.Hole hole && IsHoleOccupied(cords, hole.Id, drag.Endpoint))
            return new DropResolution.Cancelled(drag.Endpoint, DropCancelReason.Occupied, CloneEnd(drag.Origin));
        if (SameEnd(drag.Origin, next))
            return new DropResolution.Noop(drag.Endpoint, CloneEnd(drag.Origin));
        return new DropResolution.Replace(drag.Endpoint, CloneEnd(drag.Origin), CloneEnd(next));
    }

    public static ReplacementResult ReplaceCordEndpoint(
        IReadOnlyList<State.Cord> cords,
        EndpointRef endpoint,
        CordEnd nextEnd,
        Func<Command, CmdResult> apply)
    {
        var snapshot = CloneCords(cords);
        var cord = FindCord(snapshot, endpoint.Cord);
        var prior = endpoint.Side == CordSide.A ? cord.a : cord.b;
        if (SameEnd(prior, nextEnd)) return new ReplacementResult.Noop(snapshot);

        if (apply(new Command.Disconnect(cord.id)) is CmdResult.Failure disconnectFailure)
            return new ReplacementResult.DisconnectRejected(disconnectFailure.why, snapshot);

        var replacement = new State.Cord(
            cord.id,
            endpoint.Side == CordSide.A ? CloneEnd(nextEnd) : CloneEnd(cord.a),
            endpoint.Side == CordSide.B ? CloneEnd(nextEnd) : CloneEnd(cord.b),
            cord.r_uohm);
        if (apply(new Command.Connect(
            replacement.id,
            replacement.a,
            replacement.b,
            replacement.r_uohm)) is not CmdResult.Failure connectFailure)
        {
            var next = new State.Cord[snapshot.Count];
            for (var index = 0; index < next.Length; index++)
                next[index] = snapshot[index].id == replacement.id ? replacement : snapshot[index];
            return new ReplacementResult.Committed(Array.AsReadOnly(next));
        }

        if (apply(new Command.Connect(cord.id, cord.a, cord.b, cord.r_uohm)) is CmdResult.Failure rollbackFailure)
            return new ReplacementResult.RollbackRejected(connectFailure.why, rollbackFailure.why);
        return new ReplacementResult.ConnectRejected(connectFailure.why, snapshot);
    }

    public static TouchStartResult BeginMomentaryTouch(
        IReadOnlyList<State.Cord> cords,
        EndpointRef endpoint,
        string terminal,
        Func<Command, CmdResult> apply)
    {
        var snapshot = CloneCords(cords);
        if (EndpointEnd(snapshot, endpoint) is not CordEnd.Free)
            return new TouchStartResult.NotFree(snapshot);
        var replacement = ReplaceCordEndpoint(snapshot, endpoint, new CordEnd.Touch(terminal), apply);
        return replacement is ReplacementResult.Committed committed
            ? new TouchStartResult.Started(new MomentaryTouch(endpoint, terminal), committed.Cords)
            : new TouchStartResult.Rejected(replacement);
    }

    public static ReplacementResult EndMomentaryTouch(
        IReadOnlyList<State.Cord> cords,
        MomentaryTouch touch,
        Func<Command, CmdResult> apply) =>
        ReplaceCordEndpoint(cords, touch.Endpoint, new CordEnd.Free(), apply);

    public static string EndpointKey(EndpointRef endpoint) =>
        endpoint.Cord + ":" + (endpoint.Side == CordSide.A ? "a" : "b");

    private static IReadOnlyList<State.Cord> CloneCords(IReadOnlyList<State.Cord> cords)
    {
        var result = new State.Cord[cords.Count];
        for (var index = 0; index < result.Length; index++)
        {
            var cord = cords[index];
            result[index] = new State.Cord(cord.id, CloneEnd(cord.a), CloneEnd(cord.b), cord.r_uohm);
        }
        return Array.AsReadOnly(result);
    }

    private static State.Cord FindCord(IReadOnlyList<State.Cord> cords, int id)
    {
        foreach (var cord in cords)
            if (cord.id == id) return cord;
        throw new InvalidOperationException("cord model: unknown cord " + id);
    }

    private static CordEnd EndpointEnd(IReadOnlyList<State.Cord> cords, EndpointRef endpoint)
    {
        var cord = FindCord(cords, endpoint.Cord);
        return endpoint.Side == CordSide.A ? cord.a : cord.b;
    }

    private static CordEnd CloneEnd(CordEnd end) => end switch
    {
        CordEnd.Hole hole => new CordEnd.Hole(hole.hole),
        CordEnd.Touch touch => new CordEnd.Touch(touch.term),
        CordEnd.Free => new CordEnd.Free(),
        _ => throw new InvalidOperationException("cord model: unknown endpoint"),
    };

    private static bool SameEnd(CordEnd left, CordEnd right) => (left, right) switch
    {
        (CordEnd.Hole a, CordEnd.Hole b) => a.hole == b.hole,
        (CordEnd.Touch a, CordEnd.Touch b) => a.term == b.term,
        (CordEnd.Free, CordEnd.Free) => true,
        _ => false,
    };
}
