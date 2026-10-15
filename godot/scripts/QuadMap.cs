using Godot;

namespace Minivac.Godot;

public static class QuadMap
{
    public static Vector2 PixelFromWorld(
        Vector3 worldPoint,
        Transform3D quadGlobal,
        Vector2 quadSize,
        Vector2I viewportSize)
    {
        var quadLocal = quadGlobal.AffineInverse() * worldPoint;
        var uv = new Vector2(quadLocal.X, -quadLocal.Y) / quadSize + new Vector2(0.5f, 0.5f);
        return uv * new Vector2(viewportSize.X, viewportSize.Y);
    }
}
