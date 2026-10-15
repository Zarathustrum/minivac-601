using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Minivac.Godot;

internal enum CylinderAxis { X, Y, Z }

public static class Case3D
{
    public static Node3D Build(PanelLayout layout)
    {
        ArgumentNullException.ThrowIfNull(layout);
        var root = new Node3D { Name = "Case" };
        var recess = TactileTheme.PlateRecess.Value;
        var height = TactileTheme.CaseHeight.Value;
        var frameMaterial = Material(
            TactileTheme.ConsoleTeal.Value,
            0,
            TactileTheme.FrameFinish.Value);
        AddRoundedPrism(
            root,
            "CaseBody",
            new Vector3(0, 0, (float)(-height / 2)),
            new Vector3(1, (float)(1 / layout.Aspect), (float)height),
            TactileTheme.CaseEdgeRadius.Value,
            frameMaterial);
        AddFrameRails(root, layout, frameMaterial);

        var edgeMaterial = Material(TactileTheme.ChalkyCore.Value);
        edgeMaterial.CullMode = BaseMaterial3D.CullModeEnum.Disabled;
        foreach (var plate in layout.Plates) AddPlateEdge(root, plate, recess, edgeMaterial);

        AddFeet(root, layout.Aspect);
        foreach (var item in layout.Components.Where(item => item.Kind == "relay"))
            Relay3D.BuildFixed(root, item);
        Bezels.BuildFixed(root, layout);
        return root;
    }

    internal static Vector3 PanelPoint(double x, double y, double z) => new(
        (float)(x - 0.5),
        (float)((0.5 - y) / PanelLayout.PanelAspect),
        (float)z);

    internal static StandardMaterial3D Material(Color albedo) => new()
    {
        AlbedoColor = albedo,
    };

    internal static StandardMaterial3D Material(Color albedo, double metallic, double roughness) => new()
    {
        AlbedoColor = albedo,
        Metallic = (float)metallic,
        Roughness = (float)roughness,
    };

    internal static MeshInstance3D AddPrism(
        Node3D parent,
        string name,
        Vector3 center,
        Vector3 size,
        BaseMaterial3D material)
    {
        using var surface = Begin(material);
        var half = size / 2;
        var left = -half.X;
        var right = half.X;
        var bottom = -half.Y;
        var top = half.Y;
        var back = -half.Z;
        var front = half.Z;
        AddQuad(surface,
            new Vector3(left, bottom, front), new Vector3(right, bottom, front),
            new Vector3(right, top, front), new Vector3(left, top, front));
        AddQuad(surface,
            new Vector3(right, bottom, back), new Vector3(left, bottom, back),
            new Vector3(left, top, back), new Vector3(right, top, back));
        AddQuad(surface,
            new Vector3(right, bottom, front), new Vector3(right, bottom, back),
            new Vector3(right, top, back), new Vector3(right, top, front));
        AddQuad(surface,
            new Vector3(left, bottom, back), new Vector3(left, bottom, front),
            new Vector3(left, top, front), new Vector3(left, top, back));
        AddQuad(surface,
            new Vector3(left, top, front), new Vector3(right, top, front),
            new Vector3(right, top, back), new Vector3(left, top, back));
        AddQuad(surface,
            new Vector3(left, bottom, back), new Vector3(right, bottom, back),
            new Vector3(right, bottom, front), new Vector3(left, bottom, front));
        return AddMesh(parent, name, center, surface.Commit());
    }

    internal static MeshInstance3D AddCylinder(
        Node3D parent,
        string name,
        Vector3 center,
        Vector3 size,
        CylinderAxis axis,
        BaseMaterial3D material)
    {
        using var surface = Begin(material);
        AddCylinderBody(surface, size, axis, true);
        return AddMesh(parent, name, center, surface.Commit());
    }

