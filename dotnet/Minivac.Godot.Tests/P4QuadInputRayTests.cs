using System;
using System.IO;
using System.Linq;
using Godot;
using Minivac.Conformance;
using Minivac.Core;
using Xunit;

namespace Minivac.Godot.Tests;

public sealed class P4QuadInputRayTests
{
    private static readonly Vector2 QuadSize = new(1, 1f / 1.8f);
    private static readonly Vector2I ViewportSize = new(2880, 1600);
    private static readonly PanelLayout Layout = LoadLayout();
    private static readonly PanelFrame Frame = new(0, 0, ViewportSize.X, ViewportSize.Y);

    [Fact]
    public void The_captured_drag_sentinel_lands_on_a_real_hole()
    {
        // Godot delivers a captured drag that has left the shape with world position exactly
        // (0,0,0); PanelQuad.GlobalTransform is identity, so that is the panel centre.
        var pixel = QuadMap.PixelFromWorld(Vector3.Zero, Transform3D.Identity, QuadSize, ViewportSize);

        Assert.Equal(ViewportSize.X / 2f, pixel.X, 3);
        Assert.Equal(ViewportSize.Y / 2f, pixel.Y, 3);
        Assert.Equal("5G#1", Assert.Single(HolesUnder(pixel)));
    }

    [Fact]
    public void A_ray_that_misses_the_quad_resolves_outside_every_hole()
    {
        var target = new Vector3(5, 5, 0);

        var point = QuadInput.QuadPointFromRay(CameraOrigin(), Toward(target), Transform3D.Identity);

        Assert.Equal(target.X, point.X, 3);
        Assert.Equal(target.Y, point.Y, 3);
        Assert.Empty(HolesUnder(QuadMap.PixelFromWorld(point, Transform3D.Identity, QuadSize, ViewportSize)));
    }

    [Fact]
    public void A_ray_parallel_to_the_quad_plane_resolves_outside_every_hole()
    {
        var point = QuadInput.QuadPointFromRay(CameraOrigin(), Vector3.Right, Transform3D.Identity);

        Assert.Empty(HolesUnder(QuadMap.PixelFromWorld(point, Transform3D.Identity, QuadSize, ViewportSize)));
    }

    [Fact]
    public void A_ray_pointing_away_from_the_quad_resolves_outside_every_hole()
    {
        var point = QuadInput.QuadPointFromRay(CameraOrigin(), Vector3.Back, Transform3D.Identity);

        Assert.Empty(HolesUnder(QuadMap.PixelFromWorld(point, Transform3D.Identity, QuadSize, ViewportSize)));
    }

    [Fact]
    public void A_ray_through_a_hole_centre_resolves_back_to_that_hole()
    {
        foreach (var transform in new[] { Transform3D.Identity, TiltedQuad() })
        {
            foreach (var hole in Layout.Holes)
            {
                var centre = Layout.ProjectHoleCenter(hole.Id, Frame);
                var world = transform * LocalFromPixel(centre);
                var origin = CameraOrigin();
                var point = QuadInput.QuadPointFromRay(origin, (world - origin).Normalized(), transform);
                var pixel = QuadMap.PixelFromWorld(point, transform, QuadSize, ViewportSize);

                Assert.Contains(hole.Id, HolesUnder(pixel));
            }
        }
    }

    private static Vector3 CameraOrigin()
    {
        var pose = TactileTheme.CameraDefaultPose.Value;
        var elevation = pose.ElevationDeg * Math.PI / 180;
        var azimuth = pose.AzimuthDeg * Math.PI / 180;
        var planar = Math.Cos(elevation) * pose.DollyW;
        return new Vector3(
            (float)(Math.Sin(azimuth) * planar),
            (float)(-Math.Cos(azimuth) * planar),
            (float)(Math.Sin(elevation) * pose.DollyW));
    }

    private static Vector3 Toward(Vector3 target) => (target - CameraOrigin()).Normalized();

    private static string[] HolesUnder(Vector2 pixel) => Layout.Holes
        .Where(hole => Contains(Layout.HoleRect(hole.Id, Frame), pixel))
        .Select(hole => hole.Id)
        .ToArray();

    private static bool Contains(PanelRect rect, Vector2 point) =>
        point.X >= rect.X && point.X <= rect.X + rect.Width &&
        point.Y >= rect.Y && point.Y <= rect.Y + rect.Height;

    private static Vector3 LocalFromPixel(Vector2 pixel)
    {
        var uv = pixel / new Vector2(ViewportSize.X, ViewportSize.Y);
        return new Vector3(
            (uv.X - 0.5f) * QuadSize.X,
            -(uv.Y - 0.5f) * QuadSize.Y,
            0);
    }

    private static Transform3D TiltedQuad()
    {
        var angle = 20 * Math.PI / 180;
        var cosine = (float)Math.Cos(angle);
        var sine = (float)Math.Sin(angle);
        return new Transform3D(
            new Basis(
                Vector3.Right,
                new Vector3(0, cosine, sine),
                new Vector3(0, -sine, cosine)),
            new Vector3(0.05f, -0.02f, 0.1f));
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
