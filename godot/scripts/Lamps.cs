using System;
using System.Collections.Generic;
using Godot;
using Minivac.Core;

namespace Minivac.Godot;

public partial class Lamps : Control
{
    private sealed partial class Lens : Control
    {
        private double _level;

        internal void Render(string label, State.Lamp lamp)
        {
            _level = Math.Clamp(lamp.milli / 1000.0, 0, 1);
            TooltipText = lamp.cls + " · " + lamp.ua + " µA · " + lamp.milli + " milli";
            SetMeta("accessible_description", label + ": " + TooltipText);
            QueueRedraw();
        }

        internal void RenderJewel(bool lit)
        {
            _level = lit ? 1 : 0;
            SetMeta("accessible_description", "Power: " + (lit ? "on" : "off"));
            QueueRedraw();
        }

        public override void _Draw()
        {
            var radius = Math.Min(Size.X, Size.Y) / 2;
            DrawCircle(Size / 2, radius, PanelTheme.ConsoleCream);
            DrawCircle(Size / 2, radius * 0.72f, PanelTheme.ConsoleRed);
            if (_level > 0)
            {
                var lit = PanelTheme.ConsoleRedLit;
                lit.A = (float)_level;
                DrawCircle(Size / 2, radius * 0.68f, lit);
            }
        }
    }

    private readonly List<(Lens View, PanelComponent Item)> _outputs = [];
    private readonly List<(Lens View, PanelComponent Item)> _relays = [];
    private (Lens View, PanelComponent Item)? _jewel;

    public int LensCount => _outputs.Count + _relays.Count;
    public double[] Levels { get; } = new double[12];
    public bool JewelLit { get; private set; }

    public void Initialize(PanelLayout layout)
    {
        Name = "Lamps";
        MouseFilter = MouseFilterEnum.Ignore;
        foreach (var item in layout.Components)
        {
            if (item.Kind != "standard-lamp" && item.Kind != "power-jewel") continue;
            var node = new Lens { Name = "Lens_" + item.Id, MouseFilter = MouseFilterEnum.Ignore };
            node.SetMeta("component_id", item.Id);
            AddChild(node);
            if (item.Id.StartsWith("out-lamp-", StringComparison.Ordinal)) _outputs.Add((node, item));
            else if (item.Id.StartsWith("relay-lamp-", StringComparison.Ordinal)) _relays.Add((node, item));
            else _jewel = (node, item);
        }
        ApplyLayout();
    }

    public void Render(State state)
    {
        for (var index = 0; index < 6; index++)
        {
            Levels[index] = state.outLamps[index].milli / 1000.0;
            Levels[index + 6] = state.indLamps[index].milli / 1000.0;
            _outputs[index].View.Render("Output lamp " + (index + 1), state.outLamps[index]);
            _relays[index].View.Render("Relay lamp " + (index + 1), state.indLamps[index]);
        }
        JewelLit = state.railMv > 0;
        _jewel?.View.RenderJewel(JewelLit);
    }

    public override void _Notification(int what)
    {
        if (what == NotificationResized) ApplyLayout();
    }

    private void ApplyLayout()
    {
        if (Size.X <= 0 || Size.Y <= 0) return;
        foreach (var pair in _outputs) Place(pair.View, pair.Item, PanelTheme.LampDiameter);
        foreach (var pair in _relays) Place(pair.View, pair.Item, PanelTheme.LampDiameter);
        if (_jewel is { } jewel) Place(jewel.View, jewel.Item, PanelTheme.PowerJewelDiameter);
    }

    private void Place(Control node, PanelComponent item, double diameter)
    {
        var extent = (float)(Size.X * diameter);
        node.Size = new Vector2(extent, extent);
        node.Position = new Vector2((float)(Size.X * item.X - extent / 2), (float)(Size.Y * item.Y - extent / 2));
    }
}
