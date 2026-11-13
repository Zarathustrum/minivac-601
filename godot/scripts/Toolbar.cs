using System;
using Godot;

namespace Minivac.Godot;

public partial class Toolbar : Control
{
    public Button Library { get; private set; } = null!;
    public Button BlankPanel { get; private set; } = null!;
    public Button Reset { get; private set; } = null!;
    public Button Profile { get; private set; } = null!;
    public Button Sound { get; private set; } = null!;
    public Button Help { get; private set; } = null!;
    public Button Fit { get; private set; } = null!;
    public Button Wire { get; private set; } = null!;
    public Button ZoomOut { get; private set; } = null!;
    public Button ZoomIn { get; private set; } = null!;
    public Button PanLeft { get; private set; } = null!;
    public Button PanRight { get; private set; } = null!;
    public Button PanUp { get; private set; } = null!;
    public Button PanDown { get; private set; } = null!;

    public void Initialize(
        Action fit,
        Action wire,
        Action zoomOut,
        Action zoomIn,
        Action panLeft,
        Action panRight,
        Action panUp,
        Action panDown,
        Action openLibrary,
        Action loadBlankPanel,
        Action reset,
        Action openProfile,
        Func<bool> toggleSound,
        Action openHelp,
        bool soundMuted)
    {
        ArgumentNullException.ThrowIfNull(fit);
        ArgumentNullException.ThrowIfNull(wire);
        ArgumentNullException.ThrowIfNull(zoomOut);
        ArgumentNullException.ThrowIfNull(zoomIn);
        ArgumentNullException.ThrowIfNull(panLeft);
        ArgumentNullException.ThrowIfNull(panRight);
        ArgumentNullException.ThrowIfNull(panUp);
        ArgumentNullException.ThrowIfNull(panDown);
        ArgumentNullException.ThrowIfNull(openLibrary);
        ArgumentNullException.ThrowIfNull(loadBlankPanel);
        ArgumentNullException.ThrowIfNull(reset);
        ArgumentNullException.ThrowIfNull(openProfile);
        ArgumentNullException.ThrowIfNull(toggleSound);
        ArgumentNullException.ThrowIfNull(openHelp);
        Name = "Toolbar";
        MouseFilter = MouseFilterEnum.Ignore;
        Library = Add("Library", "Library", openLibrary);
        BlankPanel = Add("BlankPanel", "Blank panel", loadBlankPanel);
        Reset = Add("Reset", "Reset", reset);
        Profile = Add("Profile", "Profile", openProfile);
        Sound = Add("Sound", "Sound on", () => SetSoundMuted(toggleSound()));
        Sound.ToggleMode = true;
        Help = Add("Help", "Help", openHelp);
        Fit = Add("Fit", "Fit", fit);
        Wire = Add("Wire", "Wire", wire);
        ZoomOut = Add("ZoomOut", "Zoom Out", zoomOut);
        ZoomIn = Add("ZoomIn", "Zoom In", zoomIn);
        PanLeft = Add("PanLeft", "Pan Left", panLeft);
        PanRight = Add("PanRight", "Pan Right", panRight);
        PanUp = Add("PanUp", "Pan Up", panUp);
        PanDown = Add("PanDown", "Pan Down", panDown);
        SetSoundMuted(soundMuted);
        ApplyLayout();
    }

    public void SetSoundMuted(bool muted)
    {
        Sound.Text = muted ? "Sound muted" : "Sound on";
        Sound.TooltipText = Sound.Text;
        Sound.ButtonPressed = !muted;
    }

    // While the model has the machine these four apply nothing: greyed, with the reason in the tooltip.
    public void SetLocked(bool locked)
    {
        foreach (var button in new[] { Library, BlankPanel, Reset, Profile })
        {
            button.Disabled = locked;
            button.TooltipText = locked ? button.Text + " (off while the model has the machine)" : button.Text;
        }
    }

    public override void _Notification(int what)
    {
        if (what == NotificationResized) ApplyLayout();
    }

    private Button Add(string name, string label, Action action)
    {
        var button = new Button { Name = name, Text = label, TooltipText = label, FocusMode = FocusModeEnum.All };
        button.Pressed += action;
        AddChild(button);
        return button;
    }

    // Each button as wide as its own label needs, 4 px apart.
    private void ApplyLayout()
    {
        var x = 0f;
        foreach (var child in GetChildren())
        {
            if (child is not Button button) continue;
            var width = button == Sound ? SoundWidth() : button.GetMinimumSize().X;
            button.Position = new(x, 0);
            button.Size = new(width, 36);
            x += width + 4;
        }
    }

    // Sound keeps the wider of its two texts, so toggling it moves nothing.
    private float SoundWidth()
    {
        var shown = Sound.Text;
        var width = 0f;
        foreach (var text in new[] { "Sound on", "Sound muted" })
        {
            Sound.Text = text;
            width = Math.Max(width, Sound.GetMinimumSize().X);
        }
        Sound.Text = shown;
        return width;
    }
}
