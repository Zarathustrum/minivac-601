using System;
using Godot;

namespace Minivac.Godot;

public partial class Chrome : CanvasLayer
{
    private Control _root = null!;
    private Action<float, float, float, float> _layoutStage = null!;

    public event Action? DrawerOpened;

    public Toolbar Toolbar { get; private set; } = null!;
    public Drawer Drawer { get; private set; } = null!;
    public CordList CordList { get; private set; } = null!;
    public Picker Picker { get; private set; } = null!;
    public Control DiagnosticsMount { get; private set; } = null!;
    public Control HelpMount { get; private set; } = null!;
    public DemoExperience DemoExperience { get; private set; } = null!;
    public Diagnostics Diagnostics { get; private set; } = null!;
    public HelpCredits HelpCredits { get; private set; } = null!;

    public void Initialize(
        Action<float, float, float, float> layoutStage,
        Action fit,
        Action wire,
        Action zoomOut,
        Action zoomIn,
        Action panLeft,
        Action panRight,
        Action panUp,
        Action panDown,
        PanelLayout layout,
        Cords cords,
        TraceView trace,
        DemoLibrary library,
        Preferences preferences,
        byte[] publicAssets,
        Action<string> loadDemo,
        Action loadManual,
        Action reset,
        Action<string> switchProfile,
        Func<bool> toggleSound,
        Action<string> changeViewMode)
    {
        ArgumentNullException.ThrowIfNull(layoutStage);
        ArgumentNullException.ThrowIfNull(fit);
        ArgumentNullException.ThrowIfNull(wire);
        ArgumentNullException.ThrowIfNull(zoomOut);
        ArgumentNullException.ThrowIfNull(zoomIn);
        ArgumentNullException.ThrowIfNull(panLeft);
        ArgumentNullException.ThrowIfNull(panRight);
        ArgumentNullException.ThrowIfNull(panUp);
        ArgumentNullException.ThrowIfNull(panDown);
        ArgumentNullException.ThrowIfNull(layout);
        ArgumentNullException.ThrowIfNull(cords);
        ArgumentNullException.ThrowIfNull(trace);
        ArgumentNullException.ThrowIfNull(library);
        ArgumentNullException.ThrowIfNull(preferences);
        ArgumentNullException.ThrowIfNull(publicAssets);
        ArgumentNullException.ThrowIfNull(loadDemo);
        ArgumentNullException.ThrowIfNull(loadManual);
        ArgumentNullException.ThrowIfNull(reset);
        ArgumentNullException.ThrowIfNull(switchProfile);
        ArgumentNullException.ThrowIfNull(toggleSound);
        ArgumentNullException.ThrowIfNull(changeViewMode);
        Name = "Chrome";
        _layoutStage = layoutStage;

        _root = new Control { Name = "ChromeRoot", MouseFilter = Control.MouseFilterEnum.Ignore };
        AddChild(_root);
        _root.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);

        Toolbar = new Toolbar();
        _root.AddChild(Toolbar);

        Drawer = new Drawer();
        _root.AddChild(Drawer);
        Drawer.Initialize();
        Drawer.Closed += () => DiagnosticsMount.Visible = false;

        DemoExperience = new DemoExperience();
        Drawer.AddChild(DemoExperience);
        DemoExperience.Initialize(
            library.Demos,
            library.Demos[0].Id,
            DemoExperience.ReferenceProfileId,
            false,
            loadDemo,
            loadManual,
            reset,
            switchProfile,
            Drawer.Close);

        Picker = new Picker();
        Picker.Initialize(layout, cords);

        CordList = new CordList();
        _root.AddChild(CordList);
        CordList.Initialize(cords, Picker);

        _root.AddChild(Picker);

        DiagnosticsMount = new Control
        {
            Name = "DiagnosticsMount",
            MouseFilter = Control.MouseFilterEnum.Stop,
            Visible = false,
        };
        _root.AddChild(DiagnosticsMount);
        Diagnostics = new Diagnostics();
        DiagnosticsMount.AddChild(Diagnostics);
        Diagnostics.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
        Diagnostics.Initialize(layout, trace);
        Drawer.ConfigureDiagnosticsPaging(
            () => Diagnostics.PageTerminals(-1),
            () => Diagnostics.PageTerminals(1),
            () => Diagnostics.ScrollNotes(-1),
            () => Diagnostics.ScrollNotes(1));

        HelpMount = new Control
        {
            Name = "HelpMount",
            MouseFilter = Control.MouseFilterEnum.Ignore,
            Visible = true,
        };
        _root.AddChild(HelpMount);

        HelpCredits = new HelpCredits();
        HelpCredits.Initialize(publicAssets, preferences, changeViewMode, () => Toolbar.Help.GrabFocus());
        HelpMount.AddChild(HelpCredits);

        Toolbar.Initialize(
            fit,
            wire,
            zoomOut,
            zoomIn,
            panLeft,
            panRight,
            panUp,
            panDown,
            () => OpenDrawer(Toolbar.Library),
            loadManual,
            reset,
            () => OpenDrawer(Toolbar.Profile),
            toggleSound,
            HelpCredits.Open,
            preferences.AudioMuted);
        LayoutChrome();
    }

    private void OpenDrawer(Control returnFocus)
    {
        DiagnosticsMount.Visible = true;
        Drawer.Open(returnFocus);
        DrawerOpened?.Invoke();
    }

    public override void _Notification(int what)
    {
        if (what == NotificationReady || what == Control.NotificationResized) LayoutChrome();
    }

    public void Relayout() => LayoutChrome();

    private void LayoutChrome()
    {
        if (_root is null) return;
        _layoutStage(12, 56, -272, -12);
        Toolbar.Position = new(12, 12);
        Toolbar.Size = new(1120, 36);

        var right = Math.Max(0, _root.Size.X - 260);
        CordList.Position = new(right, 56);
        CordList.Size = new(248, Math.Max(100, _root.Size.Y - 68));
        Picker.Position = new(Math.Max(0, right - 300), 56);
        Picker.Size = new(288, Math.Max(100, _root.Size.Y - 68));

        var drawerWidth = Math.Clamp(_root.Size.X * 0.60f, 520, 740);
        Drawer.Position = new(12, 56);
        Drawer.Size = new(drawerWidth, Math.Max(100, _root.Size.Y - 68));
        DemoExperience.Position = new(0, 40);
        DemoExperience.Size = new(Drawer.Size.X, Math.Max(100, Drawer.Size.Y - 40));
        var diagnosticsX = Drawer.Position.X + Drawer.Size.X + 12;
        DiagnosticsMount.Position = new(diagnosticsX, 56);
        DiagnosticsMount.Size = new(Math.Max(240, _root.Size.X - diagnosticsX - 12), Math.Max(208, _root.Size.Y - 68));
        HelpMount.Position = new(324, 56);
        HelpMount.Size = new(480, Math.Max(100, _root.Size.Y - 68));
    }
}
