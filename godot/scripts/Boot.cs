using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Minivac.Conformance;
using Minivac.Core;
using Minivac.Hands;

namespace Minivac.Godot;

public partial class Boot : Node
{
    private const string PinnedNetlistHash = "2354ceebf3f8c566";
    private Session? _session;
    private Controls? _controls;
    private Cords? _cords;
    private Lamps? _lamps;
    private Chrome? _chrome;
    private Preferences? _preferences;
    private DemoLibrary? _demoLibrary;
    private AudioRouter? _audio;
    private PanelView? _panel;
    private Stage? _stage2D;
    private Stage3D? _stage3D;
    private ChatDock? _chat;
    private float _stage3DInset;
    private string _selectedDemoId = "";
    // While set, the machine belongs to the caller of Adopt and the demo controls are ignored.
    private Machine? _adopted;
    private long _lastRenderUs;

    public override void _Ready()
    {
        IArtifactSource source = new GodotResourceSource();
        if (SelfTest.Requested)
        {
            GetTree().Quit(SelfTest.Run(source));
            return;
        }
        if (SelfTest.AcceptanceError is not null)
        {
            GD.Print(SelfTest.AcceptanceError);
            GetTree().Quit(2);
            return;
        }
        if (SelfTest.AcceptanceSuite is not null)
        {
            try
            {
                Acceptance.Start(this, SelfTest.AcceptanceSuite, source);
            }
            catch (Exception error)
            {
                GD.Print("acceptance: harness error " + error.Message);
                GetTree().Quit(2);
            }
            return;
        }

        FitWindowToScreen();
        try
        {
            Start(source);
        }
        catch (Exception error)
        {
            Refuse("MINIVAC 601 refused to start.\n" + error.Message);
        }
    }

    // The base window (project.godot, 1152 x 640) is small on a large or high-density screen. Open at the
    // largest whole-aspect size that fits in 80 % of the screen; the stretch setting scales the 2D UI with
    // it. Never smaller than the base. Tom, 2026-11-12: "window and text really small".
    private void FitWindowToScreen()
    {
        if (DisplayServer.GetName() == "headless") return;
        var window = GetWindow();
        var available = DisplayServer.ScreenGetUsableRect(window.CurrentScreen).Size;
        var scale = Math.Min(available.X * 0.8 / window.ContentScaleSize.X, available.Y * 0.8 / window.ContentScaleSize.Y);
        if (scale <= 1) return;
        window.Size = new Vector2I((int)(window.ContentScaleSize.X * scale), (int)(window.ContentScaleSize.Y * scale));
        window.MoveToCenter();
    }

    public override void _ExitTree()
    {
        _cords?.EndTouch();
        _session?.Dispose();
        _audio?.Dispose();
        _session = null;
    }

