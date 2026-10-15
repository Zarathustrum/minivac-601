using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Godot;
using Minivac.Conformance;
using Minivac.Core;
using Xunit;
using Xunit.Abstractions;

namespace Minivac.Godot.Tests;

public sealed class P5CordLayTests(ITestOutputHelper output)
{
    private static readonly CordRecord ShortCord = new(
        7,
        new Vector2(-0.2f, 0.1f),
        new Vector2(0.2f, -0.1f));

    [Fact]
    public void Endpoints_stay_pinned_at_the_top_of_the_taper_pin_stubs()
    {
        var lay = NewLay(ShortCord);
        var moved = Move(ShortCord);
        lay.Reconcile([moved]);

        DriveFixedSteps(lay, TactileTheme.ConvergeSteps.Value);

        var particles = lay.Particles(ShortCord.Id);
        Assert.Equal(Pin(moved.A), particles[0]);
        Assert.Equal(Pin(moved.B), particles[^1]);
    }

    [Fact]
    public void Plane_constraint_holds_for_every_particle_at_every_step()
    {
        var lay = NewLay(ShortCord);
        lay.Reconcile([Move(ShortCord)]);
        lay.Step(0);

        for (var step = 1; step <= TactileTheme.ConvergeSteps.Value; step++)
        {
            Assert.Equal(1, lay.Step(StepTime(step)));
            Assert.All(lay.Particles(ShortCord.Id), particle =>
                Assert.True(particle.Z >= (float)TactileTheme.CordRadius.Value, particle.ToString()));
        }
    }

    [Fact]
    public void Every_tic_tac_toe_cord_is_converged_within_the_configured_limit()
    {
        var records = TicTacToeRecords().Select(Move).ToArray();
        var lay = NewLay(TicTacToeRecords());
        lay.Reconcile(records);
        DriveFixedSteps(lay, TactileTheme.ConvergeSteps.Value - 1);
        var beforeLastStep = Snapshot(lay, records);
        Assert.Equal(1, lay.Step(StepTime(TactileTheme.ConvergeSteps.Value)));
        var converged = Snapshot(lay, records);
        var terminalMovement = MaximumMovement(beforeLastStep, converged);

        Assert.Equal(1, lay.Step(StepTime(TactileTheme.ConvergeSteps.Value + 1)));

        output.WriteLine($"terminal movement={terminalMovement:R}");
        Assert.True(
            terminalMovement <= TactileTheme.RebuildEpsilon.Value,
            $"terminal movement={terminalMovement:R}");
        AssertSnapshotsEqual(converged, Snapshot(lay, records));
    }

    [Fact]
    public void Every_particle_remains_finite_at_every_fixed_step()
    {
        var original = TicTacToeRecords();
        var records = original.Select(Move).ToArray();
        var lay = NewLay(original);
        lay.Reconcile(records);
        lay.Step(0);

        for (var step = 1; step <= TactileTheme.ConvergeSteps.Value; step++)
        {
            Assert.Equal(1, lay.Step(StepTime(step)));
            Assert.All(Snapshot(lay, records).SelectMany(pair => pair.Value), particle =>
                Assert.True(float.IsFinite(particle.X) && float.IsFinite(particle.Y) && float.IsFinite(particle.Z)));
        }
    }

    [Fact]
    public void Identical_time_sequences_produce_byte_identical_particle_arrays()
    {
        var records = TicTacToeRecords();
        var a = NewLay(records);
        var b = NewLay(records);
        var moved = records.Select(Move).ToArray();
        a.Reconcile(moved);
        b.Reconcile(moved);
        long[] times = [0, 62, 4_167, 8_333, 12_500, 50_000, 50_125, 100_125];

        foreach (var nowUs in times)
        {
            a.Step(nowUs);
            b.Step(nowUs);
        }

        AssertSnapshotsEqual(Snapshot(a, moved), Snapshot(b, moved));
    }

