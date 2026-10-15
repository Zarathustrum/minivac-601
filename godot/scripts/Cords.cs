using System;
using System.Collections.Generic;
using Godot;
using Minivac.Core;

namespace Minivac.Godot;

public partial class Cords : Control
{
    private sealed partial class EndpointGrip : Control
    {
        public override void _Draw()
        {
            var radius = Math.Min(Size.X, Size.Y) / 2;
            if (HasFocus()) DrawCircle(Size / 2, radius, PanelTheme.FocusBlue);
            DrawCircle(Size / 2, radius * 0.72f, PanelTheme.ConsoleCream);
            DrawCircle(Size / 2, radius * 0.42f, PanelTheme.ConsoleDark);
        }
    }

    private readonly Dictionary<int, Line2D> _lines = [];
    private readonly Dictionary<string, EndpointGrip> _trayGrips = [];
    private Func<Command, CmdResult>? _apply;
    private Func<State>? _state;
    private PanelView? _panel;
    private IReadOnlyList<State.Cord> _cords = Array.Empty<State.Cord>();
    private CordDrag? _drag;
    private Vector2? _dragPoint;
    private MomentaryTouch? _touch;
    private bool _tactile;

    public string LastStatus { get; private set; } = "";
    public IReadOnlyList<State.Cord> CordsState => _cords;
    public DropResolution? LastDropResolution { get; private set; }
    public int TrayGripCount => _trayGrips.Count;
    public Control TrayGrip(int cord, CordSide side)
    {
        var key = CordModel.EndpointKey(new EndpointRef(cord, side));
        return _trayGrips.TryGetValue(key, out var grip)
            ? grip
            : throw new InvalidOperationException("cords: missing tray grip " + key);
    }

    public void Initialize(PanelView panel, Func<Command, CmdResult> apply, Func<State> state)
    {
        _panel = panel ?? throw new ArgumentNullException(nameof(panel));
        _apply = apply ?? throw new ArgumentNullException(nameof(apply));
        _state = state ?? throw new ArgumentNullException(nameof(state));
        Name = "Cords";
        MouseFilter = MouseFilterEnum.Ignore;
        foreach (var pair in panel.Holes)
        {
            var hole = pair.Key;
            pair.Value.GuiInput += input => HandleHoleInput(hole, input);
        }
    }

    public void Render(State state)
    {
        _cords = state.cords;
        RebuildLines();
        var occupied = new List<string>();
        foreach (var cord in _cords)
        {
            if (cord.a is CordEnd.Hole a) occupied.Add(a.hole);
            if (cord.b is CordEnd.Hole b) occupied.Add(b.hole);
        }
        _panel!.SetOccupied(occupied);
    }

    internal IReadOnlyList<CordRecord> Project(IReadOnlyList<State.Cord> cords)
    {
        var slots = CordModel.FreeTraySlots(cords);
        var projected = new CordRecord[cords.Count];
        for (var index = 0; index < cords.Count; index++)
        {
            var cord = cords[index];
            projected[index] = new CordRecord(
                cord.id,
                PanelLocal(EndPoint(cord.a, new EndpointRef(cord.id, CordSide.A), slots)),
                PanelLocal(EndPoint(cord.b, new EndpointRef(cord.id, CordSide.B), slots)));
        }
        return projected;
    }

    internal void SetTactile(bool tactile)
    {
        _tactile = tactile;
        foreach (var line in _lines.Values) line.Visible = !tactile;
        QueueRedraw();
    }

    public CordDrag BeginDrag(EndpointRef endpoint)
    {
        ReleaseTouchBeforeMutation();
        _drag = CordModel.BeginCordDrag(_cords, endpoint);
        _dragPoint = EndPoint(
            _drag.Origin,
            endpoint,
            CordModel.FreeTraySlots(_cords));
        RebuildLines();
        return _drag;
    }

    public DropResolution CancelDrag()
    {
        if (_drag is null) throw new InvalidOperationException("cords: no drag");
        var resolution = CordModel.CancelCordDrag(_drag);
        LastDropResolution = resolution;
        _drag = null;
        _dragPoint = null;
        LastStatus = "Cord change cancelled.";
        RebuildLines();
        return resolution;
    }

