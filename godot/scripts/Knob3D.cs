using System;
using System.Linq;
using Godot;

namespace Minivac.Godot;

internal static class Knob3D
{
    internal static Node3D Build(PanelControl item, PanelLayout layout)
    {
        ArgumentNullException.ThrowIfNull(layout);
        var innerCircle = layout.Linework.Single(line => line.Id == "decimal/inner-circle");
        var innerCircleRadius = innerCircle.RadiusX ??
            throw new InvalidOperationException("knob: decimal inner circle has no radius");
        var radius = innerCircleRadius * TactileTheme.KnobWedgeRadiusOverInnerCircle.Value;
        var diameter = radius * 2;
        var height = TactileTheme.KnobHeight.Value;
        var surface = TactileTheme.KnobSurface.Value;
        var root = new Node3D
        {
            Name = "PopOut_" + item.Id,
            Position = Case3D.PanelPoint(item.X, item.Y, 0),
        };
        root.SetMeta("popout_id", item.Id);

        var bodyMaterial = Case3D.Material(surface.BodyColour, 0, surface.Roughness);
        var wedgeMaterial = Case3D.Material(TactileTheme.ConsoleCream.Value, 0, surface.Roughness);
        Case3D.AddCylinderWithTopWedge(
            root,
            "Knob",
            new Vector3(0, 0, (float)(height / 2)),
            new Vector3((float)diameter, (float)diameter, (float)height),
            CylinderAxis.Z,
            surface.WedgeAngleDeg,
            bodyMaterial,
            wedgeMaterial);
        return root;
    }
}
