using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Minivac.Core;

namespace Minivac.Godot;

public partial class CordList : Control
{
    private const float RowHeight = 90;

    private readonly List<Control> _rows = [];
    private readonly Dictionary<string, Button> _endpointButtons = [];
    private Cords? _cords;
    private Picker? _picker;
    private Control _viewport = null!;
    private Control _content = null!;
    private State.Cord[] _rendered = [];
    private bool _hasRendered;
    private float _scrollOffset;

    public Button AddButton { get; private set; } = null!;
    public Button ScrollUpButton { get; private set; } = null!;
    public Button ScrollDownButton { get; private set; } = null!;
    public int RowCount => _rows.Count;

    public void Initialize(Cords cords, Picker picker)
    {
        _cords = cords ?? throw new ArgumentNullException(nameof(cords));
        _picker = picker ?? throw new ArgumentNullException(nameof(picker));
        Name = "CordList";
        ClipContents = true;
        MouseFilter = MouseFilterEnum.Pass;
        AddButton = new Button
        {
            Name = "AddFreeCord",
            Text = "Add free cord",
            TooltipText = "Select end A or B, then click a jack hole. Free ends stay electrically loose.",
            FocusMode = FocusModeEnum.All,
        };
        AddButton.Pressed += Add;
        AddChild(AddButton);
        ScrollUpButton = new Button { Name = "ScrollUp", Text = "Up", FocusMode = FocusModeEnum.All };
        ScrollUpButton.Pressed += () => ScrollBy(-RowHeight);
        AddChild(ScrollUpButton);
        ScrollDownButton = new Button { Name = "ScrollDown", Text = "Down", FocusMode = FocusModeEnum.All };
        ScrollDownButton.Pressed += () => ScrollBy(RowHeight);
        AddChild(ScrollDownButton);
        _viewport = new Control { Name = "CordViewport", ClipContents = true, MouseFilter = MouseFilterEnum.Ignore };
        AddChild(_viewport);
        _content = new Control { Name = "CordRows", MouseFilter = MouseFilterEnum.Ignore };
        _viewport.AddChild(_content);
        Render();
    }

    public void Render()
    {
        var current = _cords!.CordsState;
        if (_hasRendered && _rendered.SequenceEqual(current)) return;
        var focusedName = IsInsideTree() ? GetViewport().GuiGetFocusOwner()?.Name.ToString() : null;
        _rendered = current.ToArray();
        _hasRendered = true;
        foreach (var row in _rows) row.QueueFree();
        _rows.Clear();
        _endpointButtons.Clear();
        foreach (var cord in current) AddCordRow(cord);
        ClampScroll();
        ApplyLayout();
        if (focusedName is not null) ButtonByName(focusedName)?.GrabFocus();
    }

    public Button? EndpointButton(int cord, CordSide side) =>
        _endpointButtons.GetValueOrDefault(CordModel.EndpointKey(new EndpointRef(cord, side)));

    public override void _Notification(int what)
    {
        if (what == NotificationResized) ApplyLayout();
    }

    private void Add()
    {
        if (_cords!.AddFreeCord() is AddCordResult.Added added)
        {
            _hasRendered = false;
            Render();
            var endpoint = new EndpointRef(added.Cord, CordSide.A);
            _picker!.Open(endpoint, EndpointButton(added.Cord, CordSide.A));
        }
    }

    private void AddCordRow(State.Cord cord)
    {
        var rowIndex = _rows.Count;
        var row = new Control { Name = "CordRow_" + cord.id, MouseFilter = MouseFilterEnum.Ignore };
        _content.AddChild(row);
        _rows.Add(row);
        AddEndpoint(row, cord, CordSide.A, 0, rowIndex);
        AddEndpoint(row, cord, CordSide.B, 30, rowIndex);
        var remove = new Button { Name = "Remove_" + cord.id, Text = "Remove Cord " + cord.id, FocusMode = FocusModeEnum.All };
        var cordId = cord.id;
        remove.Pressed += () =>
        {
            _cords!.Remove(cordId);
            _hasRendered = false;
            Render();
        };
        BindScrolling(remove, rowIndex);
        row.AddChild(remove);
        remove.Position = new Vector2(0, 60);
    }

