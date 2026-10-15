using System;
using System.Collections.Generic;
using Godot;

namespace Minivac.Godot;

public sealed record CordRecord(int Id, Vector2 A, Vector2 B);

// This is presentation physics only. It consumes the render callback's timestamp and has no
// machine, command, input or ambient-clock surface.
public sealed class CordLay
{
    private sealed class LaidCord
    {
        public LaidCord(CordRecord record, Vector3[] positions)
        {
            Record = record;
            Positions = positions;
            Previous = (Vector3[])positions.Clone();
        }

        public CordRecord Record;
        public readonly Vector3[] Positions;
        public readonly Vector3[] Previous;
        public int Steps;
        public bool Settled;
    }

    private readonly Dictionary<int, LaidCord> _cords = [];
    private long? _lastUs;
    private long _accumulator;

    public int Step(long nowUs)
    {
        _lastUs ??= nowUs;
        var dtUs = Math.Clamp(nowUs - _lastUs.Value, 0, 50_000);
        _accumulator += dtUs * TactileTheme.DtStep.Value;
        var steps = _accumulator / 1_000_000;
        _accumulator %= 1_000_000;
        for (long step = 0; step < steps; step++) AdvanceAll();
        _lastUs = nowUs;
        return (int)steps;
    }

    public void Reconcile(IReadOnlyList<CordRecord> cords)
    {
        ArgumentNullException.ThrowIfNull(cords);
        var live = new HashSet<int>();
        foreach (var record in cords)
        {
            if (!live.Add(record.Id))
                throw new InvalidOperationException("cord lay: duplicate cord " + record.Id);
            if (_cords.TryGetValue(record.Id, out var laid))
            {
                if (laid.Record == record) continue;
                laid.Record = record;
                Pin(laid);
                laid.Steps = 0;
                laid.Settled = false;
                continue;
            }

            laid = new LaidCord(record, Seed(record));
            _cords.Add(record.Id, laid);
            Settle(laid);
        }

        var removed = new List<int>();
        foreach (var id in _cords.Keys)
            if (!live.Contains(id)) removed.Add(id);
        foreach (var id in removed) _cords.Remove(id);
    }

    public IReadOnlyList<Vector3> Particles(int cordId) =>
        _cords.TryGetValue(cordId, out var cord)
            ? cord.Positions
            : throw new InvalidOperationException("cord lay: missing cord " + cordId);

    public void SettleNow()
    {
        foreach (var cord in _cords.Values) Settle(cord);
    }

    private void AdvanceAll()
    {
        foreach (var cord in _cords.Values)
        {
            if (cord.Settled) continue;
            Advance(cord);
            cord.Steps++;
            if (cord.Steps >= TactileTheme.ConvergeSteps.Value) Freeze(cord);
        }
    }

    private static Vector3[] Seed(CordRecord record)
    {
        var count = TactileTheme.CordSegments.Value;
        var positions = new Vector3[count];
        var a = Pin(record.A);
        var b = Pin(record.B);
        var across = new Vector3(b.X - a.X, b.Y - a.Y, 0);
        var pinDistance = across.Length();
        var restLength = pinDistance * (float)TactileTheme.CordSlack.Value +
            (float)(2 * TactileTheme.TaperPinStub.Value);
        var bowLength = (float)(0.5 * Math.Sqrt(Math.Max(restLength * restLength - pinDistance * pinDistance, 0)));
        var perpendicular = pinDistance > 0
            ? new Vector3(-across.Y, across.X, 0) / pinDistance
            : Vector3.Right;
        var stub = (float)TactileTheme.TaperPinStub.Value;
        var plane = (float)TactileTheme.CordRadius.Value;
        for (var index = 0; index < count; index++)
        {
            var t = (float)index / (count - 1);
            var curve = (float)Math.Sin(Math.PI * t);
            positions[index] = a.Lerp(b, t) + perpendicular * bowLength * curve;
            positions[index].Z = stub - (stub - plane) * curve;
        }
        return positions;
    }

    private static void Settle(LaidCord cord)
    {
        if (cord.Settled) return;
        while (cord.Steps < TactileTheme.ConvergeSteps.Value)
        {
            Advance(cord);
            cord.Steps++;
        }
        Freeze(cord);
    }

    private static void Freeze(LaidCord cord)
    {
        Array.Copy(cord.Positions, cord.Previous, cord.Positions.Length);
        cord.Settled = true;
    }

    private static void Advance(LaidCord cord)
    {
        var gravity = new Vector3(0, 0, (float)-TactileTheme.CordGravityWPerStep2.Value);
        var damping = (float)TactileTheme.CordDamping.Value;
        for (var index = 1; index < cord.Positions.Length - 1; index++)
        {
            var current = cord.Positions[index];
            cord.Positions[index] += (current - cord.Previous[index]) * damping + gravity;
            cord.Previous[index] = current;
        }

        var pinDistance = cord.Record.A.DistanceTo(cord.Record.B);
        var restLength = pinDistance * (float)TactileTheme.CordSlack.Value +
            (float)(2 * TactileTheme.TaperPinStub.Value);
        var segmentLength = restLength / (cord.Positions.Length - 1);
        for (var iteration = 0; iteration < TactileTheme.CordRelaxIterations.Value; iteration++)
        {
            for (var index = 0; index < cord.Positions.Length - 1; index++)
                RelaxPair(cord.Positions, index, segmentLength);
            ConstrainToPlane(cord.Positions);
            Pin(cord);
        }
    }

    private static void RelaxPair(Vector3[] positions, int index, float restLength)
    {
        var delta = positions[index + 1] - positions[index];
        var distance = delta.Length();
        if (distance == 0) return;
        var correction = delta * ((distance - restLength) / distance);
        if (index == 0)
        {
            positions[index + 1] -= correction;
        }
        else if (index + 1 == positions.Length - 1)
        {
            positions[index] += correction;
        }
        else
        {
            positions[index] += correction * 0.5f;
            positions[index + 1] -= correction * 0.5f;
        }
    }

    private static void ConstrainToPlane(Vector3[] positions)
    {
        var plane = (float)TactileTheme.CordRadius.Value;
        for (var index = 1; index < positions.Length - 1; index++)
            positions[index].Z = Math.Max(positions[index].Z, plane);
    }

    private static void Pin(LaidCord cord)
    {
        cord.Positions[0] = Pin(cord.Record.A);
        cord.Positions[^1] = Pin(cord.Record.B);
        cord.Previous[0] = cord.Positions[0];
        cord.Previous[^1] = cord.Positions[^1];
    }

    private static Vector3 Pin(Vector2 point) =>
        new(point.X, point.Y, (float)TactileTheme.TaperPinStub.Value);
}
