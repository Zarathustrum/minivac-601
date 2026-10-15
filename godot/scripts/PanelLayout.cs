using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;

namespace Minivac.Godot;

public sealed record RawTerminalView(string Id, int Holes);

public interface IRawNetlistView
{
    IReadOnlyList<RawTerminalView> Terminals { get; }
}

public readonly record struct PanelFrame(double X, double Y, double Width, double Height);

public readonly record struct PanelRect(double X, double Y, double Width, double Height);

public sealed record PanelPlate(string Id, double X, double Y, double Width, double Height, string Source);

public sealed record PanelBand(
    string Id,
    string Plate,
    string Tone,
    double Top,
    double Bottom,
    string? Title,
    string Source);

public sealed record PanelRegion(string Id, IReadOnlyList<string> TerminalIds, string Source);

public sealed record PanelHole(
    string Id,
    string Terminal,
    int Hole,
    double X,
    double Y,
    string Source);

public sealed record PanelTerminal(
    string Id,
    string Region,
    double X,
    double Y,
    string Artwork,
    IReadOnlyList<PanelHole> Holes,
    string Source);

public sealed record PanelLegend(
    string Id,
    string Text,
    string Form,
    string Region,
    double X,
    double Y,
    string Source);

public sealed record PanelComponent(
    string Id,
    string Kind,
    string Region,
    double X,
    double Y,
    string Source);

public sealed record PanelControl(
    string Id,
    string Kind,
    string Region,
    int? Section,
    double X,
    double Y,
    string Source);

public sealed record PanelLinework(
    string Id,
    string Kind,
    double X,
    double Y,
    IReadOnlyList<Vector2> Points,
    double? RadiusX,
    double? RadiusY,
    string Source);

public sealed record PanelDialAngle(string Id, double Degrees, string Source);

public sealed class PanelLayout
{
    public const string Schema = "minivac.panel-layout/1";
    public const double PanelAspect = 1.8;
    public const double HoleHitFraction = 0.0105;

    private PanelLayout(
        double aspect,
        IReadOnlyList<PanelPlate> plates,
        IReadOnlyList<PanelBand> bands,
        IReadOnlyList<PanelRegion> regions,
        IReadOnlyList<PanelTerminal> terminals,
        IReadOnlyList<PanelHole> holes,
        IReadOnlyList<PanelLegend> legends,
        IReadOnlyList<PanelComponent> components,
        IReadOnlyList<PanelControl> controls,
        IReadOnlyList<PanelLinework> linework,
        IReadOnlyList<PanelDialAngle> dialAngles)
    {
        Aspect = aspect;
        Plates = plates;
        Bands = bands;
        Regions = regions;
        Terminals = terminals;
        Holes = holes;
        Legends = legends;
        Components = components;
        Controls = controls;
        Linework = linework;
        DialAngles = dialAngles;
    }

    public double Aspect { get; }
    public IReadOnlyList<PanelPlate> Plates { get; }
    public IReadOnlyList<PanelBand> Bands { get; }
    public IReadOnlyList<PanelRegion> Regions { get; }
    public IReadOnlyList<PanelTerminal> Terminals { get; }
    public IReadOnlyList<PanelHole> Holes { get; }
    public IReadOnlyList<PanelLegend> Legends { get; }
    public IReadOnlyList<PanelComponent> Components { get; }
    public IReadOnlyList<PanelControl> Controls { get; }
    public IReadOnlyList<PanelLinework> Linework { get; }
    public IReadOnlyList<PanelDialAngle> DialAngles { get; }

