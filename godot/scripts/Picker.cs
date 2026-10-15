using System;
using System.Collections.Generic;
using Godot;
using Minivac.Core;

namespace Minivac.Godot;

public partial class Picker : Control
{
    private readonly List<Button> _choices = [];
    private PanelLayout? _layout;
    private Cords? _cords;
    private EndpointRef? _selected;
    private MomentaryTouch? _touch;
    private Control _choiceViewport = null!;
    private Control _content = null!;
    private string? _restoreFocusName;
    private Control? _restoreFocus;
    private float _scrollOffset;

    public LineEdit Search { get; private set; } = null!;
    public Button ScrollUpButton { get; private set; } = null!;
    public Button ScrollDownButton { get; private set; } = null!;
    public IReadOnlyList<Button> Choices => _choices.AsReadOnly();
    public string LastStatus { get; private set; } = "";
    public bool IsOpen { get; private set; }

    public void Initialize(PanelLayout layout, Cords cords)
    {
        _layout = layout ?? throw new ArgumentNullException(nameof(layout));
        _cords = cords ?? throw new ArgumentNullException(nameof(cords));
        Name = "Picker";
        ClipContents = true;
        MouseFilter = MouseFilterEnum.Pass;
        GuiInput += input =>
        {
            if (!input.IsActionPressed("ui_cancel")) return;
            Close();
            AcceptEvent();
        };
        Visible = false;
        Search = new LineEdit { Name = "Search", PlaceholderText = "Find terminal or hole", ClearButtonEnabled = true };
        Search.TextChanged += _ => Rebuild();
        Search.GuiInput += input =>
        {
            if (!input.IsActionPressed("ui_cancel")) return;
            Close();
            AcceptEvent();
        };
        AddChild(Search);
        ScrollUpButton = new Button { Name = "ScrollUp", Text = "Up", FocusMode = FocusModeEnum.All };
        ScrollUpButton.Pressed += () => ScrollBy(-112);
        AddChild(ScrollUpButton);
        ScrollDownButton = new Button { Name = "ScrollDown", Text = "Down", FocusMode = FocusModeEnum.All };
        ScrollDownButton.Pressed += () => ScrollBy(112);
        AddChild(ScrollDownButton);
        _choiceViewport = new Control { Name = "ChoiceViewport", ClipContents = true, MouseFilter = MouseFilterEnum.Ignore };
        AddChild(_choiceViewport);
        _content = new Control { Name = "Choices", MouseFilter = MouseFilterEnum.Ignore };
        _choiceViewport.AddChild(_content);
    }

    public void Open(EndpointRef endpoint, Control? restoreFocus = null)
    {
        EndTouch();
        _selected = endpoint;
        _scrollOffset = 0;
        _restoreFocusName = "Cord_" + endpoint.Cord + "_" + endpoint.Side;
        _restoreFocus = restoreFocus;
        LastStatus = "Choose a terminal or Free for cord " + endpoint.Cord + ".";
        IsOpen = true;
        Visible = true;
        if (Search.Text.Length > 0) Search.Text = "";
        Rebuild();
        Search.GrabFocus();
    }

    public void OpenWithoutSelection()
    {
        _selected = null;
        LastStatus = "Select a cord end first.";
    }

    public void ChooseFree()
    {
        if (_selected is null) { OpenWithoutSelection(); return; }
        EndTouch();
        _cords!.Replace(_selected, new CordEnd.Free());
        Close();
    }

    public void ChooseHole(string hole)
    {
        if (_selected is null) { OpenWithoutSelection(); return; }
        EndTouch();
        _cords!.Replace(_selected, new CordEnd.Hole(hole));
        Close();
    }

    public TouchStartResult Touch(string terminal)
    {
        if (_selected is null) { OpenWithoutSelection(); return new TouchStartResult.NotFree(_cords!.CordsState); }
        if (_touch is not null) return new TouchStartResult.NotFree(_cords!.CordsState);
        var result = _cords!.BeginTouch(_selected, terminal);
        if (result is TouchStartResult.Started started)
        {
            _touch = started.Touch;
            LastStatus = "Touching terminal " + terminal + ".";
        }
        else if (result is TouchStartResult.NotFree) LastStatus = "Touch requires a free cord end.";
        return result;
    }

    public void EndTouch()
    {
        if (_touch is null) return;
        _cords!.EndTouch();
        _touch = null;
    }

    public void Close()
    {
        EndTouch();
        IsOpen = false;
        Visible = false;
        RestoreFocus();
    }

