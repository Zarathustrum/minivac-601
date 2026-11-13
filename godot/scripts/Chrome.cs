using System;
using Godot;

namespace Minivac.Godot;

public partial class Chrome : CanvasLayer
{
    private Control _root = null!;
    private Action<float, float, float, float> _layoutStage = null!;
    private Action<float> _insetStage3D = _ => { };

    public event Action? DrawerOpened;

    public Toolbar Toolbar { get; private set; } = null!;
    public Banner Banner { get; private set; } = null!;
    public Drawer Drawer { get; private set; } = null!;
    public CordList CordList { get; private set; } = null!;
    public Picker Picker { get; private set; } = null!;
    public Control DiagnosticsMount { get; private set; } = null!;
    public Control HelpMount { get; private set; } = null!;
    public DemoExperience DemoExperience { get; private set; } = null!;
    public Diagnostics Diagnostics { get; private set; } = null!;
    public HelpCredits HelpCredits { get; private set; } = null!;
    // The right-hand column's head: Cords | Chat (docs/plans/godot-chat-pane.md, "Layout").
    public Control ColumnTabs { get; private set; } = null!;
    public Button CordsTab { get; private set; } = null!;
    public Button ChatTab { get; private set; } = null!;
    public ChatDock? Chat { get; private set; }
    public bool ChatSelected { get; private set; }

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

        // After the toolbar in the tree, so Tab goes toolbar, column tabs, then the dock.
        ColumnTabs = new Control
        {
            Name = "ColumnTabs",
            MouseFilter = Control.MouseFilterEnum.Stop,
            MouseForcePassScrollEvents = false,
        };
        _root.AddChild(ColumnTabs);
        CordsTab = AddTab("CordsTab", "Cords", "Show the cord list", () => SelectColumn(chat: false));
        ChatTab = AddTab("ChatTab", "Chat", "Show the chat with a model of your own (/ from the console)", () => SelectColumn(chat: true));
        CordsTab.ButtonPressed = true;

        Banner = new Banner();
        _root.AddChild(Banner);
        Banner.Initialize();

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
        // A CanvasLayer gets no NotificationResized; its root Control does.
        _root.Resized += LayoutChrome;
    }

    /// <summary>Mounts the chat dock under the column tabs. <paramref name="insetStage3D"/> gets the 3D framing's right inset.</summary>
    public void AttachChat(ChatDock dock, Action<float> insetStage3D)
    {
        Chat = dock ?? throw new ArgumentNullException(nameof(dock));
        _insetStage3D = insetStage3D ?? throw new ArgumentNullException(nameof(insetStage3D));
        _root.AddChild(dock);
        _root.MoveChild(dock, ColumnTabs.GetIndex() + 1);
        dock.BindSelect(() => SelectColumn(chat: true));
        dock.LiveChanged += live => ChatTab.Text = live ? "Chat ●" : "Chat";
        SelectColumn(ChatSelected, focus: false);
    }

    /// <summary>Selects the column's tab; selecting Chat focuses the dock.</summary>
    public void SelectColumn(bool chat, bool focus = true)
    {
        ChatSelected = chat && Chat is not null;
        if (ChatSelected && Picker.IsOpen) Picker.Close();
        CordsTab.ButtonPressed = !ChatSelected;
        ChatTab.ButtonPressed = ChatSelected;
        CordList.Visible = !ChatSelected;
        if (Chat is not null) Chat.Visible = ChatSelected;
        LayoutChrome();
        if (ChatSelected && focus) Chat!.FocusInput();
    }

    private Button AddTab(string name, string text, string tooltip, Action pressed)
    {
        var tab = new Button
        {
            Name = name,
            Text = text,
            TooltipText = tooltip,
            ToggleMode = true,
            FocusMode = Control.FocusModeEnum.All,
        };
        // A toggle button flips itself on press; the selection, not the click, decides its state.
        tab.Pressed += pressed;
        ColumnTabs.AddChild(tab);
        return tab;
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

    /// <summary>
    /// The chrome's half of the lock: the picker and drawer close, Library, Blank panel, Reset and
    /// Profile grey out, and the banner shows. Camera, Sound and Help stay live.
    /// </summary>
    public void SetLocked(bool locked)
    {
        if (locked)
        {
            if (Picker.IsOpen) Picker.Close();
            if (Drawer.Visible) Drawer.Close();
        }
        Toolbar.SetLocked(locked);
        Banner.Visible = locked;
        LayoutChrome();
    }

    private void LayoutChrome()
    {
        if (_root is null) return;
        // The banner spans the stage under the toolbar; the flat stage moves down below it, and in 3D
        // (which fills the window) it overlays the view as the cord list does.
        // The column is 248 px for Cords and 360 px for Chat; the flat stage's right inset follows it,
        // and in 3D (which fills the window) the camera frames the console left of the dock.
        var columnWidth = ChatSelected ? ChatDock.ColumnWidth : 248;
        var stageTop = Banner.Visible ? 56 + Banner.BannerHeight + 8 : 56;
        _layoutStage(12, stageTop, -(columnWidth + 24), -12);
        _insetStage3D(ChatSelected ? columnWidth + 24 : 0);
        Toolbar.Position = new(12, 12);
        Toolbar.Size = new(1120, 36);
        Banner.Position = new(12, 56);
        Banner.Size = new(Math.Max(0, _root.Size.X - columnWidth - 36), Banner.BannerHeight);

        var right = Math.Max(0, _root.Size.X - 260);
        var column = Math.Max(0, _root.Size.X - columnWidth - 12);
        ColumnTabs.Position = new(column, 56);
        ColumnTabs.Size = new(columnWidth, 36);
        CordsTab.Position = Vector2.Zero;
        CordsTab.Size = new(columnWidth / 2 - 4, 36);
        ChatTab.Position = new(columnWidth / 2 + 4, 0);
        ChatTab.Size = new(columnWidth / 2 - 4, 36);
        CordList.Position = new(right, 100);
        CordList.Size = new(248, Math.Max(100, _root.Size.Y - 112));
        if (Chat is not null)
        {
            Chat.Position = new(column, 100);
            Chat.Size = new(columnWidth, Math.Max(100, _root.Size.Y - 112));
        }
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