    public static PanelLayout Parse(byte[] bytes, IRawNetlistView netlist)
    {
        ArgumentNullException.ThrowIfNull(bytes);
        ArgumentNullException.ThrowIfNull(netlist);
        using var document = JsonDocument.Parse(bytes);
        var root = document.RootElement;
        if (String(root, "schema") != Schema)
            Fail("schema must be " + Schema);
        var sourceNote = String(root.GetProperty("sources"), "note");
        var plates = Records(root, "plates", item => new PanelPlate(
            String(item, "id"), Number(item, "x"), Number(item, "y"), Number(item, "width"),
            Number(item, "height"), String(item, "source")));
        var bands = Records(root, "bands", item =>
        {
            if (item.ValueKind != JsonValueKind.Array || item.GetArrayLength() != 6)
                Fail("band must be a six-tuple");
            return new PanelBand(
                String(item[0]), String(item[1]), String(item[2]), Number(item[3]), Number(item[4]),
                item[5].ValueKind == JsonValueKind.Null ? null : String(item[5]), sourceNote);
        });
        var regions = Records(root, "regions", item => new PanelRegion(
            String(item, "id"), Strings(item, "terminalIds"), String(item, "source")));
        var terminals = Records(root, "terminals", item =>
        {
            var terminalSource = String(item, "source");
            return new PanelTerminal(
                String(item, "id"), String(item, "region"), Number(item, "x"), Number(item, "y"),
                String(item, "artwork"), ParseHoles(item.GetProperty("holes"), terminalSource), terminalSource);
        });
        var holes = ParseHoles(root.GetProperty("holes"), sourceNote);
        var legends = Records(root, "legends", item => new PanelLegend(
            String(item, "id"), String(item, "text"), String(item, "form"), String(item, "region"),
            Number(item, "x"), Number(item, "y"), String(item, "source")));
        var components = Records(root, "components", item => new PanelComponent(
            String(item, "id"), String(item, "kind"), String(item, "region"),
            Number(item, "x"), Number(item, "y"), String(item, "source")));
        var controls = Records(root, "controls", item => new PanelControl(
            String(item, "id"), String(item, "kind"), String(item, "region"),
            item.GetProperty("section").ValueKind == JsonValueKind.Null ? null : item.GetProperty("section").GetInt32(),
            Number(item, "x"), Number(item, "y"), String(item, "source")));
        var linework = Records(root, "linework", item => new PanelLinework(
            String(item, "id"), String(item, "kind"), Number(item, "x"), Number(item, "y"),
            Points(item, "points"), OptionalNumber(item, "radiusX"), OptionalNumber(item, "radiusY"),
            String(item, "source")));
        var dialAngles = Records(root, "decimalAngles", item => new PanelDialAngle(
            String(item, "id"), Number(item, "degrees"), sourceNote));

        var layout = new PanelLayout(
            Number(root, "aspect"), plates, bands, regions, terminals, holes, legends,
            components, controls, linework, dialAngles);
        layout.Validate(netlist);
        return layout;
    }

    public static PanelFrame FitPanel(double viewportWidth, double viewportHeight)
    {
        if (!double.IsFinite(viewportWidth) || viewportWidth <= 0 ||
            !double.IsFinite(viewportHeight) || viewportHeight <= 0)
            Fail("viewport dimensions must be positive finite numbers");
        var width = Math.Min(viewportWidth, viewportHeight * PanelAspect);
        var height = width / PanelAspect;
        return new PanelFrame(
            (viewportWidth - width) / 2,
            (viewportHeight - height) / 2,
            width,
            height);
    }

    public static Vector2 ProjectPanelPoint(Vector2 value, PanelFrame frame) => new(
        (float)RoundProjection(frame.X + value.X * frame.Width),
        (float)RoundProjection(frame.Y + value.Y * frame.Height));

    public Vector2 ProjectHoleCenter(string holeId, PanelFrame frame)
    {
        foreach (var hole in Holes)
            if (hole.Id == holeId) return ProjectPanelPoint(new Vector2((float)hole.X, (float)hole.Y), frame);
        throw new InvalidOperationException("panel layout: unknown hole " + holeId);
    }

    public PanelRect HoleRect(string holeId, PanelFrame frame, double holeHitFraction = HoleHitFraction)
    {
        if (!double.IsFinite(holeHitFraction) || holeHitFraction <= 0)
            Fail("hole hit fraction must be positive and finite");
        var centre = ProjectHoleCenter(holeId, frame);
        var extent = frame.Width * holeHitFraction;
        return new PanelRect(centre.X - extent / 2, centre.Y - extent / 2, extent, extent);
    }