    public DropResolution Drop(CordDropTarget target)
    {
        if (_drag is null) throw new InvalidOperationException("cords: no drag");
        var resolution = CordModel.ResolveCordDrop(_cords, _drag, target);
        LastDropResolution = resolution;
        _drag = null;
        _dragPoint = null;
        if (resolution is DropResolution.Replace replace) Replace(replace.Endpoint, replace.To);
        else if (resolution is DropResolution.Cancelled cancelled)
            LastStatus = cancelled.Reason == DropCancelReason.Occupied && target is CordDropTarget.Hole hole
                ? hole.Id + " is occupied."
                : cancelled.Reason == DropCancelReason.Outside ? "Cord drop cancelled." : "Cord move cancelled.";
        else RebuildLines();
        return resolution;
    }

    public ReplacementResult Replace(EndpointRef endpoint, CordEnd next)
    {
        ReleaseTouchBeforeMutation();
        var result = CordModel.ReplaceCordEndpoint(_cords, endpoint, next, _apply!);
        switch (result)
        {
            case ReplacementResult.Noop noop:
                _cords = noop.Cords;
                LastStatus = "Cord move cancelled.";
                break;
            case ReplacementResult.Committed committed:
                _cords = committed.Cords;
                LastStatus = "Cord endpoint connected.";
                break;
            case ReplacementResult.DisconnectRejected rejected:
                _cords = rejected.Cords;
                LastStatus = "Cord change rejected: " + rejected.Why + ".";
                break;
            case ReplacementResult.ConnectRejected rejected:
                _cords = rejected.Cords;
                LastStatus = "Cord change rejected: " + rejected.Why + ".";
                break;
            case ReplacementResult.RollbackRejected rejected:
                _cords = _state!().cords;
                LastStatus = "Cord rollback rejected: " + rejected.RollbackWhy + ".";
                break;
        }
        RebuildLines();
        return result;
    }

    public AddCordResult AddFreeCord()
    {
        ReleaseTouchBeforeMutation();
        var result = CordModel.AddFreeCord(_cords, _apply!);
        if (result is AddCordResult.Added added) _cords = added.Cords;
        else if (result is AddCordResult.Full) LastStatus = "All 256 cord ids are in use.";
        else if (result is AddCordResult.Rejected rejected) LastStatus = "Cord change rejected: " + rejected.Why + ".";
        RebuildLines();
        return result;
    }

    public RemoveCordResult Remove(int cord)
    {
        ReleaseTouchBeforeMutation();
        var result = CordModel.RemoveCord(_cords, cord, _apply!);
        if (result is RemoveCordResult.Removed removed) _cords = removed.Cords;
        else if (result is RemoveCordResult.Rejected rejected) LastStatus = "Cord change rejected: " + rejected.Why + ".";
        RebuildLines();
        return result;
    }

    public TouchStartResult BeginTouch(EndpointRef endpoint, string terminal)
    {
        if (_touch is not null || _drag is not null)
        {
            LastStatus = "Touch requires a free cord end.";
            return new TouchStartResult.NotFree(_cords);
        }
        var result = CordModel.BeginMomentaryTouch(_cords, endpoint, terminal, _apply!);
        if (result is TouchStartResult.Started started)
        {
            _cords = started.Cords;
            _touch = started.Touch;
        }
        RebuildLines();
        return result;
    }

    public ReplacementResult? EndTouch()
    {
        if (_touch is null) return null;
        var result = CordModel.EndMomentaryTouch(_cords, _touch, _apply!);
        if (result is ReplacementResult.Committed committed) _cords = committed.Cords;
        else if (result is ReplacementResult.RollbackRejected) _cords = _state!().cords;
        _touch = null;
        RebuildLines();
        return result;
    }

    public override void _GuiInput(InputEvent input)
    {
        if (_drag is not null && input is InputEventKey key && key.Pressed && key.AsText() == "Escape")
        {
            CancelDrag();
            AcceptEvent();
        }
    }

