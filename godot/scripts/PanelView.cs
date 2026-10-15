using System;
using System.Collections.Generic;
using Godot;

namespace Minivac.Godot;

public partial class PanelView : Control
{
    private sealed partial class HoleButton : Button
    {
        private bool _occupied;

        internal bool Occupied
        {
            get => _occupied;
            set
            {
                if (_occupied == value) return;
                _occupied = value;
                QueueRedraw();
            }
        }

        public override void _Draw()
        {
            var radius = Math.Min(Size.X, Size.Y) / 2;
            if (HasFocus()) DrawCircle(Size / 2, radius, PanelTheme.ConsoleTeal);
            DrawCircle(Size / 2, radius * 0.72f, Occupied ? PanelTheme.ConsoleRedLit : PanelTheme.ConsoleCream);
            DrawCircle(Size / 2, radius * 0.48f, PanelTheme.ConsoleDark);
        }
    }

    private sealed partial class Rivet : Control
    {
        public override void _Draw() => DrawCircle(Size / 2, Math.Min(Size.X, Size.Y) / 2, PanelTheme.ConsoleCream);
    }

    private sealed record Placement(
        Control View,
        double X,
        double Y,
        double Width,
        double Height,
        bool Centered,
        bool HeightFromWidth);
    private sealed record Stroke(Line2D View, PanelLinework Item);

    private readonly List<Placement> _placements = [];
    private readonly List<Stroke> _strokes = [];
    private readonly List<(HoleButton View, PanelHole Hole)> _holePlacements = [];
    private readonly Dictionary<Label, string> _legendForms = [];
    private readonly Dictionary<string, Button> _holes = new(StringComparer.Ordinal);
    private PanelLayout? _layout;

    public IReadOnlyDictionary<string, Button> Holes => _holes;
    public PanelLayout Layout => _layout ?? throw new InvalidOperationException("panel view: not initialized");

    public void Initialize(PanelLayout layout)
    {
        if (_layout is not null) throw new InvalidOperationException("panel view: already initialized");
        _layout = layout ?? throw new ArgumentNullException(nameof(layout));
        Name = "Panel";
        ClipContents = true;
        FocusMode = FocusModeEnum.None;
        MouseFilter = MouseFilterEnum.Pass;

        foreach (var plate in layout.Plates)
        {
            var node = new Panel { Name = "Plate_" + SafeName(plate.Id), MouseFilter = MouseFilterEnum.Ignore };
            node.SetMeta("plate", plate.Id);
            node.SelfModulate = PanelTheme.ConsoleDark;
            AddChild(node);
            _placements.Add(new Placement(node, plate.X, plate.Y, plate.Width, plate.Height, false, false));
        }
        foreach (var band in layout.Bands)
        {
            var plate = band.Plate == "console"
                ? FindPlate(layout.Plates, "upper-right")
                : FindPlate(layout.Plates, band.Plate);
            var node = new Panel { Name = "Band_" + SafeName(band.Id), MouseFilter = MouseFilterEnum.Ignore };
            node.SetMeta("band", band.Id);
            node.SelfModulate = band.Tone == "teal" ? PanelTheme.ConsoleTeal : PanelTheme.ConsoleDark;
            AddChild(node);
            _placements.Add(new Placement(node, plate.X, band.Top, plate.Width, band.Bottom - band.Top, false, false));
        }
        foreach (var line in layout.Linework)
        {
            var node = new Line2D
            {
                Name = "Line_" + SafeName(line.Id),
                DefaultColor = PanelTheme.ConsoleCream,
                Width = 1.2f,
                Antialiased = true,
            };
            node.SetMeta("linework", line.Id);
            AddChild(node);
            _strokes.Add(new Stroke(node, line));
        }
        foreach (var component in layout.Components)
        {
            if (component.Kind != "rivet") continue;
            var node = new Rivet { Name = "Rivet_" + SafeName(component.Id), MouseFilter = MouseFilterEnum.Ignore };
            node.SetMeta("component", component.Id);
            AddChild(node);
            _placements.Add(new Placement(
                node, component.X, component.Y,
                PanelTheme.RivetDiameter, PanelTheme.RivetDiameter,
                true, true));
        }
        foreach (var legend in layout.Legends)
        {
            var (width, height, centered) = LegendBox(legend.Form);
            var node = new Label
            {
                Name = "Legend_" + SafeName(legend.Id),
                Text = legend.Text,
                MouseFilter = MouseFilterEnum.Ignore,
            };
            node.Set("horizontal_alignment", legend.Form is "block-title-left" or "logotype" or "fine-print" ? 0 : 1);
            node.Set("vertical_alignment", 1);
            node.Set("autowrap_mode", legend.Form == "two-line" ? 2 : 0);
            node.SetMeta("legend", legend.Id);
            node.AddThemeColorOverride("font_color", PanelTheme.ConsoleCream);
            AddChild(node);
            _placements.Add(new Placement(node, legend.X, legend.Y, width, height, centered, true));
            _legendForms.Add(node, legend.Form);
        }
        foreach (var hole in layout.Holes)
        {
            var node = new HoleButton
            {
                Name = "Hole_" + SafeName(hole.Id),
                Flat = true,
                TooltipText = hole.Id,
                FocusMode = FocusModeEnum.All,
                MouseDefaultCursorShape = CursorShape.PointingHand,
            };
            node.SetMeta("hole_id", hole.Id);
            node.SetMeta("terminal_id", hole.Terminal);
            node.AddThemeColorOverride("font_color", PanelTheme.ConsoleCream);
            AddChild(node);
            _holes.Add(hole.Id, node);
            _holePlacements.Add((node, hole));
        }
        ApplyLayout();
    }

