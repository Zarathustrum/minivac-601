using System;
using System.Collections.Generic;
using Godot;
using Minivac.Core;

namespace Minivac.Godot;

public partial class Controls : Control
{
    private static readonly (string Identity, string BaseName)[] BaseNameRows =
    [
        ("button1", "Pushbutton 1"),
        ("button2", "Pushbutton 2"),
        ("button3", "Pushbutton 3"),
        ("button4", "Pushbutton 4"),
        ("button5", "Pushbutton 5"),
        ("button6", "Pushbutton 6"),
        ("switch1", "Slide switch 1"),
        ("switch2", "Slide switch 2"),
        ("switch3", "Slide switch 3"),
        ("switch4", "Slide switch 4"),
        ("switch5", "Slide switch 5"),
        ("switch6", "Slide switch 6"),
        ("relay1", "Relay 1 crossbar"),
        ("relay2", "Relay 2 crossbar"),
        ("relay3", "Relay 3 crossbar"),
        ("relay4", "Relay 4 crossbar"),
        ("relay5", "Relay 5 crossbar"),
        ("relay6", "Relay 6 crossbar"),
        ("dial", "Decimal dial angle"),
        ("power", "Power"),
        ("breaker", "Circuit breaker reset"),
    ];

    public static IReadOnlyList<(string Identity, string BaseName)> ControlBaseNames { get; } =
        Array.AsReadOnly(BaseNameRows);

    private sealed partial class PanelButton : Button
    {
        private bool _lit;

        internal string Kind = "";
        internal Action? KeyboardActivate;
        internal bool Lit
        {
            get => _lit;
            set
            {
                if (_lit == value) return;
                _lit = value;
                QueueRedraw();
            }
        }

        public override void _Draw()
        {
            var active = Lit || ButtonPressed || IsPressed();
            if (Kind is "pushbutton" or "breaker-button")
            {
                var radius = Math.Min(Size.X, Size.Y) / 2;
                DrawCircle(Size / 2, radius, HasFocus() ? PanelTheme.FocusBlue : PanelTheme.ConsoleCream);
                DrawCircle(Size / 2, radius * 0.78f, active ? PanelTheme.ConsoleRedLit : PanelTheme.ConsoleRed);
                return;
            }
            var points = new[] { Vector2.Zero, new Vector2(Size.X, 0), Size, new Vector2(0, Size.Y) };
            DrawColoredPolygon(points, active ? PanelTheme.ConsoleRedLit : PanelTheme.ConsoleRed);
            var marker = Kind == "power-switch"
                ? new[] { new Vector2(0, Size.Y / 2), new Vector2(Size.X, Size.Y / 2) }
                : new[] { new Vector2(Size.X / 2, 0), new Vector2(Size.X / 2, Size.Y) };
            DrawLine(marker[0], marker[1], PanelTheme.ConsoleCream, 2);
            if (!HasFocus()) return;
            DrawLine(Vector2.Zero, new Vector2(Size.X, 0), PanelTheme.FocusBlue, 2);
            DrawLine(new Vector2(Size.X, 0), Size, PanelTheme.FocusBlue, 2);
            DrawLine(Size, new Vector2(0, Size.Y), PanelTheme.FocusBlue, 2);
            DrawLine(new Vector2(0, Size.Y), Vector2.Zero, PanelTheme.FocusBlue, 2);
        }

        public override void _GuiInput(InputEvent input)
        {
            if (KeyboardActivate is not null && input is InputEventKey key && !key.Echo &&
                key.AsText() is ("Space" or "Enter" or "Kp Enter"))
            {
                if (key.Pressed) KeyboardActivate();
                AcceptEvent();
                return;
            }
            base._GuiInput(input);
        }
    }

    private sealed partial class RangeControl : Control
    {
        private long _value;

        internal long Value
        {
            get => _value;
            set
            {
                if (_value == value) return;
                _value = value;
                QueueRedraw();
            }
        }

        internal long Maximum;
        internal bool Circular;

