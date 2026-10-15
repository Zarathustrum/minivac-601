using System;
using Godot;

namespace Minivac.Godot;

public partial class Drawer : Control
{
    private Control? _returnFocus;

    public event Action? Closed;

    public Button CloseButton { get; private set; } = null!;
    public Button TerminalPageUp { get; private set; } = null!;
    public Button TerminalPageDown { get; private set; } = null!;
    public Button NotePageUp { get; private set; } = null!;
    public Button NotePageDown { get; private set; } = null!;

    public void Initialize()
    {
        Name = "Drawer";
        MouseFilter = MouseFilterEnum.Stop;
        CloseButton = new Button { Name = "Close", Text = "Close", FocusMode = FocusModeEnum.All };
        CloseButton.Pressed += Close;
        CloseButton.GuiInput += input =>
        {
            if (!input.IsActionPressed("ui_cancel")) return;
            Close();
            CloseButton.AcceptEvent();
        };
        AddChild(CloseButton);
        Visible = false;
    }

    public void ConfigureDiagnosticsPaging(
        Action terminalPageUp,
        Action terminalPageDown,
        Action notePageUp,
        Action notePageDown)
    {
        ArgumentNullException.ThrowIfNull(terminalPageUp);
        ArgumentNullException.ThrowIfNull(terminalPageDown);
        ArgumentNullException.ThrowIfNull(notePageUp);
        ArgumentNullException.ThrowIfNull(notePageDown);
        if (TerminalPageUp is not null) throw new InvalidOperationException("drawer: diagnostics paging already configured");
        TerminalPageUp = PageButton("TerminalPageUp", "Volts ◀", terminalPageUp);
        TerminalPageDown = PageButton("TerminalPageDown", "Volts ▶", terminalPageDown);
        NotePageUp = PageButton("NotePageUp", "Notes ▲", notePageUp);
        NotePageDown = PageButton("NotePageDown", "Notes ▼", notePageDown);
        ApplyLayout();
    }

    public void Open(Control? returnFocus = null)
    {
        _returnFocus = returnFocus;
        Visible = true;
        CloseButton.GrabFocus();
    }

    public void Close()
    {
        Visible = false;
        _returnFocus?.GrabFocus();
        _returnFocus = null;
        Closed?.Invoke();
    }

    public override void _Notification(int what)
    {
        if (what == NotificationResized) ApplyLayout();
    }

    private Button PageButton(string name, string text, Action action)
    {
        var button = new Button { Name = name, Text = text, TooltipText = text, FocusMode = FocusModeEnum.All };
        button.Pressed += action;
        button.GuiInput += input =>
        {
            if (!input.IsActionPressed("ui_cancel")) return;
            Close();
            button.AcceptEvent();
        };
        AddChild(button);
        return button;
    }

    private void ApplyLayout()
    {
        if (CloseButton is null) return;
        var pageWidth = TerminalPageUp is null ? 0 : Math.Min(100, Math.Max(64, Size.X * 0.14f));
        CloseButton.Position = default;
        CloseButton.Size = new(Math.Max(0, Size.X - pageWidth * 4), 36);
        if (TerminalPageUp is null) return;
        TerminalPageUp.Position = new(CloseButton.Size.X, 0);
        TerminalPageUp.Size = new(pageWidth, 36);
        TerminalPageDown.Position = new(CloseButton.Size.X + pageWidth, 0);
        TerminalPageDown.Size = new(pageWidth, 36);
        NotePageUp.Position = new(CloseButton.Size.X + pageWidth * 2, 0);
        NotePageUp.Size = new(pageWidth, 36);
        NotePageDown.Position = new(CloseButton.Size.X + pageWidth * 3, 0);
        NotePageDown.Size = new(pageWidth, 36);
    }
}
