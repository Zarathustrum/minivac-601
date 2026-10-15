using System;
using Godot;

namespace Minivac.Godot;

public readonly record struct Pose(double ElevationDeg, double AzimuthDeg, double DollyW);

public static class OrbitMath
{
    public static Pose ClampPose(Pose pose) => new(
        Math.Clamp(
            pose.ElevationDeg,
            TactileTheme.CameraElevationDeg.Value.X,
            TactileTheme.CameraElevationDeg.Value.Y),
        Math.Clamp(
            pose.AzimuthDeg,
            TactileTheme.CameraAzimuthDeg.Value.X,
            TactileTheme.CameraAzimuthDeg.Value.Y),
        Math.Clamp(
            pose.DollyW,
            TactileTheme.CameraDolly.Value.X,
            TactileTheme.CameraDolly.Value.Y));

    public static Pose WireDolly(Pose pose) => new(
        TactileTheme.CameraWireElevationDeg.Value,
        ClampPose(pose).AzimuthDeg,
        TactileTheme.CameraWireDollyW.Value);

    public static Vector2 Project(
        Vector3 worldPoint,
        Pose pose,
        double fovDeg,
        Vector2I windowSize)
    {
        var elevation = pose.ElevationDeg * Math.PI / 180;
        var azimuth = pose.AzimuthDeg * Math.PI / 180;
        var planar = Math.Cos(elevation) * pose.DollyW;
        var camera = new Vector3(
            (float)(Math.Sin(azimuth) * planar),
            (float)(-Math.Cos(azimuth) * planar),
            (float)(Math.Sin(elevation) * pose.DollyW));
        var forward = (-camera).Normalized();
        var right = forward.Cross(Vector3.Up).Normalized();
        var up = right.Cross(forward).Normalized();
        var relative = worldPoint - camera;
        var depth = relative.Dot(forward);
        var focal = windowSize.Y / (2 * Math.Tan(fovDeg * Math.PI / 360));
        return new Vector2(
            (float)(windowSize.X / 2 + relative.Dot(right) * focal / depth),
            (float)(windowSize.Y / 2 - relative.Dot(up) * focal / depth));
    }
}