        public override void _Draw()
        {
            if (Circular)
            {
                var radius = Math.Min(Size.X, Size.Y) / 2;
                DrawCircle(Size / 2, radius, PanelTheme.ConsoleDark);
                DrawCircle(Size / 2, radius * 0.82f, PanelTheme.ConsoleCream);
                var radians = Value / 1_000_000.0 * Math.PI / 180;
                var tip = Size / 2 + new Vector2((float)Math.Sin(radians), (float)-Math.Cos(radians)) * radius * 0.7f;
                DrawLine(Size / 2, tip, PanelTheme.ConsoleRed, 2);
                DrawFocusOutline();
                return;
            }
            var y = Size.Y / 2;
            DrawLine(new Vector2(0, y), new Vector2(Size.X, y), PanelTheme.ConsoleCream, 3);
            var shift = PanelTheme.RelayCrossbarShift((int)Value) / (PanelTheme.RelayWidth * 100);
            var x = (float)(Size.X * (0.5 + shift));
            DrawLine(new Vector2(x, 0), new Vector2(x, Size.Y), PanelTheme.ConsoleRedLit, 4);
            DrawFocusOutline();
        }

        private void DrawFocusOutline()
        {
            if (!HasFocus()) return;
            var width = Math.Max(2, Size.X * (float)PanelTheme.FocusOutline);
            DrawLine(Vector2.Zero, new Vector2(Size.X, 0), PanelTheme.FocusBlue, width);
            DrawLine(new Vector2(Size.X, 0), Size, PanelTheme.FocusBlue, width);
            DrawLine(Size, new Vector2(0, Size.Y), PanelTheme.FocusBlue, width);
            DrawLine(new Vector2(0, Size.Y), Vector2.Zero, PanelTheme.FocusBlue, width);
        }
    }

    private readonly List<(Button View, PanelControl Item)> _buttons = [];
    private readonly List<(RangeControl View, PanelControl Item)> _relays = [];
    private readonly Dictionary<string, RangeControl> _presented = new(StringComparer.Ordinal);
    private readonly bool[] _pointerButtons = new bool[6];
    private readonly bool[] _keyboardButtons = new bool[6];
    // Shift-click latches: held until a click on that button or Escape, not by focus loss.
    private readonly bool[] _latchedButtons = new bool[6];
    private readonly bool[] _pointerRelays = new bool[6];
    private readonly bool[] _keyboardRelays = new bool[6];
    private Func<Command, CmdResult>? _apply;
    private Func<State>? _state;
    private RangeControl? _dial;
    private PanelControl? _dialItem;
    private bool _pointerDial;

    public IReadOnlyList<Button> Buttons => _buttons.ConvertAll(pair => pair.View).AsReadOnly();
    public IReadOnlyList<Control> Relays => _relays.ConvertAll<Control>(pair => pair.View).AsReadOnly();
    public Control Dial => _dial ?? throw new InvalidOperationException("controls: not initialized");
    public string LastStatus { get; private set; } = "";
    public event Action<Command>? Emitted;

    public void Initialize(PanelLayout layout, Func<Command, CmdResult> apply, Func<State> state)
    {
        _apply = apply ?? throw new ArgumentNullException(nameof(apply));
        _state = state ?? throw new ArgumentNullException(nameof(state));
        Name = "Controls";
        MouseFilter = MouseFilterEnum.Ignore;

        foreach (var item in layout.Controls)
        {
            if (item.Kind == "relay-crossbar") AddRelay(item);
            else if (item.Kind == "dial") AddDial(item);
            else AddButton(item);
        }
        ApplyLabels(new Dictionary<string, string>());
        ApplyLayout();
    }

    public void ApplyLabels(IReadOnlyDictionary<string, string> labels)
    {
        ArgumentNullException.ThrowIfNull(labels);
        foreach (var identity in labels.Keys) _ = BaseName(identity);
        foreach (var pair in _buttons)
        {
            SetAccessibleName(pair.View, pair.Item.Id, labels);
        }
        foreach (var pair in _relays) SetAccessibleName(pair.View, pair.Item.Id, labels);
        if (_dial is not null && _dialItem is not null) SetAccessibleName(_dial, _dialItem.Id, labels);
    }