    public override void _Input(InputEvent input)
    {
        if (_drag is null) return;
        if (input is InputEventKey key && key.Pressed && key.AsText() == "Escape")
        {
            CancelDrag();
            GetViewport().SetInputAsHandled();
        }
        else if (input is InputEventMouseMotion motion)
        {
            _drag = CordModel.PreviewCordDrag(_drag, new CordDropTarget.Outside());
            _dragPoint = GetGlobalTransformWithCanvas().AffineInverse() * motion.GlobalPosition;
            RebuildLines();
        }
        else if (input is InputEventMouseButton button && (int)button.ButtonIndex == 1 && !button.Pressed)
        {
            DropAt(button.GlobalPosition);
            GetViewport().SetInputAsHandled();
        }
    }

    public override void _Draw()
    {
        if (_tactile || Size.X <= 0 || Size.Y <= 0) return;
        DrawLine(new Vector2(0, Size.Y - 24), new Vector2(Size.X, Size.Y - 24), PanelTheme.ConsoleCream, 1);
    }

    public override void _Notification(int what)
    {
        if (what == NotificationResized) RebuildLines();
        else if (what == NotificationWMCloseRequest || what == NotificationPredelete) EndTouch();
    }

    private void HandleHoleInput(string hole, InputEvent input)
    {
        if (_drag is not null && input is InputEventKey key && key.Pressed && key.AsText() == "Escape")
        {
            CancelDrag();
        }
        else if (input is InputEventMouseButton button && (int)button.ButtonIndex == 1)
        {
            if (button.Pressed)
            {
                if (_drag is null && EndpointAtHole(hole) is { } endpoint) BeginDrag(endpoint);
                AcceptEvent();
            }
        }
    }

    private EndpointRef? EndpointAtHole(string hole)
    {
        foreach (var cord in _cords)
        {
            if (cord.a is CordEnd.Hole a && a.hole == hole) return new EndpointRef(cord.id, CordSide.A);
            if (cord.b is CordEnd.Hole b && b.hole == hole) return new EndpointRef(cord.id, CordSide.B);
        }
        return null;
    }

    private void DropAt(Vector2 globalPosition)
    {
        foreach (var pair in _panel!.Holes)
        {
            if (!pair.Value.GetGlobalRect().HasPoint(globalPosition)) continue;
            Drop(new CordDropTarget.Hole(pair.Key));
            return;
        }
        var local = GetGlobalTransformWithCanvas().AffineInverse() * globalPosition;
        if (IsTrayPoint(local))
        {
            Drop(new CordDropTarget.Tray());
            return;
        }
        Drop(new CordDropTarget.Outside());
    }

    private void RebuildLines()
    {
        if (_panel is null || Size.X <= 0) return;
        var slots = CordModel.FreeTraySlots(_cords);
        RebuildTrayGrips(slots);
        var live = new HashSet<int>();
        foreach (var cord in _cords)
        {
            live.Add(cord.id);
            if (!_lines.TryGetValue(cord.id, out var line))
            {
                line = new Line2D
                {
                    Name = "Cord_" + cord.id,
                    Width = 2.5f,
                    DefaultColor = CordColor(cord.id),
                    Antialiased = true,
                    Visible = !_tactile,
                };
                AddChild(line);
                MoveChild(line, 0);
                _lines.Add(cord.id, line);
            }
            var a = new EndpointRef(cord.id, CordSide.A);
            var b = new EndpointRef(cord.id, CordSide.B);
            line.Points = [DrawPoint(cord.a, a, slots), DrawPoint(cord.b, b, slots)];
        }
        var obsolete = new List<int>();
        foreach (var pair in _lines)
        {
            if (live.Contains(pair.Key)) continue;
            pair.Value.QueueFree();
            obsolete.Add(pair.Key);
        }
        foreach (var id in obsolete) _lines.Remove(id);
        QueueRedraw();
    }