    public Vector2 HoleCenter(string holeId)
    {
        if (!_holes.TryGetValue(holeId, out var hole))
            throw new InvalidOperationException("panel view: unknown hole " + holeId);
        return hole.Position + hole.Size / 2;
    }

    public void SetOccupied(IReadOnlyList<string> occupied)
    {
        var values = new HashSet<string>(occupied, StringComparer.Ordinal);
        foreach (var pair in _holes)
        {
            var isOccupied = values.Contains(pair.Key);
            pair.Value.SetMeta("occupied", isOccupied);
            if (pair.Value is HoleButton hole) hole.Occupied = isOccupied;
        }
    }

    public override void _Notification(int what)
    {
        if (what == NotificationResized) ApplyLayout();
    }

    private void ApplyLayout()
    {
        if (_layout is null || Size.X <= 0 || Size.Y <= 0) return;
        foreach (var placement in _placements)
        {
            var width = (float)(placement.Width * Size.X);
            var height = (float)(placement.Height * (placement.HeightFromWidth ? Size.X : Size.Y));
            placement.View.Size = new Vector2(width, height);
            var halfWidth = placement.Centered ? width / 2 : 0;
            var halfHeight = placement.Centered ? height / 2 : 0;
            placement.View.Position = new Vector2(
                (float)(placement.X * Size.X - halfWidth),
                (float)(placement.Y * Size.Y - halfHeight));
        }
        foreach (var pair in _legendForms)
            pair.Key.AddThemeFontSizeOverride("font_size", Math.Max(6, (int)Math.Floor(Size.X * LegendFontSize(pair.Value))));
        foreach (var stroke in _strokes)
        {
            var normalized = StrokePoints(stroke.Item);
            var points = new Vector2[normalized.Count];
            for (var index = 0; index < points.Length; index++)
                points[index] = new Vector2(normalized[index].X * Size.X, normalized[index].Y * Size.Y);
            stroke.View.Points = points;
            stroke.View.Closed = stroke.Item.Kind is "circle" or "closed-loop";
        }
        var frame = new PanelFrame(0, 0, Size.X, Size.Y);
        foreach (var pair in _holePlacements)
        {
            var rect = _layout.HoleRect(pair.Hole.Id, frame);
            pair.View.Position = new Vector2((float)rect.X, (float)rect.Y);
            pair.View.Size = new Vector2((float)rect.Width, (float)rect.Height);
        }
    }

    private static string SafeName(string value) =>
        value.Replace("/", "_", StringComparison.Ordinal).Replace("#", "_", StringComparison.Ordinal);

    private static PanelPlate FindPlate(IReadOnlyList<PanelPlate> plates, string id)
    {
        foreach (var plate in plates)
            if (plate.Id == id) return plate;
        throw new InvalidOperationException("panel view: missing plate for band " + id);
    }

    private static (double Width, double Height, bool Centered) LegendBox(string form) => form switch
    {
        "two-line" => (PanelTheme.TwoLineLegendWidth, 0.022, true),
        "logotype" => (0.18, 0.06, true),
        "fine-print" => (0.25, 0.018, true),
        "band-title" => (0.18, 0.018, true),
        "block-title" => (0.16, 0.022, true),
        "block-title-left" => (0.12, 0.022, false),
        "section-number" => (0.04, 0.035, true),
        "group" => (0.065, 0.014, true),
        "glyph" => (0.03, 0.024, true),
        _ => (0.04, 0.016, true),
    };

    private static double LegendFontSize(string form) => form switch
    {
        "logotype" => 0.047,
        "section-number" => 0.021,
        "glyph" => 0.014,
        "band-title" => 0.009,
        "block-title" or "block-title-left" => 0.0105,
        "terminal" => 0.0072,
        "terminal-above" or "terminal-left" or "matrix-number" or "dial-number" => 0.0066,
        "group" or "control-label" => 0.0058,
        "two-line" => 0.0056,
        "fine-print" => 0.0048,
        _ => 0.0068,
    };

    private static IReadOnlyList<Vector2> StrokePoints(PanelLinework item)
    {
        if (item.Kind == "circle")
        {
            if (item.RadiusX is null || item.RadiusY is null)
                throw new InvalidOperationException("panel view: circle has no radii " + item.Id);
            var points = new Vector2[64];
            for (var index = 0; index < points.Length; index++)
            {
                var radians = index * Math.PI * 2 / points.Length;
                points[index] = new Vector2(
                    (float)(item.X + Math.Cos(radians) * item.RadiusX.Value),
                    (float)(item.Y + Math.Sin(radians) * item.RadiusY.Value));
            }
            return points;
        }
        if (item.Kind == "arrow" && item.Points.Count == 2)
        {
            var start = item.Points[0];
            var end = item.Points[1];
            var direction = end.X >= start.X ? -1 : 1;
            var dx = (float)(direction * PanelTheme.Arrowhead.X / PanelTheme.ArtworkScale);
            var dy = (float)(PanelTheme.Arrowhead.Y / PanelTheme.ArtworkScale);
            return [start, end, end + new Vector2(dx, -dy), end, end + new Vector2(dx, dy)];
        }
        if (item.Kind == "bracket" && item.Points.Count == 2)
        {
            var start = item.Points[0];
            var end = item.Points[1];
            var tick = (float)PanelTheme.BracketTickDepth;
            return [start + new Vector2(0, tick), start, new Vector2(end.X, start.Y), end + new Vector2(0, tick)];
        }
        return item.Points;
    }
}
