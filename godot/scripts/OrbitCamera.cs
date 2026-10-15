using System;
using Godot;

namespace Minivac.Godot;

// The camera owns the orbit and pan gesture state: _UnhandledInput sees every press and release
// wherever the pointer is, which the picked Area3D does not.
public readonly record struct Gesture(bool Orbiting, bool AltOrbiting, bool Panning)
{
    public bool Active => Orbiting || AltOrbiting || Panning;

    public Gesture After(MouseButton index, bool pressed, bool altPressed) => index switch
    {
        MouseButton.Right => this with { Orbiting = pressed },
        MouseButton.Middle => this with { Panning = pressed },
        MouseButton.Left when altPressed || AltOrbiting => this with { AltOrbiting = pressed },
        _ => this,
    };
}

public partial class OrbitCamera : Camera3D
{
    private Pose _pose;
    private Vector3 _target;
    private Gesture _gesture;
    private bool _wireFramed;
    private Func<bool> _panelHasFocus = null!;
    private Action<InputEvent> _forwardKey = null!;
    private Action _releasePanelFocus = null!;
    private Action _toggleView = null!;

    public Pose CurrentPose => _pose;
    public Vector3 Target => _target;
    public bool GestureActive => _gesture.Active;

    public void Initialize(
        Func<bool> panelHasFocus,
        Action<InputEvent> forwardKey,
        Action releasePanelFocus,
        Action toggleView)
    {
        ArgumentNullException.ThrowIfNull(panelHasFocus);
        ArgumentNullException.ThrowIfNull(forwardKey);
        ArgumentNullException.ThrowIfNull(releasePanelFocus);
        ArgumentNullException.ThrowIfNull(toggleView);
        Name = "Camera3D";
        _panelHasFocus = panelHasFocus;
        _forwardKey = forwardKey;
        _releasePanelFocus = releasePanelFocus;
        _toggleView = toggleView;
        Current = true;
        Input.MouseMode = Input.MouseModeEnum.Visible;
        ResetPose();
    }

    public void ResetPose()
    {
        _wireFramed = false;
        var value = TactileTheme.CameraDefaultPose.Value;
        _pose = new Pose(value.ElevationDeg, value.AzimuthDeg, value.DollyW);
        _target = Vector3.Zero;
        Fov = (float)TactileTheme.CameraFovDeg.Value;
        ApplyPose();
    }

    public void WirePose()
    {
        _wireFramed = true;
        _pose = OrbitMath.WireDolly(_pose);
        _target = Vector3.Zero;
        Fov = (float)TactileTheme.CameraWireFovDeg.Value;
        ApplyPose();
    }

    public void DollyBy(double notches)
    {
        _pose = OrbitMath.ClampPose(_pose with
        {
            DollyW = _pose.DollyW + notches * TactileTheme.DollyPerWheelNotch.Value,
        });
        if (_wireFramed)
        {
            _pose = _pose with
            {
                DollyW = Math.Clamp(
                    _pose.DollyW,
                    TactileTheme.CameraDolly.Value.X,
                    TactileTheme.CameraWireDollyW.Value),
            };
        }
        ApplyPose();
    }

    public void PanBy(Vector2 pixels)
    {
        _target -= GlobalTransform.Basis.X * pixels.X * (float)TactileTheme.PanWPerPixel.Value;
        _target += GlobalTransform.Basis.Y * pixels.Y * (float)TactileTheme.PanWPerPixel.Value;
        ApplyPose();
    }

    public override void _UnhandledInput(InputEvent input)
    {
        if (input is InputEventMouseButton button)
        {
            _gesture = _gesture.After(button.ButtonIndex, button.Pressed, button.AltPressed);
            if (button.Pressed && button.ButtonIndex == MouseButton.WheelUp) DollyBy(-1);
            if (button.Pressed && button.ButtonIndex == MouseButton.WheelDown) DollyBy(1);
        }
        else if (input is InputEventMouseMotion motion)
        {
            if (_gesture.Orbiting || _gesture.AltOrbiting)
            {
                _pose = OrbitMath.ClampPose(_pose with
                {
                    ElevationDeg = _pose.ElevationDeg - motion.Relative.Y * TactileTheme.OrbitDegPerPixel.Value,
                    AzimuthDeg = _pose.AzimuthDeg + motion.Relative.X * TactileTheme.OrbitDegPerPixel.Value,
                });
                ApplyPose();
            }
            else if (_gesture.Panning)
            {
                PanBy(motion.Relative);
            }
        }
    }

    public override void _UnhandledKeyInput(InputEvent input)
    {
        if (input is not InputEventKey key || key.Echo || key.CtrlPressed || key.MetaPressed)
            return;
        if (_panelHasFocus())
        {
            _forwardKey(key);
            if (key.Pressed && key.Keycode == Key.Escape) _releasePanelFocus();
            GetViewport().SetInputAsHandled();
            return;
        }
        if (!key.Pressed) return;
        // Flat mode unparks a focused shell control on Escape (Stage.HandleStageKey). Without the
        // same escape here a focused toolbar button eats F, W and R for the rest of the session.
        if (key.Keycode == Key.Escape && GetViewport().GuiGetFocusOwner() is { } focus)
        {
            focus.ReleaseFocus();
            GetViewport().SetInputAsHandled();
            return;
        }
        if (GetViewport().GuiGetFocusOwner() is not null) return;
        if (!key.AltPressed && key.IsActionPressed("view_toggle"))
        {
            GetViewport().SetInputAsHandled();
            _toggleView();
            return;
        }
        else if (!key.AltPressed && key.IsActionPressed("camera_reset")) ResetPose();
        else if (!key.AltPressed && key.IsActionPressed("wire_view")) WirePose();
        else
        {
            _forwardKey(key);
            return;
        }
        GetViewport().SetInputAsHandled();
    }

    private void ApplyPose()
    {
        var elevation = _pose.ElevationDeg * Math.PI / 180;
        var azimuth = _pose.AzimuthDeg * Math.PI / 180;
        var planar = Math.Cos(elevation) * _pose.DollyW;
        Position = _target + new Vector3(
            (float)(Math.Sin(azimuth) * planar),
            (float)(-Math.Cos(azimuth) * planar),
            (float)(Math.Sin(elevation) * _pose.DollyW));
        LookAt(_target, Vector3.Up);
    }
}
