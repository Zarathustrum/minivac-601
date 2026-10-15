using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Minivac.Core;

namespace Minivac.Godot;

public partial class PopOuts : Node3D
{
    private readonly Dictionary<string, Node3D> _moving = new(StringComparer.Ordinal);
    private readonly List<BaseMaterial3D> _lampMaterials = [];
    private BaseMaterial3D? _jewelMaterial;
    private PanelLayout? _layout;

    internal IReadOnlyList<BaseMaterial3D> LampMaterials => _lampMaterials;
    internal BaseMaterial3D JewelMaterial =>
        _jewelMaterial ?? throw new InvalidOperationException("pop-outs: not initialized");

    public void Initialize(PanelLayout layout)
    {
        if (_layout is not null) throw new InvalidOperationException("pop-outs: already initialized");
        _layout = layout ?? throw new ArgumentNullException(nameof(layout));
        Name = "PopOuts";
        foreach (var item in layout.Controls)
        {
            var root = item.Kind switch
            {
                "relay-crossbar" => Relay3D.BuildCrossbar(item),
                "dial" => Knob3D.Build(item, layout),
                "pushbutton" => BuildRoundControl(
                    item,
                    TactileTheme.Pushbutton.Value - TactileTheme.LampBezel.Value * 2,
                    TactileTheme.PushbuttonCapProud.Value),
                "breaker-button" => BuildRoundControl(
                    item,
                    TactileTheme.Breaker.Value - TactileTheme.LampBezel.Value * 2,
                    TactileTheme.BreakerProud.Value.X),
                "slide-switch" => BuildSlide(item, TactileTheme.Slide.Value),
                "power-switch" => BuildSlide(item, TactileTheme.PowerSwitch.Value),
                _ => throw new InvalidOperationException("pop-outs: unsupported control " + item.Kind),
            };
            AddMoving(item.Id, root);
        }
        foreach (var item in layout.Components)
        {
            if (item.Kind == "standard-lamp") AddLamp(item);
            else if (item.Kind == "power-jewel") AddJewel(item);
        }
    }

    public void Render(State state, Controls controls)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(controls);
        var layout = _layout ?? throw new InvalidOperationException("pop-outs: not initialized");
        foreach (var item in layout.Controls)
        {
            var root = _moving[item.Id];
            if (item.Kind == "relay-crossbar")
            {
                var shift = PanelTheme.RelayCrossbarShift((int)controls.PresentedValue(item.Id)) / 100;
                root.Position = Case3D.PanelPoint(item.X + shift, item.Y, 0);
            }
            else if (item.Kind == "dial")
            {
                root.RotationDegrees = new Vector3(
                    0,
                    0,
                    (float)-PanelTheme.DialPointerDegrees(controls.PresentedValue(item.Id)));
            }
            else if (item.Kind == "pushbutton")
            {
                var travel = state.buttons[SectionIndex(item)].travel;
                root.Position = Case3D.PanelPoint(
                    item.X,
                    item.Y,
                    -TactileTheme.PushbuttonStroke.Value * travel / 1000);
            }
            else if (item.Kind == "slide-switch")
            {
                var travel = state.switches[SectionIndex(item)].travel;
                var shift = (travel / 1000.0 - 0.5) * TactileTheme.SlideThrow.Value;
                root.Position = Case3D.PanelPoint(item.X + shift, item.Y, 0);
            }
            else if (item.Kind == "power-switch")
            {
                var travel = state.power ? 1000 : 0;
                var shift = (travel / 1000.0 - 0.5) * TactileTheme.SlideThrow.Value;
                root.Position = Case3D.PanelPoint(item.X, item.Y - shift * PanelLayout.PanelAspect, 0);
            }
            else if (item.Kind == "breaker-button")
            {
                var proud = state.breakerTripped
                    ? TactileTheme.BreakerProud.Value.X
                    : TactileTheme.BreakerProud.Value.Y;
                root.Position = Case3D.PanelPoint(
                    item.X,
                    item.Y,
                    proud - TactileTheme.BreakerProud.Value.X);
            }
        }
    }

    private static Node3D BuildRoundControl(PanelControl item, double diameter, double height)
    {
        var root = MovingRoot(item.Id, item.X, item.Y);
        Case3D.AddCylinder(
            root,
            "Cap",
            new Vector3(0, 0, (float)(height / 2)),
            new Vector3((float)diameter, (float)diameter, (float)height),
            CylinderAxis.Z,
            Case3D.Material(TactileTheme.ConsoleRed.Value));
        return root;
    }

    private static Node3D BuildSlide(PanelControl item, Vector2 size)
    {
        var height = TactileTheme.SlideActuatorProud.Value;
        var root = MovingRoot(item.Id, item.X, item.Y);
        Case3D.AddPrism(
            root,
            "Actuator",
            new Vector3(0, 0, (float)(height / 2)),
            new Vector3(size.X, size.Y, (float)height),
            Case3D.Material(TactileTheme.ConsoleRed.Value));
        return root;
    }

    private void AddLamp(PanelComponent item)
    {
        var material = LensMaterial();
        var root = MovingRoot(item.Id, item.X, item.Y);
        var diameter = TactileTheme.LampLens.Value - TactileTheme.LampBezel.Value * 2;
        var height = TactileTheme.LampLensProud.Value;
        Case3D.AddCylinder(
            root,
            "Lens",
            new Vector3(0, 0, (float)(height / 2)),
            new Vector3((float)diameter, (float)diameter, (float)height),
            CylinderAxis.Z,
            material);
        _lampMaterials.Add(material);
        AddMoving(item.Id, root);
    }

    private void AddJewel(PanelComponent item)
    {
        var material = LensMaterial();
        var root = MovingRoot(item.Id, item.X, item.Y);
        var diameter = TactileTheme.Jewel.Value - TactileTheme.JewelBezel.Value * 2;
        var height = TactileTheme.LampLensProud.Value;
        Case3D.AddCylinder(
            root,
            "Lens",
            new Vector3(0, 0, (float)(height / 2)),
            new Vector3((float)diameter, (float)diameter, (float)height),
            CylinderAxis.Z,
            material);
        _jewelMaterial = material;
        AddMoving(item.Id, root);
    }

    private static StandardMaterial3D LensMaterial()
    {
        var colour = TactileTheme.ConsoleRed.Value;
        colour.A = (float)TactileTheme.LampSurface.Value.Alpha;
        var material = Case3D.Material(colour, 0, TactileTheme.LampSurface.Value.Roughness);
        material.Transparency = BaseMaterial3D.TransparencyEnum.Alpha;
        material.EmissionEnabled = true;
        material.Emission = TactileTheme.LampColour.Value;
        material.EmissionEnergyMultiplier = 0;
        return material;
    }

    private void AddMoving(string identity, Node3D root)
    {
        if (!_moving.TryAdd(identity, root))
            throw new InvalidOperationException("pop-outs: duplicate identity " + identity);
        AddChild(root);
    }

    private static Node3D MovingRoot(string identity, double x, double y)
    {
        var root = new Node3D
        {
            Name = "PopOut_" + identity,
            Position = Case3D.PanelPoint(x, y, 0),
        };
        root.SetMeta("popout_id", identity);
        return root;
    }

    private static int SectionIndex(PanelControl item) =>
        (item.Section ?? throw new InvalidOperationException("pop-outs: missing section " + item.Id)) - 1;
}