    internal static MeshInstance3D AddCylinderWithTopWedge(
        Node3D parent,
        string name,
        Vector3 center,
        Vector3 size,
        CylinderAxis axis,
        double wedgeAngleDeg,
        BaseMaterial3D bodyMaterial,
        BaseMaterial3D wedgeMaterial)
    {
        var mesh = new ArrayMesh();
        var segments = TactileTheme.MeshQuality.Value.RadialSegments;
        var outerRadius = RadialSize(size, axis) / 2;
        var axial = AxialSize(size, axis) / 2;
        var wedgeHalf = wedgeAngleDeg / 2 * Math.PI / 180;
        var wedgeCentre = Math.PI / 2;
        var wedgeStart = wedgeCentre - wedgeHalf;
        var wedgeEnd = wedgeCentre + wedgeHalf;
        var angles = Enumerable.Range(0, segments)
            .Select(index => Math.Tau * index / segments)
            .Append(wedgeStart)
            .Append(wedgeEnd)
            .Distinct()
            .Order()
            .ToArray();
        using var body = Begin(bodyMaterial);
        AddCylinderBody(body, size, axis, false, angles);
        for (var index = 0; index < angles.Length; index++)
        {
            var angleA = angles[index];
            var angleB = index + 1 < angles.Length ? angles[index + 1] : angles[0] + Math.Tau;
            var inWedge = angleA >= wedgeStart && angleB <= wedgeEnd;
            var outerA = AxisPoint(axis, outerRadius.X * Math.Cos(angleA), outerRadius.Y * Math.Sin(angleA), axial);
            var outerB = AxisPoint(axis, outerRadius.X * Math.Cos(angleB), outerRadius.Y * Math.Sin(angleB), axial);
            if (!inWedge) AddTriangle(body, AxisPoint(axis, 0, 0, axial), outerA, outerB);
        }
        body.Commit(mesh);

        using var wedge = Begin(wedgeMaterial);
        for (var index = 0; index < angles.Length; index++)
        {
            var angleA = angles[index];
            var angleB = index + 1 < angles.Length ? angles[index + 1] : angles[0] + Math.Tau;
            var inWedge = angleA >= wedgeStart && angleB <= wedgeEnd;
            if (!inWedge) continue;
            AddTriangle(
                wedge,
                AxisPoint(axis, 0, 0, axial),
                AxisPoint(axis, outerRadius.X * Math.Cos(angleA), outerRadius.Y * Math.Sin(angleA), axial),
                AxisPoint(axis, outerRadius.X * Math.Cos(angleB), outerRadius.Y * Math.Sin(angleB), axial));
        }
        wedge.Commit(mesh);
        return AddMesh(parent, name, center, mesh);
    }

    internal static MeshInstance3D AddRing(
        Node3D parent,
        string name,
        Vector3 center,
        double outerDiameter,
        double innerDiameter,
        double height,
        BaseMaterial3D material)
    {
        using var surface = Begin(material);
        var segments = TactileTheme.MeshQuality.Value.RadialSegments;
        var outer = outerDiameter / 2;
        var inner = innerDiameter / 2;
        var halfHeight = height / 2;
        for (var index = 0; index < segments; index++)
        {
            var angleA = Math.Tau * index / segments;
            var angleB = Math.Tau * (index + 1) / segments;
            var outerA = new Vector3((float)(outer * Math.Cos(angleA)), (float)(outer * Math.Sin(angleA)), (float)halfHeight);
            var outerB = new Vector3((float)(outer * Math.Cos(angleB)), (float)(outer * Math.Sin(angleB)), (float)halfHeight);
            var innerA = new Vector3((float)(inner * Math.Cos(angleA)), (float)(inner * Math.Sin(angleA)), (float)halfHeight);
            var innerB = new Vector3((float)(inner * Math.Cos(angleB)), (float)(inner * Math.Sin(angleB)), (float)halfHeight);
            AddQuad(surface, innerA, outerA, outerB, innerB);
            AddQuad(surface,
                new Vector3(outerA.X, outerA.Y, -outerA.Z),
                new Vector3(outerB.X, outerB.Y, -outerB.Z),
                outerB,
                outerA);
            AddQuad(surface,
                new Vector3(innerB.X, innerB.Y, -innerB.Z),
                new Vector3(innerA.X, innerA.Y, -innerA.Z),
                innerA,
                innerB);
        }
        return AddMesh(parent, name, center, surface.Commit());
    }