    public string AccessibleName(string identity)
    {
        foreach (var pair in _buttons)
            if (pair.Item.Id == identity) return pair.View.AccessibilityName;
        foreach (var pair in _relays)
            if (pair.Item.Id == identity) return pair.View.AccessibilityName;
        if (_dialItem?.Id == identity && _dial is not null) return _dial.AccessibilityName;
        throw new InvalidOperationException("control labels: missing identity " + identity);
    }

    internal long PresentedValue(string identity)
    {
        if (_presented.TryGetValue(identity, out var view)) return view.Value;
        throw new InvalidOperationException("controls: no presented range " + identity);
    }

    public void Render(State state)
    {
        foreach (var pair in _buttons)
        {
            if (pair.Item.Kind == "breaker-button") pair.View.Disabled = !state.breakerTripped;
            if (pair.Item.Kind == "power-switch") pair.View.ButtonPressed = state.power;
            if (pair.View is PanelButton styled)
            {
                if (pair.Item.Kind == "breaker-button") styled.Lit = state.breakerTripped;
                else if (pair.Item.Kind == "pushbutton" && pair.Item.Section is { } buttonSection)
                    styled.Lit = state.buttons[buttonSection - 1].travel >= 500;
                else if (pair.Item.Kind == "slide-switch" && pair.Item.Section is { } switchSection)
                    styled.Lit = state.switches[switchSection - 1].travel >= 500;
                else if (pair.Item.Kind == "power-switch") styled.Lit = state.power;
            }
            var section = pair.Item.Section;
            if (section is null || pair.Item.Kind == "pushbutton" && ButtonHeld(section.Value - 1))
                continue;
            if (pair.Item.Kind == "slide-switch") pair.View.ButtonPressed = state.switches[section.Value - 1].travel >= 500;
        }
        for (var index = 0; index < _relays.Count; index++)
            if (!_pointerRelays[index] && !_keyboardRelays[index]) _relays[index].View.Value = state.relays[index].travel;
        if (_dial is not null && !_pointerDial) _dial.Value = state.dial.udeg;
    }

    public void PointerButton(int section, bool pressed) => SetButtonHold(_pointerButtons, section, pressed);

    public void KeyboardButton(int section, bool pressed) => SetButtonHold(_keyboardButtons, section, pressed);

    public void ToggleLatch(int section) => SetButtonHold(_latchedButtons, section, !_latchedButtons[section - 1]);

    public void ReleaseLatches()
    {
        for (var section = 1; section <= 6; section++) SetButtonHold(_latchedButtons, section, false);
    }

    private bool ButtonHeld(int index) => _pointerButtons[index] || _keyboardButtons[index] || _latchedButtons[index];

    // Pointer, keyboard and latch share one pushbutton: only a change in the combined hold issues a command.
    private void SetButtonHold(bool[] holds, int section, bool pressed)
    {
        var index = section - 1;
        if (holds[index] == pressed) return;
        var wasHeld = ButtonHeld(index);
        holds[index] = pressed;
        SetPushLit(index);
        if (ButtonHeld(index) != wasHeld) Apply(Commands.Pushbutton(section, !wasHeld));
    }

    public void PointerRelayPress(int section, int target)
    {
        _pointerRelays[section - 1] = true;
        _relays[section - 1].View.Value = target;
        Apply(Commands.RelayGrab(section, target));
    }

    public void PointerRelayMove(int section, int target)
    {
        if (_pointerRelays[section - 1])
        {
            _relays[section - 1].View.Value = target;
            Apply(Commands.RelayGrab(section, target));
        }
    }

    public void PointerRelayRelease(int section)
    {
        var index = section - 1;
        if (!_pointerRelays[index]) return;
        _pointerRelays[index] = false;
        if (!_keyboardRelays[index]) Apply(Commands.RelayRelease(section));
    }

    public void KeyboardRelayStep(int section, Commands.KeyStep step)
    {
        var index = section - 1;
        _keyboardRelays[index] = true;
        if (_pointerRelays[index]) return;
        var current = (int)_relays[index].View.Value;
        var target = (int)Commands.KeyboardTarget(current, 1000, step);
        foreach (var command in Commands.RelayKeyboardStep(section, current, target)) Apply(command);
        _relays[index].View.Value = target;
    }

