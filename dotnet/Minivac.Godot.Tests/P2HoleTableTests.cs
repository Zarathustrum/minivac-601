using System;
using System.IO;
using System.Linq;
using Minivac.Conformance;
using Minivac.Core;
using Xunit;

namespace Minivac.Godot.Tests;

public sealed class P2HoleTableTests
{
    [Fact]
    public void Panel_layout_matches_all_392_holes_in_netlist_order()
    {
        IArtifactSource source = new FileSystemSource(RepoRoot());
        var netlist = Netlist.LoadNetlist(source.ReadAllBytes("data/netlist.json"));
        var layout = PanelLayout.Parse(
            source.ReadAllBytes("data/panel-layout.json"),
            new NetlistView(netlist));

        Assert.Equal(186, layout.Terminals.Count);
        Assert.Equal(392, layout.Holes.Count);
        Assert.Equal(
            netlist.terminals.SelectMany(terminal =>
                Enumerable.Range(1, terminal.holes).Select(number => terminal.id + "#" + number)),
            layout.Holes.Select(hole => hole.Id));
    }

    [Fact]
    public void Fit_projection_and_hole_rect_use_the_shipped_math()
    {
        var frame = PanelLayout.FitPanel(1440, 900);
        Assert.Equal(new PanelFrame(0, 50, 1440, 800), frame);
        var point = PanelLayout.ProjectPanelPoint(new global::Godot.Vector2(0.5f, 0.5f), frame);
        Assert.Equal(720, point.X, 6);
        Assert.Equal(450, point.Y, 6);

        IArtifactSource source = new FileSystemSource(RepoRoot());
        var netlist = Netlist.LoadNetlist(source.ReadAllBytes("data/netlist.json"));
        var layout = PanelLayout.Parse(source.ReadAllBytes("data/panel-layout.json"), new NetlistView(netlist));
        var rect = layout.HoleRect("1A#1", frame, 0.0105);
        Assert.Equal(15.12, rect.Width, 6);
        Assert.Equal(15.12, rect.Height, 6);
        Assert.Equal(layout.ProjectHoleCenter("1A#1", frame).X, rect.X + rect.Width / 2, 6);
    }

    [Fact]
    public void Mutated_terminal_identity_is_rejected()
    {
        IArtifactSource source = new FileSystemSource(RepoRoot());
        var netlist = Netlist.LoadNetlist(source.ReadAllBytes("data/netlist.json"));
        var terminals = netlist.terminals
            .Select((terminal, index) => new RawTerminalView(index == 0 ? "wrong" : terminal.id, terminal.holes))
            .ToArray();

        var error = Assert.Throws<InvalidOperationException>(() =>
            PanelLayout.Parse(source.ReadAllBytes("data/panel-layout.json"), new RawView(terminals)));
        Assert.Contains("terminal 0 identity/order mismatch", error.Message, StringComparison.Ordinal);
    }

    private static string RepoRoot() =>
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../.."));

    private sealed class NetlistView(LoadedNetlist netlist) : IRawNetlistView
    {
        public System.Collections.Generic.IReadOnlyList<RawTerminalView> Terminals { get; } =
            netlist.terminals.Select(terminal => new RawTerminalView(terminal.id, terminal.holes)).ToArray();
    }

    private sealed record RawView(System.Collections.Generic.IReadOnlyList<RawTerminalView> Terminals) : IRawNetlistView;
}