    private void Validate(IRawNetlistView netlist)
    {
        if (Aspect != PanelAspect) Fail("aspect must be 1.8");
        if (Terminals.Count != 186 || Holes.Count != 392)
            Fail("generated inventory is not 186 terminals / 392 holes");
        if (Plates.Count != 3 || Bands.Count != 12 || Regions.Count != 40 ||
            Legends.Count != 264 || Components.Count != 48 || Controls.Count != 21 ||
            Linework.Count != 70 || DialAngles.Count != 16)
            Fail("inventory count mismatch");
        if (netlist.Terminals.Count != Terminals.Count)
            Fail("expected " + Terminals.Count + " terminals, got " + netlist.Terminals.Count);

        var flattened = 0;
        for (var index = 0; index < Terminals.Count; index++)
        {
            var expected = Terminals[index];
            var actual = netlist.Terminals[index];
            if (actual.Id != expected.Id) Fail("terminal " + index + " identity/order mismatch");
            if (actual.Holes != expected.Holes.Count)
                Fail(expected.Id + " holes expected " + expected.Holes.Count + ", got " + actual.Holes);
            for (var hole = 0; hole < expected.Holes.Count; hole++)
            {
                var nested = expected.Holes[hole];
                if (nested.Id != actual.Id + "#" + (hole + 1))
                    Fail(expected.Id + " hole " + hole + " identity/order mismatch");
                if (flattened >= Holes.Count || Holes[flattened] with { Source = nested.Source } != nested)
                    Fail("flattened hole identity/order mismatch at " + flattened);
                flattened++;
            }
        }

        var owner = 0;
        foreach (var region in Regions)
        {
            foreach (var terminalId in region.TerminalIds)
            {
                if (owner >= Terminals.Count || Terminals[owner].Id != terminalId)
                    Fail("region ownership order mismatch at " + owner);
                owner++;
            }
        }
        if (owner != Terminals.Count) Fail("incomplete region ownership");

        foreach (var terminal in Terminals) Normalized(terminal.Id, terminal.X, terminal.Y);
        foreach (var hole in Holes) Normalized(hole.Id, hole.X, hole.Y);
        foreach (var legend in Legends) Normalized(legend.Id, legend.X, legend.Y);
        foreach (var component in Components) Normalized(component.Id, component.X, component.Y);
        foreach (var control in Controls) Normalized(control.Id, control.X, control.Y);
        foreach (var line in Linework)
        {
            Normalized(line.Id, line.X, line.Y);
            foreach (var point in line.Points) Normalized(line.Id, point.X, point.Y);
            if (line.RadiusX is <= 0 || line.RadiusY is <= 0) Fail(line.Id + " has invalid radius");
        }
    }

    private static IReadOnlyList<PanelHole> ParseHoles(JsonElement element, string source) =>
        Records(element, item => new PanelHole(
            String(item, "id"), String(item, "terminal"), item.GetProperty("hole").GetInt32(),
            Number(item, "x"), Number(item, "y"), source));

    private static IReadOnlyList<Vector2> Points(JsonElement item, string property) =>
        Records(item, property, point => new Vector2((float)Number(point, "x"), (float)Number(point, "y")));

    private static IReadOnlyList<string> Strings(JsonElement item, string property) =>
        Records(item, property, String);

    private static IReadOnlyList<T> Records<T>(JsonElement item, string property, Func<JsonElement, T> map) =>
        Records(item.GetProperty(property), map);

    private static IReadOnlyList<T> Records<T>(JsonElement array, Func<JsonElement, T> map)
    {
        if (array.ValueKind != JsonValueKind.Array) Fail("expected array");
        var values = new T[array.GetArrayLength()];
        var index = 0;
        foreach (var item in array.EnumerateArray()) values[index++] = map(item);
        return Array.AsReadOnly(values);
    }

    private static string String(JsonElement item, string property) => String(item.GetProperty(property));

    private static string String(JsonElement item) =>
        item.ValueKind == JsonValueKind.String
            ? item.GetString()!
            : throw new InvalidOperationException("panel layout: expected string");

    private static double Number(JsonElement item, string property) => Number(item.GetProperty(property));

    private static double Number(JsonElement item) =>
        item.ValueKind == JsonValueKind.Number
            ? item.GetDouble()
            : throw new InvalidOperationException("panel layout: expected number");

    private static double? OptionalNumber(JsonElement item, string property) =>
        item.TryGetProperty(property, out var value) ? Number(value) : null;

    private static double RoundProjection(double value) => Math.Floor(value * 1_000_000 + 0.5) / 1_000_000;

    private static void Normalized(string id, double x, double y)
    {
        if (!double.IsFinite(x) || x < 0 || x > 1) Fail(id + " has invalid x");
        if (!double.IsFinite(y) || y < 0 || y > 1) Fail(id + " has invalid y");
    }

    private static void Fail(string message) =>
        throw new InvalidOperationException("panel layout: " + message);
}