    private static void AddFrameRails(Node3D parent, PanelLayout layout, BaseMaterial3D material)
    {
        var xEdges = layout.Plates.SelectMany(plate => new[] { plate.X, plate.X + plate.Width })
            .Append(0).Append(1).Distinct().Order().ToArray();
        var yEdges = layout.Plates.SelectMany(plate => new[] { plate.Y, plate.Y + plate.Height })
            .Append(0).Append(1).Distinct().Order().ToArray();
        for (var xIndex = 0; xIndex + 1 < xEdges.Length; xIndex++)
        {
            for (var yIndex = 0; yIndex + 1 < yEdges.Length; yIndex++)
            {
                var left = xEdges[xIndex];
                var right = xEdges[xIndex + 1];
                var top = yEdges[yIndex];
                var bottom = yEdges[yIndex + 1];
                var centerX = (left + right) / 2;
                var centerY = (top + bottom) / 2;
                if (layout.Plates.Any(plate =>
                    centerX >= plate.X && centerX <= plate.X + plate.Width &&
                    centerY >= plate.Y && centerY <= plate.Y + plate.Height)) continue;
                var plateOnLeft = xIndex > 0 && CellIsPlate(
                    layout,
                    (xEdges[xIndex - 1] + left) / 2,
                    centerY);
                var plateOnRight = xIndex + 2 < xEdges.Length && CellIsPlate(
                    layout,
                    (right + xEdges[xIndex + 2]) / 2,
                    centerY);
                var plateAbove = yIndex > 0 && CellIsPlate(
                    layout,
                    centerX,
                    (yEdges[yIndex - 1] + top) / 2);
                var plateBelow = yIndex + 2 < yEdges.Length && CellIsPlate(
                    layout,
                    centerX,
                    (bottom + yEdges[yIndex + 2]) / 2);
                AddFrameRail(
                    parent,
                    $"FrameRail_{xIndex}_{yIndex}",
                    FrameRailPoints(left, right, top, bottom, layout.Aspect),
                    TactileTheme.PlateRecess.Value,
                    material,
                    !plateOnLeft,
                    !plateOnRight,
                    !plateAbove,
                    !plateBelow);
            }
        }
    }

    private static bool CellIsPlate(PanelLayout layout, double x, double y) =>
        layout.Plates.Any(plate =>
            x >= plate.X && x <= plate.X + plate.Width &&
            y >= plate.Y && y <= plate.Y + plate.Height);

    private static void AddFrameRail(
        Node3D parent,
        string name,
        IReadOnlyList<Vector2> points,
        double height,
        BaseMaterial3D material,
        bool includeLeft,
        bool includeRight,
        bool includeTop,
        bool includeBottom)
    {
        using var surface = Begin(material);
        var center = points.Aggregate(Vector2.Zero, (sum, point) => sum + point) / points.Count;
        var left = points.Min(point => point.X);
        var right = points.Max(point => point.X);
        var bottom = points.Min(point => point.Y);
        var top = points.Max(point => point.Y);
        for (var index = 0; index < points.Count; index++)
        {
            var next = (index + 1) % points.Count;
            var a = points[index];
            var b = points[next];
            var bottomA = new Vector3(a.X, a.Y, 0);
            var bottomB = new Vector3(b.X, b.Y, 0);
            var topA = new Vector3(a.X, a.Y, (float)height);
            var topB = new Vector3(b.X, b.Y, (float)height);
            AddTriangle(surface, new Vector3(center.X, center.Y, (float)height), topA, topB);
            AddTriangle(surface, new Vector3(center.X, center.Y, 0), bottomB, bottomA);
            var includeSide = !(a.X == left && b.X == left && !includeLeft) &&
                !(a.X == right && b.X == right && !includeRight) &&
                !(a.Y == top && b.Y == top && !includeTop) &&
                !(a.Y == bottom && b.Y == bottom && !includeBottom);
            if (includeSide) AddQuad(surface, bottomA, bottomB, topB, topA);
        }
        AddMesh(parent, name, Vector3.Zero, surface.Commit());
    }

    private static IReadOnlyList<Vector2> FrameRailPoints(
        double left,
        double right,
        double top,
        double bottom,
        double aspect)
    {
        var worldLeft = (float)(left - 0.5);
        var worldRight = (float)(right - 0.5);
        var worldTop = (float)((0.5 - top) / aspect);
        var worldBottom = (float)((0.5 - bottom) / aspect);
        var halfWidth = 0.5f;
        var halfHeight = (float)(0.5 / aspect);
        var radius = (float)TactileTheme.CaseEdgeRadius.Value;
        var quarterTurnDeg = 180.0 / 2;
        var segments = TactileTheme.MeshQuality.Value.CaseCornerSegments;
        var points = new List<Vector2>();

        if (left == 0 && top == 0)
        {
            points.Add(new Vector2(worldLeft, worldBottom));
            points.Add(new Vector2(worldRight, worldBottom));
            points.Add(new Vector2(worldRight, worldTop));
            AddArc(-halfWidth + radius, halfHeight - radius, quarterTurnDeg);
        }
        else if (right == 1 && top == 0)
        {
            points.Add(new Vector2(worldLeft, worldBottom));
            points.Add(new Vector2(worldRight, worldBottom));
            AddArc(halfWidth - radius, halfHeight - radius, 0);
            points.Add(new Vector2(worldLeft, worldTop));
        }
        else if (left == 0 && bottom == 1)
        {
            AddArc(-halfWidth + radius, -halfHeight + radius, quarterTurnDeg * 2);
            points.Add(new Vector2(worldRight, worldBottom));
            points.Add(new Vector2(worldRight, worldTop));
            points.Add(new Vector2(worldLeft, worldTop));
        }
        else if (right == 1 && bottom == 1)
        {
            points.Add(new Vector2(worldLeft, worldBottom));
            AddArc(halfWidth - radius, -halfHeight + radius, quarterTurnDeg * 2 + quarterTurnDeg);
            points.Add(new Vector2(worldRight, worldTop));
            points.Add(new Vector2(worldLeft, worldTop));
        }
        else
        {
            points.Add(new Vector2(worldLeft, worldBottom));
            points.Add(new Vector2(worldRight, worldBottom));
            points.Add(new Vector2(worldRight, worldTop));
            points.Add(new Vector2(worldLeft, worldTop));
        }
        return points;

        void AddArc(float centerX, float centerY, double startDeg)
        {
            for (var step = 0; step <= segments; step++)
            {
                var angle = (startDeg + quarterTurnDeg * step / segments) * Math.PI / 180;
                points.Add(new Vector2(
                    centerX + radius * (float)Math.Cos(angle),
                    centerY + radius * (float)Math.Sin(angle)));
            }
        }
    }

