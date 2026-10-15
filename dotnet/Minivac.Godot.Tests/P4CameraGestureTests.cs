using System.Reflection;
using Godot;
using Xunit;

namespace Minivac.Godot.Tests;

public sealed class P4CameraGestureTests
{
    [Fact]
    public void The_forwarder_keeps_no_copy_of_the_camera_gesture_state()
    {
        // InputCaptureOnDrag captures the left button only, so the Area3D never sees the right or
        // middle release that ends an orbit or a pan. A copy of the flag there latches for good.
        foreach (var name in new[] { "_orbiting", "_altLeftOrbiting", "_panning" })
            Assert.Null(typeof(QuadInput).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic));
    }

    [Fact]
    public void A_right_press_and_release_leaves_no_active_gesture()
    {
        var gesture = default(Gesture).After(MouseButton.Right, true, false);
        Assert.True(gesture.Active);

        gesture = gesture.After(MouseButton.Right, false, false);

        Assert.False(gesture.Active);
    }

    [Fact]
    public void A_middle_press_and_release_leaves_no_active_gesture()
    {
        var gesture = default(Gesture).After(MouseButton.Middle, true, false);
        Assert.True(gesture.Active);

        gesture = gesture.After(MouseButton.Middle, false, false);

        Assert.False(gesture.Active);
    }

    [Fact]
    public void An_alt_left_orbit_ends_even_when_alt_is_released_before_the_button()
    {
        var gesture = default(Gesture).After(MouseButton.Left, true, true);
        Assert.True(gesture.Active);

        gesture = gesture.After(MouseButton.Left, false, false);

        Assert.False(gesture.Active);
    }

    [Fact]
    public void A_plain_left_press_starts_no_gesture()
    {
        Assert.False(default(Gesture).After(MouseButton.Left, true, false).Active);
    }

    [Fact]
    public void Releasing_one_button_leaves_another_gesture_running()
    {
        var gesture = default(Gesture)
            .After(MouseButton.Right, true, false)
            .After(MouseButton.Middle, true, false)
            .After(MouseButton.Right, false, false);

        Assert.True(gesture.Active);
        Assert.True(gesture.Panning);
        Assert.False(gesture.Orbiting);
    }

    [Fact]
    public void A_drag_that_ends_during_a_camera_gesture_still_terminates()
    {
        // Press a jack with nothing else held, then press right to orbit while still holding left.
        // The left release is the second half of a transaction the press already committed to, so
        // it must reach the panel; otherwise Cords keeps a drag that never sees its mouse-up.
        Assert.True(QuadInput.ForwardsButton(MouseButton.Left, true, false, false));
        Assert.False(QuadInput.ForwardsButton(MouseButton.Right, true, false, false));
        Assert.True(QuadInput.ForwardsButton(MouseButton.Left, false, false, true));
    }

    [Fact]
    public void A_release_is_never_filtered_by_the_modifiers_held_at_the_time()
    {
        Assert.True(QuadInput.ForwardsButton(MouseButton.Left, false, true, false));
        Assert.True(QuadInput.ForwardsButton(MouseButton.Left, false, true, true));
    }

    [Fact]
    public void A_press_is_filtered_by_alt_and_by_a_running_camera_gesture()
    {
        Assert.True(QuadInput.ForwardsButton(MouseButton.Left, true, false, false));
        Assert.False(QuadInput.ForwardsButton(MouseButton.Left, true, true, false));
        Assert.False(QuadInput.ForwardsButton(MouseButton.Left, true, false, true));
    }

    [Fact]
    public void Only_the_left_button_reaches_the_panel()
    {
        foreach (var index in new[]
            { MouseButton.Right, MouseButton.Middle, MouseButton.WheelUp, MouseButton.WheelDown })
        {
            Assert.False(QuadInput.ForwardsButton(index, true, false, false));
            Assert.False(QuadInput.ForwardsButton(index, false, false, false));
        }
    }
}
