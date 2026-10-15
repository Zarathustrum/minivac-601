using System;
using Godot;

namespace Minivac.Godot;

public partial class QuadInput : Area3D
{
    // Far enough outside the quad, in quad-local units, that no hole rect can claim the pixel.
    private const float OffQuadLocalX = 1000;
    private const float ParallelEpsilon = 1e-6f;

    private Viewport _viewport = null!;
    private MeshInstance3D _quad = null!;
    private Vector2 _quadSize;
    private Func<Vector2I> _viewportSize = null!;
    private Func<bool> _gestureActive = null!;
    private Vector2 _previous;
    private bool _hasPrevious;
    private bool _dragging;

    public bool Dragging => _dragging;

    // Where the camera ray crosses the quad's plane. A ray parallel to that plane, or one whose
    // crossing lies behind the camera, resolves outside the quad rather than anywhere on it.
    public static Vector3 QuadPointFromRay(Vector3 rayOrigin, Vector3 rayDirection, Transform3D quadGlobal)
    {
        var normal = quadGlobal.Basis.Z;
        var denominator = normal.Dot(rayDirection);
        if (Math.Abs(denominator) <= ParallelEpsilon) return quadGlobal * new Vector3(OffQuadLocalX, 0, 0);
        var distance = normal.Dot(quadGlobal.Origin - rayOrigin) / denominator;
        return distance > 0
            ? rayOrigin + rayDirection * distance
            : quadGlobal * new Vector3(OffQuadLocalX, 0, 0);
    }

    // A press arbitrates between the camera gesture and the panel, so alt and a running gesture
    // filter it. A release is the second half of a transaction the press already committed to:
    // OnInputEvent only lets through releases whose press was forwarded, so it needs no filter.
    public static bool ForwardsButton(MouseButton index, bool pressed, bool altPressed, bool gestureActive) =>
        index == MouseButton.Left && !(pressed && (altPressed || gestureActive));

    public void Initialize(
        MeshInstance3D quad,
        Viewport viewport,
        Vector2 quadSize,
        Func<Vector2I> viewportSize,
        Func<bool> gestureActive)
    {
        ArgumentNullException.ThrowIfNull(quad);
        ArgumentNullException.ThrowIfNull(viewport);
        ArgumentNullException.ThrowIfNull(viewportSize);
        ArgumentNullException.ThrowIfNull(gestureActive);
        Name = "InputSurface";
        _quad = quad;
        _viewport = viewport;
        _quadSize = quadSize;
        _viewportSize = viewportSize;
        _gestureActive = gestureActive;
        CollisionLayer = 1;
        InputRayPickable = true;
        InputCaptureOnDrag = true;
        InputEvent += OnInputEvent;
        MouseEntered += _viewport.NotifyMouseEntered;
        MouseExited += _viewport.NotifyMouseExited;
    }

    internal void Forward(InputEvent input, Vector3 worldPoint)
    {
        var pixel = QuadMap.PixelFromWorld(worldPoint, _quad.GlobalTransform, _quadSize, _viewportSize());
        if (input is InputEventMouseButton button)
        {
            if (!ForwardsButton(button.ButtonIndex, button.Pressed, button.AltPressed, _gestureActive())) return;
            var forwarded = (InputEventMouseButton)button.Duplicate();
            forwarded.Position = pixel;
            forwarded.GlobalPosition = pixel;
            // Mirror Stage._GuiInput: a click on the panel unparks a focused shell control.
            if (button.Pressed) GetViewport().GuiGetFocusOwner()?.ReleaseFocus();
            _dragging = button.Pressed;
            _previous = pixel;
            _hasPrevious = true;
            _viewport.PushInput(forwarded);
        }
        else if (input is InputEventMouseMotion motion)
        {
            if (_gestureActive()) return;
            var forwarded = (InputEventMouseMotion)motion.Duplicate();
            forwarded.Position = pixel;
            forwarded.GlobalPosition = pixel;
            forwarded.Relative = _hasPrevious ? pixel - _previous : Vector2.Zero;
            forwarded.Velocity = Vector2.Zero;
            _previous = pixel;
            _hasPrevious = true;
            _viewport.PushInput(forwarded);
        }
    }

    private void OnInputEvent(
        Node camera,
        InputEvent input,
        Vector3 eventPosition,
        Vector3 normal,
        long shapeIndex)
    {
        // A press filtered out as a camera gesture must not leave its release to be forwarded on
        // its own: the alt of an alt+left orbit can be lifted before the button is, which makes
        // the release indistinguishable from the end of a cord drag.
        if (input is InputEventMouseButton button && !button.Pressed && !_dragging) return;
        Forward(input, WorldPoint(camera, input, eventPosition));
    }

    // A captured drag arrives with eventPosition (0,0,0) once the ray misses the shape, and the
    // quad transform maps that straight onto the panel centre, so re-derive it from the ray.
    private Vector3 WorldPoint(Node camera, InputEvent input, Vector3 eventPosition) =>
        camera is Camera3D view && input is InputEventMouse mouse
            ? QuadPointFromRay(
                view.ProjectRayOrigin(mouse.Position),
                view.ProjectRayNormal(mouse.Position),
                _quad.GlobalTransform)
            : eventPosition;
}
