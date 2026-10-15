using System;
using Godot;

namespace Minivac.Godot;

public partial class Stage : Control
{
    public const double MinScale = 1;
    public const double MaxScale = 32;
    public const double ZoomStep = 1.25;
    public const double PanStepPixels = 32;
    public const double MinimumHolePixels = 24.25;

    private PanelView? _panel;
    private Action? _toggleView;
    private string _view = "fit";
    private double _scale = MinScale;
    private Vector2 _pan;
    private bool _dragging;
    private Vector2 _dragOrigin;

    public string View => _view;
    public double ViewScale => _scale;
    public Vector2 Pan => _pan;
    public PanelView Surface => _panel ?? throw new InvalidOperationException("stage: not initialized");

    public void Initialize(PanelView panel, Action? toggleView = null)
    {
        if (_panel is not null) throw new InvalidOperationException("stage: already initialized");
        _panel = panel ?? throw new ArgumentNullException(nameof(panel));
        _toggleView = toggleView;
        Name = "Stage2D";
        ClipContents = true;
        FocusMode = FocusModeEnum.None;
        MouseFilter = MouseFilterEnum.Pass;
        AddChild(panel);
        ApplyTransform();
    }

    public void SetView(string view)
    {
        if (view != "fit" && view != "wire") throw new InvalidOperationException("stage: unknown view " + view);
        _view = view;
        _scale = view == "fit" ? MinScale : WireMinimumScale();
        _pan = Vector2.Zero;
        ApplyTransform();
    }

    public void ZoomBy(double factor)
    {
        if (!double.IsFinite(factor) || factor <= 0) throw new InvalidOperationException("stage: invalid zoom factor");
        _view = "wire";
        _scale = Math.Clamp(_scale * factor, WireMinimumScale(), MaxScale);
        ApplyTransform();
    }

    public void PanBy(Vector2 amount)
    {
        if (_view == "fit")
        {
            _view = "wire";
            _scale = WireMinimumScale();
        }
        _pan += amount;
        ApplyTransform();
    }

    public override void _GuiInput(InputEvent input)
    {
        if (input is InputEventMouseButton button)
        {
            if ((int)button.ButtonIndex == 4 && button.Pressed) ZoomBy(ZoomStep);
            else if ((int)button.ButtonIndex == 5 && button.Pressed) ZoomBy(1 / ZoomStep);
            else if ((int)button.ButtonIndex == 1)
            {
                if (button.Pressed) GetViewport().GuiGetFocusOwner()?.ReleaseFocus();
                _dragging = button.Pressed;
                _dragOrigin = button.Position;
            }
        }
        else if (input is InputEventMouseMotion motion && _dragging)
        {
            PanBy(motion.Position - _dragOrigin);
            _dragOrigin = motion.Position;
        }
        else if (input is InputEventKey key) HandleStageKey(key);
    }

    public override void _UnhandledKeyInput(InputEvent input)
    {
        if (input is InputEventKey key) HandleStageKey(key);
    }

    public override void _Notification(int what)
    {
        if (what == NotificationResized) ApplyTransform();
    }

    private double WireMinimumScale()
    {
        var frame = PanelLayout.FitPanel(Size.X, Size.Y);
        if (frame.Width <= 0) return MinScale;
        var hole = frame.Width * PanelTheme.HoleDiameter;
        var required = Math.Max(MinScale, MinimumHolePixels / hole);
        if (required > MaxScale) throw new InvalidOperationException("stage: maxScale cannot provide 24px hole targets");
        return required;
    }

    private void HandleStageKey(InputEventKey key)
    {
        if (!key.Pressed || key.Echo || key.CtrlPressed || key.MetaPressed || key.AltPressed) return;
        var text = key.AsText().ToLowerInvariant();
        var focus = GetViewport().GuiGetFocusOwner();
        if (text == "escape" && focus is not null)
        {
            focus.ReleaseFocus();
            return;
        }
        if (focus is not null) return;
        if (text is "+" or "=") ZoomBy(ZoomStep);
        else if (text is "-" or "_") ZoomBy(1 / ZoomStep);
        else if (text.Contains("left", StringComparison.Ordinal)) PanBy(new Vector2((float)PanStepPixels, 0));
        else if (text.Contains("right", StringComparison.Ordinal)) PanBy(new Vector2((float)-PanStepPixels, 0));
        else if (text.Contains("up", StringComparison.Ordinal)) PanBy(new Vector2(0, (float)PanStepPixels));
        else if (text.Contains("down", StringComparison.Ordinal)) PanBy(new Vector2(0, (float)-PanStepPixels));
        else if (text is "0" or "home") SetView("fit");
        else if (key.IsActionPressed("wire_view")) SetView("wire");
        else if (key.IsActionPressed("view_toggle"))
        {
            GetViewport().SetInputAsHandled();
            _toggleView?.Invoke();
        }
    }

    private void ApplyTransform()
    {
        if (_panel is null || Size.X <= 0 || Size.Y <= 0) return;
        var frame = PanelLayout.FitPanel(Size.X, Size.Y);
        var scaledWidth = frame.Width * _scale;
        var scaledHeight = frame.Height * _scale;
        var limitX = Math.Max(0, (scaledWidth - Size.X) / 2);
        var limitY = Math.Max(0, (scaledHeight - Size.Y) / 2);
        _pan.X = Math.Clamp(_pan.X, (float)-limitX, (float)limitX);
        _pan.Y = Math.Clamp(_pan.Y, (float)-limitY, (float)limitY);
        _panel.Size = new Vector2((float)frame.Width, (float)frame.Height);
        _panel.PivotOffset = _panel.Size / 2;
        _panel.Scale = new Vector2((float)_scale, (float)_scale);
        _panel.Position = new Vector2((float)frame.X, (float)frame.Y) + _pan;
    }
}
