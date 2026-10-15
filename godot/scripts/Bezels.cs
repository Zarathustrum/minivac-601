using System;
using Godot;

namespace Minivac.Godot;

internal static class Bezels
{
    internal static void BuildFixed(Node3D parent, PanelLayout layout)
    {
        ArgumentNullException.ThrowIfNull(parent);
        ArgumentNullException.ThrowIfNull(layout);
        var cream = Case3D.Material(TactileTheme.ConsoleCream.Value);
        var chrome = Case3D.Material(
            TactileTheme.ConsoleCream.Value,
            TactileTheme.ChromeMetallic.Value,
            TactileTheme.ChromeRoughness.Value);
        foreach (var item in layout.Components)
        {
            if (item.Kind == "standard-lamp")
                AddBezel(
                    parent,
                    item,
                    TactileTheme.LampLens.Value,
                    TactileTheme.LampBezel.Value,
                    cream);
            else if (item.Kind == "pushbutton")
                AddBezel(
                    parent,
                    item,
                    TactileTheme.Pushbutton.Value,
                    TactileTheme.LampBezel.Value,
                    chrome);
            else if (item.Kind == "breaker-button")
                AddBezel(
                    parent,
                    item,
                    TactileTheme.Breaker.Value,
                    TactileTheme.LampBezel.Value,
                    chrome);
            else if (item.Kind == "power-jewel") AddJewelBarrel(parent, item, cream);
        }
    }

    private static void AddBezel(
        Node3D parent,
        PanelComponent item,
        double diameter,
        double width,
        BaseMaterial3D material)
    {
        var height = TactileTheme.LampBezelProud.Value;
        Case3D.AddRing(
            parent,
            "Bezel_" + item.Id,
            Case3D.PanelPoint(item.X, item.Y, height / 2),
            diameter,
            diameter - width * 2,
            height,
            material);
    }

    private static void AddJewelBarrel(
        Node3D parent,
        PanelComponent item,
        BaseMaterial3D material)
    {
        var diameter = TactileTheme.Jewel.Value;
        var height = TactileTheme.JewelBarrelProud.Value;
        var knurl = TactileTheme.JewelKnurl.Value;
        var root = new Node3D
        {
            Name = "JewelBarrel_" + item.Id,
            Position = Case3D.PanelPoint(item.X, item.Y, 0),
        };
        parent.AddChild(root);
        var innerDiameter = diameter - knurl.DepthW * 2;
        Case3D.AddCylinder(
            root,
            "Barrel",
            new Vector3(0, 0, (float)(height / 2)),
            new Vector3((float)innerDiameter, (float)innerDiameter, (float)height),
            CylinderAxis.Z,
            material);
        var innerRadius = innerDiameter / 2;
        var toothRadius = innerRadius + knurl.DepthW / 2;
        var toothWidth = Math.Tau * innerRadius / knurl.Count;
        for (var index = 0; index < knurl.Count; index++)
        {
            var angle = Math.Tau * index / knurl.Count;
            var tooth = Case3D.AddPrism(
                root,
                "Knurl" + index,
                new Vector3(
                    (float)(toothRadius * Math.Cos(angle)),
                    (float)(toothRadius * Math.Sin(angle)),
                    (float)(height / 2)),
                new Vector3((float)knurl.DepthW, (float)toothWidth, (float)height),
                material);
            tooth.RotationDegrees = new Vector3(0, 0, (float)(angle * 180 / Math.PI));
        }
        AddBezel(parent, item, diameter, TactileTheme.JewelBezel.Value, material);
    }
}