    private static void AddPlateEdge(
        Node3D parent,
        PanelPlate plate,
        double height,
        BaseMaterial3D material)
    {
        var leftTop = PanelPoint(plate.X, plate.Y, 0);
        var rightTop = PanelPoint(plate.X + plate.Width, plate.Y, 0);
        var rightBottom = PanelPoint(plate.X + plate.Width, plate.Y + plate.Height, 0);
        var leftBottom = PanelPoint(plate.X, plate.Y + plate.Height, 0);
        var raised = new Vector3(0, 0, (float)height);
        using var surface = Begin(material);
        AddQuad(surface, leftTop, leftTop + raised, rightTop + raised, rightTop);
        AddQuad(surface, rightTop, rightTop + raised, rightBottom + raised, rightBottom);
        AddQuad(surface, rightBottom, rightBottom + raised, leftBottom + raised, leftBottom);
        AddQuad(surface, leftBottom, leftBottom + raised, leftTop + raised, leftTop);
        AddMesh(parent, "PlateEdge_" + plate.Id, Vector3.Zero, surface.Commit());
    }

    private static void AddFeet(Node3D parent, double aspect)
    {
        var material = Material(TactileTheme.FootColour.Value);
        var inset = TactileTheme.FootInset.Value;
        var x = 0.5 - inset;
        var y = 0.5 / aspect - inset;
        var z = -TactileTheme.CaseHeight.Value - TactileTheme.FootHeight.Value / 2;
        var signs = new[] { -1, 1 };
        var positions = signs.SelectMany(xSign => signs.Select(ySign => new Vector3(
            (float)(xSign * x),
            (float)(ySign * y),
            (float)z))).ToArray();
        for (var index = 0; index < TactileTheme.FootCount.Value; index++)
        {
            var diameter = TactileTheme.FootRadius.Value * 2;
            AddCylinder(
                parent,
                "Foot" + index,
                positions[index],
                new Vector3((float)diameter, (float)diameter, (float)TactileTheme.FootHeight.Value),
                CylinderAxis.Z,
                material);
        }
    }

    private static MeshInstance3D AddRoundedPrism(
        Node3D parent,
        string name,
        Vector3 center,
        Vector3 size,
        double radius,
        BaseMaterial3D material)
    {
        var points = new List<Vector2>();
        var half = new Vector2(size.X, size.Y) / 2;
        var segments = TactileTheme.MeshQuality.Value.CaseCornerSegments;
        var quarterTurnDeg = 180.0 / 2;
        var corners = new[]
        {
            (X: 1, Y: 1, StartDeg: 0.0),
            (X: -1, Y: 1, StartDeg: quarterTurnDeg),
            (X: -1, Y: -1, StartDeg: quarterTurnDeg * 2),
            (X: 1, Y: -1, StartDeg: quarterTurnDeg * 2 + quarterTurnDeg),
        };
        foreach (var corner in corners)
        {
            var centerX = corner.X * (half.X - (float)radius);
            var centerY = corner.Y * (half.Y - (float)radius);
            for (var step = 0; step <= segments; step++)
            {
                var angle = (corner.StartDeg + quarterTurnDeg * step / segments) * Math.PI / 180;
                points.Add(new Vector2(
                    centerX + (float)(radius * Math.Cos(angle)),
                    centerY + (float)(radius * Math.Sin(angle))));
            }
        }
        using var surface = Begin(material);
        var halfHeight = size.Z / 2;
        for (var index = 0; index < points.Count; index++)
        {
            var next = (index + 1) % points.Count;
            var topA = new Vector3(points[index].X, points[index].Y, halfHeight);
            var topB = new Vector3(points[next].X, points[next].Y, halfHeight);
            var bottomA = new Vector3(points[index].X, points[index].Y, -halfHeight);
            var bottomB = new Vector3(points[next].X, points[next].Y, -halfHeight);
            AddTriangle(surface, Vector3.Zero with { Z = -halfHeight }, bottomB, bottomA);
            AddQuad(surface, bottomA, bottomB, topB, topA);
        }
        return AddMesh(parent, name, center, surface.Commit());
    }