    public override void _Notification(int what)
    {
        if (what == NotificationResized) LayoutChoices();
        else if (what == NotificationWMCloseRequest || what == NotificationPredelete) EndTouch();
    }

    private void Rebuild()
    {
        foreach (var choice in _choices) choice.QueueFree();
        _choices.Clear();
        AddChoice("Free", ChooseFree);
        AddChoice("Cancel", Close);
        var query = Search.Text;
        foreach (var terminal in _layout!.Terminals)
        {
            if (query.Length > 0 && !terminal.Id.Contains(query, StringComparison.OrdinalIgnoreCase) &&
                !ContainsHole(terminal.Holes, query)) continue;
            foreach (var hole in terminal.Holes)
            {
                var id = hole.Id;
                AddChoice(id, () => ChooseHole(id));
            }
            AddTouch(terminal.Id);
        }
        LayoutChoices();
    }

    private void AddChoice(string text, Action action)
    {
        var button = new Button { Name = "Choice_" + _choices.Count, Text = text, FocusMode = FocusModeEnum.All };
        button.Pressed += action;
        var index = _choices.Count;
        button.FocusEntered += () => EnsureVisible(index);
        button.GuiInput += input =>
        {
            if (!input.IsActionPressed("ui_cancel")) return;
            Close();
            AcceptEvent();
        };
        _content.AddChild(button);
        _choices.Add(button);
    }

    private void AddTouch(string terminal)
    {
        var index = _choices.Count;
        var button = new Button { Name = "Choice_" + _choices.Count, Text = "Touch " + terminal, FocusMode = FocusModeEnum.All };
        button.ButtonDown += () => Touch(terminal);
        button.ButtonUp += EndTouch;
        button.FocusExited += EndTouch;
        button.FocusEntered += () => EnsureVisible(index);
        button.GuiInput += input =>
        {
            if (input.IsActionPressed("ui_cancel"))
            {
                EndTouch();
                Close();
                AcceptEvent();
            }
        };
        _content.AddChild(button);
        _choices.Add(button);
    }

    private void EnsureVisible(int index)
    {
        var top = index * 28f;
        var viewportHeight = Math.Max(0, Size.Y - 38);
        if (top < _scrollOffset) _scrollOffset = top;
        else if (top + 28 > _scrollOffset + viewportHeight) _scrollOffset = top + 28 - viewportHeight;
        ClampScroll();
        LayoutChoices();
    }

    private void ScrollBy(float amount)
    {
        _scrollOffset += amount;
        ClampScroll();
        LayoutChoices();
    }

    private void ClampScroll()
    {
        var viewportHeight = Math.Max(0, Size.Y - 38);
        _scrollOffset = Math.Clamp(_scrollOffset, 0, Math.Max(0, _choices.Count * 28 - viewportHeight));
    }

    private void RestoreFocus()
    {
        if (_restoreFocus is not null && !_restoreFocus.IsQueuedForDeletion() && _restoreFocus.IsVisibleInTree())
        {
            _restoreFocus.GrabFocus();
            return;
        }
        if (_restoreFocusName is null || !IsInsideTree()) return;
        foreach (var node in GetTree().Root.FindChildren(_restoreFocusName, "Button", true, false))
        {
            if (node is not Button button || button.IsQueuedForDeletion() || !button.IsVisibleInTree()) continue;
            button.GrabFocus();
            return;
        }
    }

    private void LayoutChoices()
    {
        if (Search is null || ScrollUpButton is null || ScrollDownButton is null || _choiceViewport is null || _content is null) return;
        Search.Position = Vector2.Zero;
        Search.Size = new Vector2(Size.X * 0.64f, 34);
        ScrollUpButton.Position = new Vector2(Size.X * 0.66f, 0);
        ScrollUpButton.Size = new Vector2(Size.X * 0.16f, 34);
        ScrollDownButton.Position = new Vector2(Size.X * 0.84f, 0);
        ScrollDownButton.Size = new Vector2(Size.X * 0.16f, 34);
        _choiceViewport.Position = new Vector2(0, 38);
        _choiceViewport.Size = new Vector2(Size.X, Math.Max(0, Size.Y - 38));
        _content.Position = new Vector2(0, -_scrollOffset);
        var width = Size.X;
        for (var index = 0; index < _choices.Count; index++)
        {
            _choices[index].Position = new Vector2(0, index * 28);
            _choices[index].Size = new Vector2(width, 26);
        }
        _content.Size = new Vector2(width, _choices.Count * 28);
    }

    private static bool ContainsHole(IReadOnlyList<PanelHole> holes, string query)
    {
        foreach (var hole in holes)
            if (hole.Id.Contains(query, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }
}