    public void KeyboardRelayRelease(int section)
    {
        var index = section - 1;
        if (!_keyboardRelays[index]) return;
        _keyboardRelays[index] = false;
        if (!_pointerRelays[index]) Apply(Commands.RelayRelease(section));
    }

    public void PointerDial(Vector2 fromCentre, bool pressed)
    {
        if (!pressed && !_pointerDial) return;
        _pointerDial = pressed;
        if (pressed) ApplyPointerDialTarget(fromCentre);
        else Apply(Commands.DialRelease());
    }

    public void PointerDialMove(Vector2 fromCentre)
    {
        if (_pointerDial) ApplyPointerDialTarget(fromCentre);
    }

    private void ApplyPointerDialTarget(Vector2 fromCentre)
    {
        var command = Commands.DialGrab(fromCentre.X, fromCentre.Y);
        (_dial ?? throw new InvalidOperationException("controls: dial is not initialized")).Value =
            ((Command.DialGrab)command).targetUdeg;
        Apply(command);
    }

    public void KeyboardDialStep(Commands.KeyStep step)
    {
        if (_pointerDial || _dial is null) return;
        var target = Commands.KeyboardTarget((long)_dial.Value, 359_999_999, step);
        foreach (var command in Commands.DialKeyboardStep(target)) Apply(command);
        _dial.Value = target;
    }

    public void ReleaseAll()
    {
        for (var section = 1; section <= 6; section++)
        {
            SetButtonHold(_pointerButtons, section, false);
            SetButtonHold(_keyboardButtons, section, false);
            if (_pointerRelays[section - 1] || _keyboardRelays[section - 1])
            {
                _pointerRelays[section - 1] = false;
                _keyboardRelays[section - 1] = false;
                Apply(Commands.RelayRelease(section));
            }
        }
        if (_pointerDial)
        {
            _pointerDial = false;
            Apply(Commands.DialRelease());
        }
    }

    public override void _GuiInput(InputEvent input)
    {
        if (input is InputEventKey key && key.Pressed && !key.Echo && key.AsText() == "Escape")
            ReleaseAllAndFocus();
    }

    public override void _Notification(int what)
    {
        if (what == NotificationResized) ApplyLayout();
        else if (what == NotificationWMWindowFocusOut || what == NotificationApplicationFocusOut) ReleaseAll();
    }

    private void AddButton(PanelControl item)
    {
        var node = new PanelButton
        {
            Name = "Control_" + item.Id,
            Text = item.Kind switch { "power-switch" => "POWER", "breaker-button" => "RESET", _ => item.Section?.ToString() ?? item.Id },
            FocusMode = FocusModeEnum.All,
            ToggleMode = item.Kind is "slide-switch" or "power-switch",
            Flat = true,
            Kind = item.Kind,
        };
        node.AddThemeColorOverride("font_color", PanelTheme.ConsoleCream);
        node.FocusEntered += node.QueueRedraw;
        node.FocusExited += node.QueueRedraw;
        node.SetMeta("control_id", item.Id);
        if (item.Section is { } section) node.SetMeta("section", section);
        AddChild(node);
        _buttons.Add((node, item));
        if (item.Kind == "pushbutton" && item.Section is { } pushSection)
        {
            node.FocusExited += () => KeyboardButton(pushSection, false);
            node.GuiInput += input => HandleButtonInput(pushSection, input);
        }
        else if (item.Kind == "slide-switch" && item.Section is { } switchSection)
        {
            void Activate() => Apply(Commands.Switch(switchSection, _state!().switches[switchSection - 1].travel));
            node.Pressed += Activate;
            node.KeyboardActivate = Activate;
        }
        else if (item.Kind == "power-switch")
        {
            void Activate() => Apply(Commands.Power(_state!().power));
            node.Pressed += Activate;
            node.KeyboardActivate = Activate;
        }
        else if (item.Kind == "breaker-button")
        {
            void Activate() => Apply(Commands.Breaker());
            node.Pressed += Activate;
            node.KeyboardActivate = Activate;
        }
    }

