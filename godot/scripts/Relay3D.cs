using Godot;

namespace Minivac.Godot;

internal static class Relay3D
{
    internal static void BuildFixed(Node3D parent, PanelComponent item)
    {
        var form = TactileTheme.RelayForm.Value;
        var relaySize = TactileTheme.RelayBody.Value;
        var root = new Node3D
        {
            Name = "RelayFixed_" + item.Id,
            Position = Case3D.PanelPoint(item.X, item.Y, 0),
        };
        parent.AddChild(root);

        var bobbinMaterial = Case3D.Material(TactileTheme.BobbinWhite.Value);
        var bobbinCenterX = -relaySize.X / 2 + form.BobbinSizeW.X / 2;
        Case3D.AddCylinder(
            root,
            "Bobbin",
            new Vector3((float)bobbinCenterX, 0, (float)(form.FixedProudW / 2)),
            new Vector3(form.BobbinSizeW.X, form.BobbinSizeW.Y, (float)form.FixedProudW),
            CylinderAxis.X,
            bobbinMaterial);

        var springMaterial = Case3D.Material(
            TactileTheme.SpringCopper.Value,
            form.SpringMetallic,
            form.SpringRoughness);
        var stackCenterX = relaySize.X / 2 - form.ContactStackSizeW.X / 2;
        AddContactStack(root, "Upper", (float)stackCenterX, -form.ContactStackOffsetW, form, springMaterial);
        AddContactStack(root, "Lower", (float)stackCenterX, form.ContactStackOffsetW, form, springMaterial);
    }

    internal static Node3D BuildCrossbar(PanelControl item)
    {
        var form = TactileTheme.RelayForm.Value;
        var proud = TactileTheme.CrossbarProud.Value;
        var root = new Node3D
        {
            Name = "PopOut_" + item.Id,
            Position = Case3D.PanelPoint(item.X, item.Y, 0),
        };
        root.SetMeta("popout_id", item.Id);

        var material = Case3D.Material(TactileTheme.BobbinWhite.Value);
        var backDepth = proud - form.CrossbarSlotDepthW;
        Case3D.AddPrism(
            root,
            "CrossbarBack",
            new Vector3(0, 0, (float)(backDepth / 2)),
            new Vector3(form.CrossbarSizeW.X, form.CrossbarSizeW.Y, (float)backDepth),
            material);

        var frontCenterZ = backDepth + form.CrossbarSlotDepthW / 2;
        var sideWidth = (form.CrossbarSizeW.X - form.CrossbarSlotSizeW.X) / 2;
        var sideCenterX = form.CrossbarSlotSizeW.X / 2 + sideWidth / 2;
        var capHeight = (form.CrossbarSizeW.Y - form.CrossbarSlotSizeW.Y) / 2;
        var capCenterY = form.CrossbarSlotSizeW.Y / 2 + capHeight / 2;
        AddCrossbarFront(
            root,
            "CrossbarLeft",
            new Vector3(-sideCenterX, 0, (float)frontCenterZ),
            new Vector3(sideWidth, form.CrossbarSizeW.Y, (float)form.CrossbarSlotDepthW),
            material);
        AddCrossbarFront(
            root,
            "CrossbarRight",
            new Vector3(sideCenterX, 0, (float)frontCenterZ),
            new Vector3(sideWidth, form.CrossbarSizeW.Y, (float)form.CrossbarSlotDepthW),
            material);
        AddCrossbarFront(
            root,
            "CrossbarTop",
            new Vector3(0, -capCenterY, (float)frontCenterZ),
            new Vector3(form.CrossbarSlotSizeW.X, capHeight, (float)form.CrossbarSlotDepthW),
            material);
        AddCrossbarFront(
            root,
            "CrossbarBottom",
            new Vector3(0, capCenterY, (float)frontCenterZ),
            new Vector3(form.CrossbarSlotSizeW.X, capHeight, (float)form.CrossbarSlotDepthW),
            material);
        return root;
    }

    private static void AddContactStack(
        Node3D parent,
        string name,
        float centerX,
        double centerY,
        RelayFormValue form,
        BaseMaterial3D material)
    {
        var pitch = form.ContactStackSizeW.Y / form.SpringsPerStack;
        var stripHeight = pitch * (float)form.SpringFillRatio;
        for (var index = 0; index < form.SpringsPerStack; index++)
        {
            var y = centerY - form.ContactStackSizeW.Y / 2 + pitch * (index + 0.5f);
            Case3D.AddPrism(
                parent,
                name + "Spring" + index,
                new Vector3(centerX, (float)y, (float)(form.FixedProudW / 2)),
                new Vector3(form.ContactStackSizeW.X, stripHeight, (float)form.FixedProudW),
                material);
        }
    }

    private static void AddCrossbarFront(
        Node3D parent,
        string name,
        Vector3 center,
        Vector3 size,
        BaseMaterial3D material) =>
        Case3D.AddPrism(parent, name, center, size, material);
}
