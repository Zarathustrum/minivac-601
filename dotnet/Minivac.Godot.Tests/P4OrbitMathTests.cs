using System;
using System.IO;
using System.Linq;
using Godot;
using Minivac.Conformance;
using Minivac.Core;
using Xunit;
using Xunit.Abstractions;

namespace Minivac.Godot.Tests;

public sealed class P4OrbitMathTests(ITestOutputHelper output)
{
    private static readonly Vector2 QuadSize = new(1, 1f / 1.8f);
    private static readonly Vector2I ViewportSize = new(2880, 1600);
    private static readonly Vector2I BindingWindow = new(1440, 900);
    private static readonly Vector2I ObservationWindow = new(1920, 1080);

    [Fact]
    public void ClampPose_applies_the_closed_camera_envelope()
    {
        var low = OrbitMath.ClampPose(new Pose(-100, -100, -100));
        var high = OrbitMath.ClampPose(new Pose(100, 100, 100));
        Assert.Equal(25, low.ElevationDeg);
        Assert.Equal(-60, low.AzimuthDeg);
        Assert.Equal(0.6, low.DollyW, 6);
        Assert.Equal(90, high.ElevationDeg);
        Assert.Equal(60, high.AzimuthDeg);
        Assert.Equal(2.2, high.DollyW, 6);
        Assert.Equal(new Pose(55, 0, 1.6), OrbitMath.ClampPose(new Pose(55, 0, 1.6)));
    }

    [Fact]
    public void Project_places_the_target_at_window_centre()
    {
        var projected = OrbitMath.Project(Vector3.Zero, new Pose(55, 0, 1.6), 45, BindingWindow);

        Assert.Equal(BindingWindow.X / 2f, projected.X, 4);
        Assert.Equal(BindingWindow.Y / 2f, projected.Y, 4);
    }

    [Fact]
    public void Wire_pose_is_the_largest_feasible_dolly_at_the_fixed_elevation()
    {
        var layout = LoadLayout();
        var solved = SolveWireDolly(layout);
        var wire = OrbitMath.WireDolly(new Pose(80, 17, 1.1));
        var binding = WorstExtent(layout, wire with { DollyW = solved }, BindingWindow);
        var observation = WorstExtent(layout, wire with { DollyW = solved }, ObservationWindow);

        output.WriteLine(
            $"window={BindingWindow.X}x{BindingWindow.Y} fov={TactileTheme.CameraWireFovDeg.Value:0.######} " +
            $"elevation={wire.ElevationDeg:0.######} " +
            $"cameraWireDollyW={solved:0.######} worstAzimuth={binding.Azimuth:0.######} " +
            $"minimumExtent={binding.Extent:0.######}");
        output.WriteLine(
            $"window={ObservationWindow.X}x{ObservationWindow.Y} fov={TactileTheme.CameraWireFovDeg.Value:0.######} " +
            $"elevation={wire.ElevationDeg:0.######} " +
            $"cameraWireDollyW={solved:0.######} worstAzimuth={observation.Azimuth:0.######} " +
            $"minimumExtent={observation.Extent:0.######}");

        Assert.InRange(solved, TactileTheme.CameraDollyMinW.Value, TactileTheme.CameraDolly.Value.Y);
        Assert.True(binding.Extent >= 24, $"minimum extent {binding.Extent:0.######} is below 24 px");
        Assert.Equal(solved, wire.DollyW, 5);
        Assert.Equal(TactileTheme.CameraWireElevationDeg.Value, wire.ElevationDeg);
        Assert.Equal(17, wire.AzimuthDeg);
    }