    private void AddRelay(PanelControl item)
    {
        var section = item.Section ?? throw new InvalidOperationException("controls: relay has no section");
        var node = new RangeControl { Name = "Control_" + item.Id, Maximum = 1000, FocusMode = FocusModeEnum.All };
        node.SetMeta("control_id", item.Id);
        RegisterPresented(node);
        node.SetMeta("section", section);
        node.GuiInput += input => HandleRelayInput(section, node, input);
        node.FocusExited += () => KeyboardRelayRelease(section);
        AddChild(node);
        _relays.Add((node, item));
    }

    private void AddDial(PanelControl item)
    {
        _dialItem = item;
        _dial = new RangeControl
        {
            Name = "Control_dial",
            Maximum = 359_999_999,
            Circular = true,
            FocusMode = FocusModeEnum.All,
        };
        _dial.SetMeta("control_id", item.Id);
        RegisterPresented(_dial);
        _dial.GuiInput += HandleDialInput;
        _dial.FocusExited += ReleaseDial;
        AddChild(_dial);
    }

    private void RegisterPresented(RangeControl view)
    {
        var identity = view.GetMeta("control_id").AsString();
        if (string.IsNullOrEmpty(identity) || !_presented.TryAdd(identity, view))
            throw new InvalidOperationException("controls: duplicate presented identity " + identity);
    }

    private static void SetAccessibleName(
        Control control,
        string identity,
        IReadOnlyDictionary<string, string> labels)
    {
        var baseName = BaseName(identity);
        var composed = labels.TryGetValue(identity, out var label) ? baseName + ": " + label : baseName;
        control.AccessibilityName = composed;
        control.TooltipText = composed;
        control.SetMeta("base_label", baseName);
        if (label is null) control.RemoveMeta("demo_label");
        else control.SetMeta("demo_label", label);
    }

    private static string BaseName(string identity)
    {
        foreach (var pair in BaseNameRows)
            if (pair.Identity == identity) return pair.BaseName;
        throw new InvalidOperationException("control labels: unknown identity " + identity);
    }

    private void HandleButtonInput(int section, InputEvent input)
    {
        if (input.IsActionPressed("ui_cancel"))
        {
            ReleaseAllAndFocus();
            AcceptEvent();
        }
        else if (input is InputEventMouseButton mouse && (int)mouse.ButtonIndex == 1)
        {
            // A latch toggle never sets the pointer hold, so its release is a no-op.
            if (mouse.Pressed && (mouse.ShiftPressed || _latchedButtons[section - 1])) ToggleLatch(section);
            else PointerButton(section, mouse.Pressed);
            AcceptEvent();
        }
        else if (input is InputEventKey key && !key.Echo && key.AsText() is ("Space" or "Enter" or "Kp Enter"))
        {
            KeyboardButton(section, key.Pressed);
            AcceptEvent();
        }
        else if (input is InputEventKey shifted && !shifted.Echo &&
                 shifted.AsText() is ("Shift+Space" or "Shift+Enter" or "Shift+Kp Enter"))
        {
            if (shifted.Pressed) ToggleLatch(section);
            else KeyboardButton(section, false);
            AcceptEvent();
        }
    }

    private void HandleRelayInput(int section, RangeControl node, InputEvent input)
    {
        if (input.IsActionPressed("ui_cancel"))
        {
            ReleaseAllAndFocus();
            AcceptEvent();
        }
        else if (input is InputEventMouseButton mouse && (int)mouse.ButtonIndex == 1)
        {
            if (mouse.Pressed) PointerRelayPress(section, RangeTarget(mouse.Position.X, node.Size.X, node.Maximum));
            else PointerRelayRelease(section);
            AcceptEvent();
        }
        else if (input is InputEventMouseMotion motion && _pointerRelays[section - 1])
        {
            PointerRelayMove(section, RangeTarget(motion.Position.X, node.Size.X, node.Maximum));
            AcceptEvent();
        }
        else if (input is InputEventKey key && !key.Echo)
        {
            if (KeyStep(key.AsText()) is not { } step) return;
            if (!key.Pressed && _keyboardRelays[section - 1]) KeyboardRelayRelease(section);
            else if (key.Pressed) KeyboardRelayStep(section, step);
            AcceptEvent();
        }
    }