    private void AddEndpoint(Control row, State.Cord cord, CordSide side, float y, int rowIndex)
    {
        var end = side == CordSide.A ? cord.a : cord.b;
        var endpoint = new EndpointRef(cord.id, side);
        var button = new Button
        {
            Name = "Cord_" + cord.id + "_" + side,
            Text = "Cord " + cord.id + "  " + side + ": " + EndLabel(end),
            FocusMode = FocusModeEnum.All,
        };
        button.Pressed += () => _picker!.Open(endpoint, button);
        BindScrolling(button, rowIndex);
        row.AddChild(button);
        button.Position = new Vector2(0, y);
        _endpointButtons.Add(CordModel.EndpointKey(endpoint), button);

        var free = new Button { Name = "Free_" + cord.id + "_" + side, Text = "Free", FocusMode = FocusModeEnum.All };
        free.Pressed += () =>
        {
            _cords!.Replace(endpoint, new CordEnd.Free());
            _hasRendered = false;
            Render();
        };
        BindScrolling(free, rowIndex);
        row.AddChild(free);
        free.Position = new Vector2(0, y);
    }

    private void BindScrolling(Button button, int rowIndex)
    {
        button.FocusEntered += () => EnsureVisible(rowIndex);
    }

    private void EnsureVisible(int rowIndex)
    {
        var top = rowIndex * RowHeight;
        var viewportHeight = Math.Max(0, Size.Y - 42);
        if (top < _scrollOffset) _scrollOffset = top;
        else if (top + RowHeight > _scrollOffset + viewportHeight)
            _scrollOffset = top + RowHeight - viewportHeight;
        ClampScroll();
        ApplyLayout();
    }

    private void ScrollBy(float amount)
    {
        _scrollOffset += amount;
        ClampScroll();
        ApplyLayout();
    }

    private void ClampScroll()
    {
        var viewportHeight = Math.Max(0, Size.Y - 42);
        _scrollOffset = Math.Clamp(_scrollOffset, 0, Math.Max(0, _rows.Count * RowHeight - viewportHeight));
    }

    private void ApplyLayout()
    {
        if (AddButton is null || ScrollUpButton is null || ScrollDownButton is null || _viewport is null || _content is null) return;
        AddButton.Position = Vector2.Zero;
        AddButton.Size = new Vector2(Size.X * 0.56f, 34);
        ScrollUpButton.Position = new Vector2(Size.X * 0.58f, 0);
        ScrollUpButton.Size = new Vector2(Size.X * 0.19f, 34);
        ScrollDownButton.Position = new Vector2(Size.X * 0.79f, 0);
        ScrollDownButton.Size = new Vector2(Size.X * 0.21f, 34);
        _viewport.Position = new Vector2(0, 42);
        _viewport.Size = new Vector2(Size.X, Math.Max(0, Size.Y - 42));
        _content.Position = new Vector2(0, -_scrollOffset);
        _content.Size = new Vector2(Size.X, _rows.Count * RowHeight);
        for (var index = 0; index < _rows.Count; index++)
        {
            var row = _rows[index];
            row.Position = new Vector2(0, index * RowHeight);
            row.Size = new Vector2(Size.X, RowHeight);
            foreach (var child in row.GetChildren())
            {
                if (child is not Button button) continue;
                if (button.Name.ToString().StartsWith("Free_", StringComparison.Ordinal))
                {
                    button.Position = new Vector2(Size.X * 0.74f, button.Position.Y);
                    button.Size = new Vector2(Size.X * 0.26f, 28);
                }
                else
                {
                    button.Position = new Vector2(0, button.Position.Y);
                    button.Size = new Vector2(button.Name.ToString().StartsWith("Cord_", StringComparison.Ordinal) ? Size.X * 0.72f : Size.X, 28);
                }
            }
        }
    }

    private Button? ButtonByName(string name)
    {
        if (AddButton.Name.ToString() == name) return AddButton;
        if (ScrollUpButton.Name.ToString() == name) return ScrollUpButton;
        if (ScrollDownButton.Name.ToString() == name) return ScrollDownButton;
        foreach (var row in _rows)
            foreach (var child in row.GetChildren())
                if (child is Button button && button.Name.ToString() == name && !button.IsQueuedForDeletion()) return button;
        return null;
    }

    private static string EndLabel(CordEnd end) => end switch
    {
        CordEnd.Hole hole => hole.hole,
        CordEnd.Touch touch => "Touch " + touch.term,
        _ => "Free",
    };
}