    private static void AddCylinderBody(SurfaceTool surface, Vector3 size, CylinderAxis axis, bool addTop)
    {
        var segments = TactileTheme.MeshQuality.Value.RadialSegments;
        var angles = Enumerable.Range(0, segments)
            .Select(index => Math.Tau * index / segments)
            .ToArray();
        AddCylinderBody(surface, size, axis, addTop, angles);
    }

    private static void AddCylinderBody(
        SurfaceTool surface,
        Vector3 size,
        CylinderAxis axis,
        bool addTop,
        IReadOnlyList<double> angles)
    {
        var radius = RadialSize(size, axis) / 2;
        var axial = AxialSize(size, axis) / 2;
        var bottomCenter = AxisPoint(axis, 0, 0, -axial);
        var topCenter = AxisPoint(axis, 0, 0, axial);
        for (var index = 0; index < angles.Count; index++)
        {
            var angleA = angles[index];
            var angleB = index + 1 < angles.Count ? angles[index + 1] : angles[0] + Math.Tau;
            var bottomA = AxisPoint(axis, radius.X * Math.Cos(angleA), radius.Y * Math.Sin(angleA), -axial);
            var bottomB = AxisPoint(axis, radius.X * Math.Cos(angleB), radius.Y * Math.Sin(angleB), -axial);
            var topA = AxisPoint(axis, radius.X * Math.Cos(angleA), radius.Y * Math.Sin(angleA), axial);
            var topB = AxisPoint(axis, radius.X * Math.Cos(angleB), radius.Y * Math.Sin(angleB), axial);
            AddQuad(surface, bottomA, bottomB, topB, topA);
            AddTriangle(surface, bottomCenter, bottomB, bottomA);
            if (addTop) AddTriangle(surface, topCenter, topA, topB);
        }
    }

    private static Vector2 RadialSize(Vector3 size, CylinderAxis axis) => axis switch
    {
        CylinderAxis.X => new Vector2(size.Y, size.Z),
        CylinderAxis.Y => new Vector2(size.X, size.Z),
        _ => new Vector2(size.X, size.Y),
    };

    private static double AxialSize(Vector3 size, CylinderAxis axis) => axis switch
    {
        CylinderAxis.X => size.X,
        CylinderAxis.Y => size.Y,
        _ => size.Z,
    };

    private static Vector3 AxisPoint(CylinderAxis axis, double radialX, double radialY, double axial) => axis switch
    {
        CylinderAxis.X => new Vector3((float)axial, (float)radialX, (float)radialY),
        CylinderAxis.Y => new Vector3((float)radialX, (float)axial, (float)-radialY),
        _ => new Vector3((float)radialX, (float)radialY, (float)axial),
    };

    private static SurfaceTool Begin(BaseMaterial3D material)
    {
        var surface = new SurfaceTool();
        surface.Begin(Mesh.PrimitiveType.Triangles);
        surface.SetMaterial(material);
        return surface;
    }

    private static MeshInstance3D AddMesh(Node3D parent, string name, Vector3 center, ArrayMesh mesh)
    {
        var node = new MeshInstance3D { Name = name, Position = center, Mesh = mesh };
        parent.AddChild(node);
        return node;
    }

    private static void AddQuad(SurfaceTool surface, Vector3 a, Vector3 b, Vector3 c, Vector3 d)
    {
        AddTriangle(surface, a, b, c);
        AddTriangle(surface, a, c, d);
    }

    private static void AddTriangle(SurfaceTool surface, Vector3 a, Vector3 b, Vector3 c)
    {
        var normal = (b - a).Cross(c - a).Normalized();
        surface.SetNormal(normal);
        surface.AddVertex(a);
        surface.SetNormal(normal);
        surface.AddVertex(c);
        surface.SetNormal(normal);
        surface.AddVertex(b);
    }
}