    private void HandleDialInput(InputEvent input)
    {
        if (_dial is null) return;
        if (input.IsActionPressed("ui_cancel"))
        {
            ReleaseAllAndFocus();
            AcceptEvent();
        }
        else if (input is InputEventMouseButton mouse && (int)mouse.ButtonIndex == 1)
        {
            PointerDial(mouse.Position - _dial.Size / 2, mouse.Pressed);
            AcceptEvent();
        }
        else if (input is InputEventMouseMotion motion) PointerDialMove(motion.Position - _dial.Size / 2);
        else if (input is InputEventKey key && key.Pressed && !key.Echo && KeyStep(key.AsText()) is { } step)
        {
            KeyboardDialStep(step);
            AcceptEvent();
        }
    }

    private void ReleaseDial()
    {
        if (!_pointerDial) return;
        _pointerDial = false;
        Apply(Commands.DialRelease());
    }

    private void ReleaseAllAndFocus()
    {
        ReleaseLatches();
        ReleaseAll();
        GetViewport().GuiGetFocusOwner()?.ReleaseFocus();
    }

    private void SetPushLit(int index)
    {
        foreach (var pair in _buttons)
        {
            if (pair.Item.Kind != "pushbutton" || pair.Item.Section != index + 1 || pair.View is not PanelButton button) continue;
            button.Lit = ButtonHeld(index);
            return;
        }
    }

    private static Commands.KeyStep? KeyStep(string key) => key.ToLowerInvariant() switch
    {
        "down" or "left" => Commands.KeyStep.ArrowDown,
        "up" or "right" => Commands.KeyStep.ArrowUp,
        "pagedown" => Commands.KeyStep.PageDown,
        "pageup" => Commands.KeyStep.PageUp,
        "home" => Commands.KeyStep.Home,
        "end" => Commands.KeyStep.End,
        _ => null,
    };

    private static int RangeTarget(float x, float width, long maximum)
    {
        if (width <= 0) return 0;
        var fraction = Math.Clamp(x / width, 0, 1);
        return (int)Math.Floor(fraction * maximum + 0.5);
    }

    private void Apply(Command command)
    {
        Emitted?.Invoke(command);
        var result = _apply!(command);
        LastStatus = result is CmdResult.Failure failure ? "Rejected: " + failure.why : "Accepted: " + command.k;
    }

    private void ApplyLayout()
    {
        if (Size.X <= 0 || Size.Y <= 0) return;
        foreach (var pair in _buttons)
        {
            var fraction = pair.Item.Kind switch
            {
                "pushbutton" => PanelTheme.PushbuttonDiameter,
                "breaker-button" => PanelTheme.BreakerDiameter,
                "power-switch" => PanelTheme.PowerSwitchSize.X,
                _ => PanelTheme.SlideSize.X,
            };
            var width = (float)(Size.X * fraction);
            var height = pair.Item.Kind switch
            {
                "power-switch" => (float)(Size.X * PanelTheme.PowerSwitchSize.Y),
                "slide-switch" => (float)(Size.X * PanelTheme.SlideSize.Y),
                _ => width,
            };
            pair.View.Size = new Vector2(width, height);
            pair.View.Position = new Vector2((float)(Size.X * pair.Item.X - width / 2), (float)(Size.Y * pair.Item.Y - height / 2));
        }
        foreach (var pair in _relays)
        {
            var width = (float)(Size.X * PanelTheme.RelayWidth);
            var height = (float)(Size.X * PanelTheme.RelayHeight);
            pair.View.Size = new Vector2(width, height);
            pair.View.Position = new Vector2((float)(Size.X * pair.Item.X - width / 2), (float)(Size.Y * pair.Item.Y - height / 2));
        }
        if (_dial is not null && _dialItem is not null)
        {
            var diameter = (float)(Size.X * PanelTheme.DialDiameter);
            _dial.Size = new Vector2(diameter, diameter);
            _dial.Position = new Vector2(
                (float)(Size.X * _dialItem.X - diameter / 2),
                (float)(Size.Y * _dialItem.Y - diameter / 2));
        }
    }
}
