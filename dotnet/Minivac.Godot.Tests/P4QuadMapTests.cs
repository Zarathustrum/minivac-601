using System;
using System.IO;
using System.Linq;
using Godot;
using Minivac.Conformance;
using Minivac.Core;
using Xunit;

namespace Minivac.Godot.Tests;

public sealed class P4QuadMapTests
{
    private static readonly Vector2 QuadSize = new(1, 1f / 1.8f);
    private static readonly Vector2I ViewportSize = new(2880, 1600);

    [Fact]
    public void Four_corners_and_centre_map_to_hand_computed_pixels()
    {
        var transform = FixedTransform();
        var half = QuadSize / 2;
        var samples = new[]
        {
            (new Vector3(-half.X, half.Y, 0), new Vector2(0, 0)),
            (new Vector3(half.X, half.Y, 0), new Vector2(ViewportSize.X, 0)),
            (new Vector3(-half.X, -half.Y, 0), new Vector2(0, ViewportSize.Y)),
            (new Vector3(half.X, -half.Y, 0), new Vector2(ViewportSize.X, ViewportSize.Y)),
            (Vector3.Zero, new Vector2(ViewportSize.X / 2f, ViewportSize.Y / 2f)),
        };

        foreach (var (local, expected) in samples)
        {
            var actual = QuadMap.PixelFromWorld(transform * local, transform, QuadSize, ViewportSize);
            Assert.Equal(expected.X, actual.X, 3);
            Assert.Equal(expected.Y, actual.Y, 3);
        }
    }

    [Fact]
    public void All_hole_samples_obey_the_live_hit_rect_tolerance()
    {
        var layout = LoadLayout();
        var frame = new PanelFrame(0, 0, ViewportSize.X, ViewportSize.Y);
        var transform = FixedTransform();
        var offsets = new[]
        {
            new Vector2(0, 0),
            new Vector2(14, 0),
            new Vector2(-14, 0),
            new Vector2(0, 14),
            new Vector2(0, -14),
        };

        foreach (var offset in offsets)
        {
            var inside = layout.Holes.Count(hole =>
            {
                var centre = layout.ProjectHoleCenter(hole.Id, frame);
                var world = transform * LocalFromPixel(centre + offset);
                return Contains(layout.HoleRect(hole.Id, frame),
                    QuadMap.PixelFromWorld(world, transform, QuadSize, ViewportSize));
            });
            Assert.True(inside == 392, $"offset {offset}: {inside}/392");
        }

        foreach (var offset in new[] { new Vector2(16, 0), new Vector2(-16, 0) })
        {
            var inside = layout.Holes.Count(hole =>
            {
                var centre = layout.ProjectHoleCenter(hole.Id, frame);
                var world = transform * LocalFromPixel(centre + offset);
                return Contains(layout.HoleRect(hole.Id, frame),
                    QuadMap.PixelFromWorld(world, transform, QuadSize, ViewportSize));
            });
            Assert.True(inside == 0, $"negative offset {offset}: {inside}/392");
        }
    }

    [Fact]
    public void QuadMap_has_only_the_specified_public_member()
    {
        var methods = typeof(QuadMap).GetMethods()
            .Where(method => method.DeclaringType == typeof(QuadMap) && method.IsPublic)
            .ToArray();

        Assert.Single(methods);
        Assert.Equal(nameof(QuadMap.PixelFromWorld), methods[0].Name);
    }

    private static Vector3 LocalFromPixel(Vector2 pixel)
    {
        var uv = pixel / new Vector2(ViewportSize.X, ViewportSize.Y);
        return new Vector3(
            (uv.X - 0.5f) * QuadSize.X,
            -(uv.Y - 0.5f) * QuadSize.Y,
            0);
    }

    private static bool Contains(PanelRect rect, Vector2 point) =>
        point.X >= rect.X && point.X <= rect.X + rect.Width &&
        point.Y >= rect.Y && point.Y <= rect.Y + rect.Height;

    private static Transform3D FixedTransform()
    {
        var angle = 30 * Math.PI / 180;
        var cosine = (float)Math.Cos(angle);
        var sine = (float)Math.Sin(angle);
        var basis = new Basis(
            new Vector3(1.2f * cosine, 1.2f * sine, 0),
            new Vector3(-0.8f * sine, 0.8f * cosine, 0),
            Vector3.Back);
        return new Transform3D(basis, new Vector3(0.6f, -0.4f, 0.05f));
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