    private static double SolveWireDolly(PanelLayout layout)
    {
        var intervalLow = TactileTheme.CameraDollyMinW.Value;
        var intervalHigh = (double)TactileTheme.CameraDolly.Value.Y;
        var pose = new Pose(TactileTheme.CameraWireElevationDeg.Value, 0, intervalLow);
        var best = (Extent: double.NegativeInfinity, Dolly: intervalLow, Azimuth: 0.0);
        double? low = null;
        var high = intervalHigh;
        const int searchSteps = 1000;
        for (var step = 0; step <= searchSteps; step++)
        {
            var dolly = intervalHigh - (intervalHigh - intervalLow) * step / searchSteps;
            var result = WorstExtent(layout, pose with { DollyW = dolly }, BindingWindow);
            if (result.Extent > best.Extent) best = (result.Extent, dolly, result.Azimuth);
            if (result.Extent < 24) continue;
            low = dolly;
            break;
        }
        if (low is null)
            throw new InvalidOperationException(
                $"no feasible wire dolly in [{intervalLow:0.######},{intervalHigh:0.######}]; " +
                $"bestDolly={best.Dolly:0.######} extent={best.Extent:0.######} azimuth={best.Azimuth:0.######}");
        for (var iteration = 0; iteration < 80; iteration++)
        {
            var middle = (low.Value + high) / 2;
            if (WorstExtent(layout, pose with { DollyW = middle }, BindingWindow).Extent >= 24)
                low = middle;
            else
                high = middle;
        }
        return low.Value;
    }

    private static (double Extent, double Azimuth) WorstExtent(
        PanelLayout layout,
        Pose pose,
        Vector2I window)
    {
        var worstExtent = double.PositiveInfinity;
        var worstAzimuth = 0.0;
        foreach (var azimuth in new[]
        {
            TactileTheme.CameraAzimuthDeg.Value.X,
            TactileTheme.CameraAzimuthDeg.Value.Y,
        })
        {
            var candidate = pose with { AzimuthDeg = azimuth };
            foreach (var hole in layout.Holes)
            {
                var rect = layout.HoleRect(hole.Id, new PanelFrame(0, 0, ViewportSize.X, ViewportSize.Y));
                var corners = new[]
                {
                    LocalFromPixel(new Vector2((float)rect.X, (float)rect.Y)),
                    LocalFromPixel(new Vector2((float)(rect.X + rect.Width), (float)rect.Y)),
                    LocalFromPixel(new Vector2((float)rect.X, (float)(rect.Y + rect.Height))),
                    LocalFromPixel(new Vector2((float)(rect.X + rect.Width), (float)(rect.Y + rect.Height))),
                }.Select(point => OrbitMath.Project(point, candidate, TactileTheme.CameraWireFovDeg.Value, window)).ToArray();
                var width = corners.Max(point => point.X) - corners.Min(point => point.X);
                var height = corners.Max(point => point.Y) - corners.Min(point => point.Y);
                var extent = Math.Min(width, height);
                if (extent < worstExtent)
                {
                    worstExtent = extent;
                    worstAzimuth = azimuth;
                }
            }
        }
        return (worstExtent, worstAzimuth);
    }

    private static Vector3 LocalFromPixel(Vector2 pixel)
    {
        var uv = pixel / new Vector2(ViewportSize.X, ViewportSize.Y);
        return new Vector3(
            (uv.X - 0.5f) * QuadSize.X,
            -(uv.Y - 0.5f) * QuadSize.Y,
            0);
    }

    private static PanelLayout LoadLayout()
    {
        IArtifactSource source = new FileSystemSource(RepoRoot());
        var netlist = Netlist.LoadNetlist(source.ReadAllBytes("data/netlist.json"));
        return PanelLayout.Parse(source.ReadAllBytes("data/panel-layout.json"), new NetlistView(netlist));
    }

    private static string RepoRoot() =>
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../.."));

    private sealed class NetlistView(LoadedNetlist netlist) : IRawNetlistView
    {
        public System.Collections.Generic.IReadOnlyList<RawTerminalView> Terminals { get; } =
            netlist.terminals.Select(terminal => new RawTerminalView(terminal.id, terminal.holes)).ToArray();
    }
}