    private Vector2 DrawPoint(CordEnd end, EndpointRef endpoint, IReadOnlyList<FreeTraySlot> slots) =>
        _drag is not null && _drag.Endpoint == endpoint && _dragPoint is { } point
            ? point
            : EndPoint(end, endpoint, slots);

    private Vector2 EndPoint(CordEnd end, EndpointRef endpoint, IReadOnlyList<FreeTraySlot> slots)
    {
        if (end is CordEnd.Hole hole) return _panel!.HoleCenter(hole.hole);
        if (end is CordEnd.Touch touch) return TerminalCenter(touch.term);
        foreach (var slot in slots)
            if (slot.Endpoint == endpoint) return TrayPoint(slot.Index);
        return TrayPoint(0);
    }

    private void RebuildTrayGrips(IReadOnlyList<FreeTraySlot> slots)
    {
        var live = new HashSet<string>();
        foreach (var slot in slots)
        {
            live.Add(slot.Key);
            if (!_trayGrips.TryGetValue(slot.Key, out var grip))
            {
                grip = new EndpointGrip
                {
                    Name = "Tray_" + slot.Endpoint.Cord + "_" + slot.Endpoint.Side,
                    FocusMode = FocusModeEnum.All,
                    TooltipText = "Cord " + slot.Endpoint.Cord + " " + slot.Endpoint.Side + " free end",
                };
                var endpoint = slot.Endpoint;
                grip.GuiInput += input =>
                {
                    if (input is InputEventMouseButton mouse && (int)mouse.ButtonIndex == 1 && mouse.Pressed)
                    {
                        BeginDrag(endpoint);
                        AcceptEvent();
                    }
                    else if (input.IsActionPressed("ui_accept"))
                    {
                        BeginDrag(endpoint);
                        AcceptEvent();
                    }
                    else if (_drag is not null && input.IsActionPressed("ui_cancel"))
                    {
                        CancelDrag();
                        AcceptEvent();
                    }
                };
                AddChild(grip);
                _trayGrips.Add(slot.Key, grip);
            }
            grip.Position = TrayPoint(slot.Index) - new Vector2(7, 7);
            grip.Size = new Vector2(14, 14);
        }
        var obsolete = new List<string>();
        foreach (var pair in _trayGrips)
        {
            if (live.Contains(pair.Key)) continue;
            pair.Value.QueueFree();
            obsolete.Add(pair.Key);
        }
        foreach (var key in obsolete) _trayGrips.Remove(key);
    }

    private Vector2 TrayPoint(int index)
    {
        var size = ActiveSize();
        var columns = Math.Max(1, (int)Math.Floor((size.X - 20) / 16));
        return new Vector2(12 + index % columns * 16, size.Y - 12 - index / columns * 16);
    }

    private bool IsTrayPoint(Vector2 point) =>
        point.X >= 0 && point.X <= Size.X && point.Y >= Math.Max(0, Size.Y - 24) && point.Y <= Size.Y;

    private Vector2 TerminalCenter(string terminal)
    {
        foreach (var item in _panel!.Layout.Terminals)
            if (item.Id == terminal && item.Holes.Count > 0) return _panel.HoleCenter(item.Holes[0].Id);
        return TrayPoint(0);
    }

    private Vector2 PanelLocal(Vector2 pixel)
    {
        var size = ActiveSize();
        return new Vector2(
            pixel.X / size.X - 0.5f,
            (0.5f - pixel.Y / size.Y) / (float)PanelLayout.PanelAspect);
    }

    private Vector2 ActiveSize()
    {
        if (Size.X > 0 && Size.Y > 0) return Size;
        if (_panel is not null && _panel.Size.X > 0 && _panel.Size.Y > 0) return _panel.Size;
        return TactileTheme.SubViewportSize.Value;
    }

    private void ReleaseTouchBeforeMutation()
    {
        if (_touch is not null) EndTouch();
    }

    private static Color CordColor(int id)
    {
        var colors = new[] { PanelTheme.ConsoleRedLit, PanelTheme.ConsoleCream, PanelTheme.ConsoleTeal };
        return colors[id % colors.Length];
    }
}