    [Fact]
    public void One_fifty_millisecond_frame_equals_the_same_time_in_small_frames()
    {
        var oneFrame = NewLay(ShortCord);
        var smallFrames = NewLay(ShortCord);
        var moved = Move(ShortCord);
        oneFrame.Reconcile([moved]);
        smallFrames.Reconcile([moved]);
        oneFrame.Step(0);
        smallFrames.Step(0);

        var oneFrameSteps = oneFrame.Step(50_000);
        var smallFrameSteps = 0;
        for (var nowUs = 2_000L; nowUs <= 50_000; nowUs += 2_000)
            smallFrameSteps += smallFrames.Step(nowUs);

        output.WriteLine($"one-50ms-frame steps={oneFrameSteps}; small-frames steps={smallFrameSteps}");
        Assert.Equal(oneFrameSteps, smallFrameSteps);
        AssertSnapshotsEqual(Snapshot(oneFrame, [moved]), Snapshot(smallFrames, [moved]));
    }

    [Fact]
    public void Reconcile_and_remount_hold_exactly_the_new_cord_set()
    {
        CordRecord[] original =
        [
            ShortCord,
            new(9, new Vector2(-0.4f, 0), new Vector2(0.4f, 0)),
        ];
        CordRecord[] replacement =
        [
            original[1] with { A = new Vector2(-0.3f, -0.1f) },
            new(12, new Vector2(-0.1f, -0.2f), new Vector2(0.3f, 0.2f)),
        ];
        var mounted = NewLay(original);
        mounted.Reconcile(replacement);
        mounted.SettleNow();

        var remounted = NewLay(replacement);

        Assert.Throws<InvalidOperationException>(() => mounted.Particles(ShortCord.Id));
        Assert.All(replacement, record =>
        {
            Assert.Equal(TactileTheme.CordSegments.Value, mounted.Particles(record.Id).Count);
            Assert.Equal(TactileTheme.CordSegments.Value, remounted.Particles(record.Id).Count);
        });
    }

    [Fact]
    public void Cord_layer_has_no_command_surface()
    {
        var commandType = typeof(Command);
        var members = typeof(CordLay).GetMembers()
            .SelectMany(member => member switch
            {
                System.Reflection.MethodInfo method =>
                    method.GetParameters().Select(parameter => parameter.ParameterType).Append(method.ReturnType),
                System.Reflection.ConstructorInfo constructor =>
                    constructor.GetParameters().Select(parameter => parameter.ParameterType),
                _ => [],
            });

        Assert.DoesNotContain(members, type => type == commandType || type.Namespace == commandType.Namespace);
    }

    [Fact]
    public void Reduce_motion_settles_a_changed_cord_in_the_first_render()
    {
        var lay = NewLay(ShortCord);
        var changed = ShortCord with { B = new Vector2(0.35f, -0.15f) };
        lay.Reconcile([changed]);

        lay.SettleNow();
        var firstRender = Snapshot(lay, [changed]);
        lay.SettleNow();

        var movement = MaximumMovement(firstRender, Snapshot(lay, [changed]));
        Assert.True(movement <= TactileTheme.RebuildEpsilon.Value, $"movement={movement:R}");
    }

    private static CordLay NewLay(params CordRecord[] records) => NewLay((IReadOnlyList<CordRecord>)records);

    private static CordLay NewLay(IReadOnlyList<CordRecord> records)
    {
        var lay = new CordLay();
        lay.Reconcile(records);
        return lay;
    }

    private static void DriveFixedSteps(CordLay lay, int count)
    {
        lay.Step(0);
        for (var step = 1; step <= count; step++)
            Assert.Equal(1, lay.Step(StepTime(step)));
    }

    private static long StepTime(int step) =>
        (step * 1_000_000L + TactileTheme.DtStep.Value - 1) / TactileTheme.DtStep.Value;

    private static Vector3 Pin(Vector2 point) => new(point.X, point.Y, (float)TactileTheme.TaperPinStub.Value);

    private static CordRecord Move(CordRecord record) => record with { B = record.B + new Vector2(0.001f, 0) };