    internal void Start(IArtifactSource source)
    {
        BuildConsole(source, (createMachine, trace) =>
        {
            var loop = new Loop { Name = "Loop" };
            AddChild(loop);
            return new Session(createMachine, loop, trace, sample: SampleConsole, render: RenderConsole);
        });
        // A link given at launch connects at once; it is not saved (docs/plans/godot-chat-pane.md, C3).
        if (_chat is not null && PaneLink.FromArgs(OS.GetCmdlineUserArgs()) is { } link)
        {
            _chrome?.SelectColumn(chat: true, focus: false);
            _chat.ConnectLink(link);
        }
        // A running pane server's link is filled into the dock's field (Tom, 2026-11-12, docs/DECISIONS.md).
        var linkFile = PaneLink.FilePath(System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile));
        _chat?.BindLinkSource(() => global::Godot.FileAccess.FileExists(linkFile) ? global::Godot.FileAccess.GetFileAsString(linkFile).Trim() : "");
    }

    internal void BuildConsole(
        IArtifactSource source,
        Func<Func<string, Machine>, TraceView, Session> makeSession,
        string preferencesPath = Preferences.DefaultPath,
        string? forcedViewMode = null,
        IPaneTransport? paneTransport = null)
    {
        var version = Engine.GetVersionInfo();
        var engineVersion = version["string"].AsString();
        if ((int)version["major"] != 4 ||
            (int)version["minor"] != 7 ||
            (int)version["patch"] != 2 ||
            !string.Equals(version["status"].AsString(), "stable", StringComparison.Ordinal))
        {
            Refuse(
                "Unsupported Godot version.\n" +
                "Expected: 4.7.2 stable\n" +
                "Actual: " + engineVersion);
            return;
        }

        var netlistBytes = source.ReadAllBytes("data/netlist.json");
        var actualNetlistHash = Ints.fnv1a64(netlistBytes);
        if (actualNetlistHash != PinnedNetlistHash)
        {
            Refuse(
                "Packed netlist hash mismatch.\n" +
                "Expected: " + PinnedNetlistHash + "\n" +
                "Actual: " + actualNetlistHash);
            return;
        }

        GD.Print($"renderer method={RenderingServer.GetCurrentRenderingMethod()} driver={RenderingServer.GetCurrentRenderingDriverName()}");

        var netlist = Netlist.LoadNetlist(netlistBytes);
        var referenceProfile = LoadProfile(source, "MV601-REF-A");
        var idealProfile = LoadProfile(source, "MV601-IDEAL");
        _demoLibrary = DemoLibrary.Load(source, netlist);
        var publicAssets = source.ReadAllBytes("data/public-assets.json");
        var layout = PanelLayout.Parse(
            source.ReadAllBytes("data/panel-layout.json"),
            new NetlistView(netlist));

        _preferences = new Preferences { Name = "Preferences" };
        AddChild(_preferences);
        _preferences.Load(preferencesPath);
        if (forcedViewMode is not null) _preferences.SetViewMode(forcedViewMode);

        var relayStream = GD.Load<AudioStream>("res://audio/relay-cue.wav") ??
            throw new InvalidOperationException("audio: relay cue resource is missing");
        var dropOutStream = GD.Load<AudioStream>("res://audio/relay-drop-out-cue.wav") ??
            throw new InvalidOperationException("audio: relay drop-out resource is missing");
        var motorStream = GD.Load<AudioStream>("res://audio/rotary-drive-loop.wav") ??
            throw new InvalidOperationException("audio: rotary loop resource is missing");
        var sink = AudioLayers.CreateSink(relayStream, dropOutStream, motorStream);
        _audio = new AudioRouter { Name = "Audio" };
        _audio.Initialize(sink, _preferences.AudioMuted, error => GD.PushWarning("audio: " + error.Message));
        AddChild(_audio);

        _panel = new PanelView();
        _panel.Initialize(layout);
        MountStage(_preferences.ViewMode);

        var trace = new TraceView { Name = "TraceView" };

        _controls = new Controls();
        _panel.AddChild(_controls);
        _controls.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
        _controls.Initialize(layout, ApplyCommand, CurrentState);

        _cords = new Cords();
        _panel.AddChild(_cords);
        _cords.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
        _cords.Initialize(_panel, ApplyCommand, CurrentState);
        _cords.SetTactile(_stage3D is not null);

        _lamps = new Lamps();
        _panel.AddChild(_lamps);
        _lamps.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
        _lamps.Initialize(layout);

        _chrome = new Chrome();
        AddChild(_chrome);
        _chrome.Initialize(
            LayoutStage,
            () => SetStageView("fit"),
            () => SetStageView("wire"),
            () => ZoomStage(1 / Stage.ZoomStep),
            () => ZoomStage(Stage.ZoomStep),
            () => PanStage(new Vector2((float)Stage.PanStepPixels, 0)),
            () => PanStage(new Vector2((float)-Stage.PanStepPixels, 0)),
            () => PanStage(new Vector2(0, (float)Stage.PanStepPixels)),
            () => PanStage(new Vector2(0, (float)-Stage.PanStepPixels)),
            layout,
            _cords,
            trace,
            _demoLibrary,
            _preferences,
            publicAssets,
            LoadDemo,
            LoadManual,
            ResetSession,
            SwitchProfile,
            ToggleSound,
            ChangeViewMode);
        // RenderConsole skips the hidden diagnostics panel, so refresh it the moment it is shown.
        _chrome.DrawerOpened += () => _chrome!.Diagnostics.Render(CurrentState());

        Machine CreateMachine(string profileId) => Machine.CreateMachine(netlist, profileId switch
        {
            "MV601-REF-A" => referenceProfile,
            "MV601-IDEAL" => idealProfile,
            _ => throw new InvalidOperationException("unknown profile id: " + profileId),
        });

        _session = makeSession(CreateMachine, trace);

        // The chat dock: a fresh engine per pane session, over the profiles in the page's order.
        _chat = new ChatDock();
        _chat.Initialize(new ChatModel(
            new PaneConnection(paneTransport ?? new PaneSocket()),
            () => new PaneEngine(netlist, [referenceProfile, idealProfile]),
            Adopt,
            Release));
        _chrome.AttachChat(_chat, InsetStage3D);
        _chrome.Banner.StopPressed += () => _chat.Act(_chat.Model.Stop);
        _chrome.Banner.EndSessionPressed += () => _chat.Act(_chat.Model.EndSession);
        _chat.SessionButtonsChanged += _chrome.Banner.SetButtons;
        _chat.WaitingTextChanged += text => _chrome!.Banner.WaitingText = text;

        LoadDemo(_demoLibrary.Demos[0].Id);
    }

    internal ChatDock CurrentChat =>
        _chat ?? throw new InvalidOperationException("console: chat dock is not mounted");

    internal Session CurrentSession =>
        _session ?? throw new InvalidOperationException("console: session is not mounted");

    internal DemoLibrary CurrentLibrary =>
        _demoLibrary ?? throw new InvalidOperationException("console: demo library is not mounted");

    internal string CurrentViewMode => _stage3D is null ? "flat" : "3d";

    internal bool Adopted => _adopted is not null;

    /// <summary>
    /// Show <paramref name="machine"/> frozen and locked, as a blank manual panel on its own profile:
    /// no replay, no tick, no command. Call it again after each change; the frame loop redraws
    /// from the machine. Until <see cref="Release"/>, Library, Blank panel, Reset and Profile do
    /// nothing, and no panel, cord, cord list or picker input reaches the machine.
    /// </summary>
    internal void Adopt(Machine machine)
    {
        ArgumentNullException.ThrowIfNull(machine);
        var profileId = machine.Snapshot().profileId;
        if (profileId is not (DemoExperience.ReferenceProfileId or DemoExperience.IdealProfileId))
            throw new InvalidOperationException("console: unknown profile " + profileId);
        var replaced = !ReferenceEquals(_adopted, machine);
        // Held input is released on the machine still mounted, before the lock takes it over.
        var locking = _adopted is null;
        if (locking) SetLocked(true);
        _audio?.Reset();
        try
        {
            CurrentSession.Adopt(machine, new AdoptContext(DemoLibrary.MANUAL, profileId, Frozen: true, Locked: true));
        }
        catch
        {
            // The session remounted the machine it had; a console this call locked goes back to live.
            if (locking) SetLocked(false);
            throw;
        }
        _adopted = machine;
        if (replaced) _stage3D?.ResetCords();
        UpdateSelection(manual: true);
        RenderConsole(machine.Snapshot(), _lastRenderUs);
    }

    /// <summary>Remount the adopted machine as it stands, live and unlocked, and hand the controls back.</summary>
    internal void Release()
    {
        var machine = _adopted;
        if (machine is null) return;
        _audio?.Reset();
        // Reset and profile switches afterwards start a blank manual panel, as the drawer shows.
        CurrentSession.Adopt(
            machine,
            new AdoptContext(DemoLibrary.MANUAL, CurrentSession.ProfileId, Frozen: false, Locked: false));
        // Cleared only once the remount held, so a failed one can be tried again.
        _adopted = null;
        SetLocked(false);
        UpdateSelection(manual: true);
        RenderConsole(machine.Snapshot(), _lastRenderUs);
    }

    internal PanelView CurrentPanel =>
        _panel ?? throw new InvalidOperationException("console: panel is not mounted");

    internal Stage? CurrentStage2D => _stage2D;

    internal Stage3D? CurrentStage3D => _stage3D;

    internal void ChangeViewMode(string mode)
    {
        if (_preferences is null) throw new InvalidOperationException("console: preferences are not mounted");
        var normalized = mode == "3d" ? "3d" : "flat";
        if (_preferences.ViewMode != normalized) _preferences.SetViewMode(normalized);
        MountStage(normalized);
        _chrome?.Relayout();
    }

    internal void ToggleViewMode() => ChangeViewMode(CurrentViewMode == "flat" ? "3d" : "flat");

    internal void FreeAudioForAcceptance()
    {
        if (_audio is null) return;
        _audio.Dispose();
        _audio.Free();
        _audio = null;
    }

    // Machine audio is not driven while the lock is on; Adopt and Release reset it.
    internal void SampleConsole(int tick, int[] observables, IReadOnlyList<Event> events)
    {
        if (_adopted is null) _audio?.Sample(events);
    }

    internal void RenderConsole(State state, long nowUs)
    {
        _lastRenderUs = nowUs;
        // The chat's cord marks show only while the chat holds the machine (godot-chat-pane.md, "Cord marks").
        var marked = _adopted is not null ? _chat?.Model.MarkedCords : null;
        _controls?.Render(state);
        _cords?.Render(state, marked);
        if (_stage3D is not null && _cords is not null && _preferences is not null)
            _stage3D.RenderCords(_cords.Project(state.cords), nowUs, _preferences.ReduceMotion, marked);
        _lamps?.Render(state);
        if (_stage3D is not null && _controls is not null)
            _stage3D.RenderPresentation(state, _controls);
        _chrome?.CordList.Render();
        if (_chrome is not null && _chrome.DiagnosticsMount.Visible) _chrome.Diagnostics.Render(state);
        if (_adopted is null) _audio?.Frame(state, nowUs);
    }

    internal void LoadDemo(string id)
    {
        if (_adopted is not null) return;
        var demo = CurrentLibrary.Get(id);
        ReleaseHeldInput();
        _audio?.Reset();
        CurrentSession.LoadDemo(demo);
        _stage3D?.ResetCords();
        _selectedDemoId = id;
        UpdateSelection(manual: false);
        RenderConsole(CurrentSession.CurrentMachine!.Snapshot(), 0);
    }

    internal void LoadManual()
    {
        if (_adopted is not null) return;
        ReleaseHeldInput();
        _audio?.Reset();
        CurrentSession.LoadDemo(DemoLibrary.MANUAL);
        _stage3D?.ResetCords();
        UpdateSelection(manual: true);
        RenderConsole(CurrentSession.CurrentMachine!.Snapshot(), 0);
    }

    internal void ResetSession()
    {
        if (_adopted is not null) return;
        ReleaseHeldInput();
        _audio?.Reset();
        CurrentSession.Reset();
        _stage3D?.ResetCords();
        UpdateSelection(CurrentSession.DemoId == DemoLibrary.MANUAL.Id);
        RenderConsole(CurrentSession.CurrentMachine!.Snapshot(), 0);
    }

    internal void SwitchProfile(string profileId)
    {
        if (_adopted is not null) return;
        ReleaseHeldInput();
        _audio?.Reset();
        CurrentSession.SwitchProfile(profileId);
        _stage3D?.ResetCords();
        UpdateSelection(CurrentSession.DemoId == DemoLibrary.MANUAL.Id);
        RenderConsole(CurrentSession.CurrentMachine!.Snapshot(), 0);
    }

    // Holds and latches belong to the machine being replaced: release them on it, so the new one
    // starts with every button up and the next click presses rather than releases. An open picker
    // and a cord drag name the old machine's cords, so they close on it too.
    private void ReleaseHeldInput()
    {
        if (_chrome is not null && _chrome.Picker.IsOpen) _chrome.Picker.Close();
        if (_cords is not null && _cords.Dragging) _cords.CancelDrag();
        _cords?.EndTouch();
        _controls?.ReleaseLatches();
        _controls?.ReleaseAll();
    }

    private bool ToggleSound()
    {
        if (_preferences is null || _audio is null)
            throw new InvalidOperationException("console: audio preferences are not mounted");
        var muted = !_preferences.AudioMuted;
        _preferences.SetAudioMuted(muted);
        _audio.SetMuted(muted);
        return muted;
    }

    private void MountStage(string mode)
    {
        var panel = CurrentPanel;
        if (mode == "3d" && _stage3D is not null || mode != "3d" && _stage2D is not null) return;
        if (_stage2D is not null)
        {
            _stage2D.RemoveChild(panel);
            _stage2D.Free();
            _stage2D = null;
        }
        if (_stage3D is not null)
        {
            panel = _stage3D.DetachPanel();
            _stage3D.Free();
            _stage3D = null;
        }
        if (mode == "3d")
        {
            _stage3D = new Stage3D();
            AddChild(_stage3D);
            _stage3D.Initialize(panel, ToggleViewMode);
            _stage3D.Camera.SetRightInset(_stage3DInset);
        }
        else
        {
            _stage2D = new Stage();
            AddChild(_stage2D);
            _stage2D.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
            _stage2D.Initialize(panel, ToggleViewMode);
        }
        _cords?.SetTactile(_stage3D is not null);
    }

    private void SetLocked(bool locked)
    {
        _chrome?.SetLocked(locked);
        _controls?.SetLocked(locked);
        _cords?.SetLocked(locked);
    }

    private void SetStageView(string view)
    {
        if (_stage2D is not null) _stage2D.SetView(view);
        else if (_stage3D is not null) _stage3D.SetView(view);
    }

    private void ZoomStage(double factor)
    {
        if (_stage2D is not null) _stage2D.ZoomBy(factor);
        else if (_stage3D is not null) _stage3D.ZoomBy(factor);
    }

    private void PanStage(Vector2 amount)
    {
        if (_stage2D is not null) _stage2D.PanBy(amount);
        else if (_stage3D is not null) _stage3D.PanBy(amount.X, amount.Y);
    }

    private void InsetStage3D(float pixels)
    {
        _stage3DInset = pixels;
        _stage3D?.Camera.SetRightInset(pixels);
    }

    private void LayoutStage(float left, float top, float right, float bottom)
    {
        if (_stage2D is null) return;
        _stage2D.OffsetLeft = left;
        _stage2D.OffsetTop = top;
        _stage2D.OffsetRight = right;
        _stage2D.OffsetBottom = bottom;
    }

    private void UpdateSelection(bool manual)
    {
        if (_chrome is null) return;
        _chrome.DemoExperience.UpdateSelection(_selectedDemoId, CurrentSession.ProfileId, manual);
        _controls?.ApplyLabels(manual
            ? new Dictionary<string, string>()
            : CurrentLibrary.Get(_selectedDemoId).ControlLabels);
    }

    private CmdResult ApplyCommand(Command command) =>
        _session?.Apply(command) ?? throw new InvalidOperationException("console: session is not mounted");

    private State CurrentState() =>
        _session?.CurrentMachine?.Snapshot() ?? throw new InvalidOperationException("console: session is not mounted");

    private static Profile LoadProfile(IArtifactSource source, string profileId)
    {
        using var document = JsonDocument.Parse(
            source.ReadAllBytes("data/profiles/" + profileId + ".json"));
        var profile = Profile.LoadProfile(document.RootElement);
        if (profile.id != profileId)
            throw new InvalidOperationException("profile id mismatch: expected " + profileId + ", got " + profile.id);
        return profile;
    }

    private void Refuse(string message)
    {
        GD.PushError(message);
        var dialog = new AcceptDialog
        {
            Name = "StartupRefusal",
            Title = "MINIVAC 601",
            DialogText = message,
            Exclusive = true,
        };
        AddChild(dialog);
        dialog.PopupCentered();
    }

    private sealed class NetlistView : IRawNetlistView
    {
        public NetlistView(LoadedNetlist netlist)
        {
            var terminals = new RawTerminalView[netlist.terminals.Count];
            for (var index = 0; index < terminals.Length; index++)
                terminals[index] = new RawTerminalView(netlist.terminals[index].id, netlist.terminals[index].holes);
            Terminals = Array.AsReadOnly(terminals);
        }

        public System.Collections.Generic.IReadOnlyList<RawTerminalView> Terminals { get; }
    }
}
