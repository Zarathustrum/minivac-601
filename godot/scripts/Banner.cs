using System;
using Godot;

namespace Minivac.Godot;

// The strip across the top of the stage while the model has the machine, whichever right-column
// tab is selected (docs/plans/godot-chat-pane.md, "The lock" and "Layout").
public partial class Banner : Control
{
    public const string Headline = "The model has the machine. Look, don't touch.";
    public const float BannerHeight = 64;

    private Panel _background = null!;

    public Label Title { get; private set; } = null!;
    public Label Waiting { get; private set; } = null!;
    public Button Stop { get; private set; } = null!;
    public Button EndSession { get; private set; } = null!;

    public event Action? StopPressed;
    public event Action? EndSessionPressed;

    /// <summary>The second line: the waiting text, empty by default.</summary>
    public string WaitingText
    {
        get => Waiting.Text;
        set => Waiting.Text = value ?? "";
    }

    public void Initialize()
    {
        Name = "Banner";
        Visible = false;
        MouseFilter = MouseFilterEnum.Stop;
        // In 3D the wheel over a mouse-stopping control still dollies the camera without this (C0).
        MouseForcePassScrollEvents = false;

        _background = new Panel { Name = "Background", MouseFilter = MouseFilterEnum.Ignore };
        _background.SelfModulate = PanelTheme.ConsoleTeal;
        AddChild(_background);

        Title = new Label { Name = "Title", Text = Headline, TooltipText = Headline, MouseFilter = MouseFilterEnum.Ignore };
        AddChild(Title);
        Waiting = new Label { Name = "Waiting", Text = "", MouseFilter = MouseFilterEnum.Ignore };
        AddChild(Waiting);

        Stop = new Button
        {
            Name = "Stop",
            Text = "Stop",
            TooltipText = "Stop the model's request",
            FocusMode = FocusModeEnum.All,
            Disabled = true,
        };
        Stop.Pressed += () => StopPressed?.Invoke();
        AddChild(Stop);
        EndSession = new Button
        {
            Name = "EndSession",
            Text = "End session",
            TooltipText = "End the chat session and hand the machine back to you",
            FocusMode = FocusModeEnum.All,
            Disabled = true,
        };
        EndSession.Pressed += () => EndSessionPressed?.Invoke();
        AddChild(EndSession);
        ApplyLayout();
    }

    /// <summary>The dock's enable rules for Stop and End session (ChatModel <c>CanStop</c>, <c>CanEnd</c>).</summary>
    public void SetButtons(bool stop, bool endSession)
    {
        Stop.Disabled = !stop;
        EndSession.Disabled = !endSession;
    }

    public override void _Notification(int what)
    {
        if (what == NotificationResized) ApplyLayout();
    }

    private void ApplyLayout()
    {
        if (_background is null) return;
        _background.Position = Vector2.Zero;
        _background.Size = Size;
        var buttonsLeft = Math.Max(0, Size.X - 212);
        Title.Position = new(12, 6);
        Title.Size = new(Math.Max(0, buttonsLeft - 20), 24);
        Waiting.Position = new(12, 32);
        Waiting.Size = new(Math.Max(0, buttonsLeft - 20), 24);
        Stop.Position = new(buttonsLeft, 14);
        Stop.Size = new(76, 36);
        EndSession.Position = new(buttonsLeft + 84, 14);
        EndSession.Size = new(116, 36);
    }
}