    private static IReadOnlyList<CordRecord> TicTacToeRecords()
    {
        IArtifactSource source = new FileSystemSource(RepoRoot());
        var netlist = Netlist.LoadNetlist(source.ReadAllBytes("data/netlist.json"));
        var layout = PanelLayout.Parse(source.ReadAllBytes("data/panel-layout.json"), new NetlistView(netlist));
        var demo = DemoLibrary.Load(source, netlist).Get("VI-TICTACTOE");
        var stateCords = demo.Connections.Select((connection, id) =>
            new State.Cord(id, connection.A, connection.B, connection.ResistanceUohm ?? 0)).ToArray();
        var traySlots = CordModel.FreeTraySlots(stateCords);
        return demo.Connections.Select((connection, id) => new CordRecord(
            id,
            Point(connection.A, new EndpointRef(id, CordSide.A), layout, traySlots),
            Point(connection.B, new EndpointRef(id, CordSide.B), layout, traySlots))).ToArray();
    }

    private static Vector2 Point(
        CordEnd end,
        EndpointRef endpoint,
        PanelLayout layout,
        IReadOnlyList<FreeTraySlot> traySlots)
    {
        if (end is CordEnd.Free)
        {
            var slot = Assert.Single(traySlots, item => item.Endpoint == endpoint);
            var t = (float)(slot.Index + 1) / (traySlots.Count + 1);
            return new Vector2(t - 0.5f, (float)(-0.5 / PanelLayout.PanelAspect));
        }
        var holeId = end switch
        {
            CordEnd.Hole hole => hole.hole,
            CordEnd.Touch touch => Assert.Single(layout.Terminals, terminal => terminal.Id == touch.term).Holes[0].Id,
            _ => throw new InvalidOperationException("test: unknown cord end"),
        };
        var holeView = Assert.Single(layout.Holes, item => item.Id == holeId);
        return new Vector2(
            (float)holeView.X - 0.5f,
            (0.5f - (float)holeView.Y) / (float)PanelLayout.PanelAspect);
    }

    private static IReadOnlyDictionary<int, Vector3[]> Snapshot(CordLay lay) =>
        Snapshot(lay, TicTacToeRecords());

    private static IReadOnlyDictionary<int, Vector3[]> Snapshot(
        CordLay lay,
        IReadOnlyList<CordRecord> records) =>
        records.ToDictionary(record => record.Id, record => lay.Particles(record.Id).ToArray());

    private static double MaximumMovement(
        IReadOnlyDictionary<int, Vector3[]> before,
        IReadOnlyDictionary<int, Vector3[]> after) =>
        before.Max(pair => pair.Value.Zip(after[pair.Key], (a, b) => a.DistanceTo(b)).Max());

    private static void AssertSnapshotsEqual(
        IReadOnlyDictionary<int, Vector3[]> expected,
        IReadOnlyDictionary<int, Vector3[]> actual)
    {
        Assert.Equal(expected.Keys.Order(), actual.Keys.Order());
        foreach (var id in expected.Keys)
        {
            Assert.Equal(expected[id].Length, actual[id].Length);
            for (var index = 0; index < expected[id].Length; index++)
            {
                Assert.Equal(BitConverter.SingleToInt32Bits(expected[id][index].X), BitConverter.SingleToInt32Bits(actual[id][index].X));
                Assert.Equal(BitConverter.SingleToInt32Bits(expected[id][index].Y), BitConverter.SingleToInt32Bits(actual[id][index].Y));
                Assert.Equal(BitConverter.SingleToInt32Bits(expected[id][index].Z), BitConverter.SingleToInt32Bits(actual[id][index].Z));
            }
        }
    }

    private static string RepoRoot() =>
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../.."));

    private sealed class NetlistView(LoadedNetlist netlist) : IRawNetlistView
    {
        public IReadOnlyList<RawTerminalView> Terminals { get; } =
            netlist.terminals.Select(terminal => new RawTerminalView(terminal.id, terminal.holes)).ToArray();
    }
}
