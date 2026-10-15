using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Minivac.Conformance;
using Minivac.Core;

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
    private string _selectedDemoId = "";

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

        try
        {
            Start(source);
        }
        catch (Exception error)
        {
            Refuse("MINIVAC 601 refused to start.\n" + error.Message);
        }
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
    }

    internal void BuildConsole(
        IArtifactSource source,
        Func<Func<string, Machine>, TraceView, Session> makeSession,
        string preferencesPath = Preferences.DefaultPath,
        string? forcedViewMode = null)
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
        LoadDemo(_demoLibrary.Demos[0].Id);
    }

    internal Session CurrentSession =>
        _session ?? throw new InvalidOperationException("console: session is not mounted");

    internal DemoLibrary CurrentLibrary =>
        _demoLibrary ?? throw new InvalidOperationException("console: demo library is not mounted");

    internal string CurrentViewMode => _stage3D is null ? "flat" : "3d";

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

    internal void SampleConsole(int tick, int[] observables, IReadOnlyList<Event> events) =>
        _audio?.Sample(events);

    internal void RenderConsole(State state, long nowUs)
    {
        _controls?.Render(state);
        _cords?.Render(state);
        if (_stage3D is not null && _cords is not null && _preferences is not null)
            _stage3D.RenderCords(_cords.Project(state.cords), nowUs, _preferences.ReduceMotion);
        _lamps?.Render(state);
        if (_stage3D is not null && _controls is not null)
            _stage3D.RenderPresentation(state, _controls);
        _chrome?.CordList.Render();
        if (_chrome is not null && _chrome.DiagnosticsMount.Visible) _chrome.Diagnostics.Render(state);
        _audio?.Frame(state, nowUs);
    }

    internal void LoadDemo(string id)
    {
        var demo = CurrentLibrary.Get(id);
        _audio?.Reset();
        CurrentSession.LoadDemo(demo);
        _stage3D?.ResetCords();
        _selectedDemoId = id;
        UpdateSelection(manual: false);
        RenderConsole(CurrentSession.CurrentMachine!.Snapshot(), 0);
    }

    internal void LoadManual()
    {
        _audio?.Reset();
        CurrentSession.LoadDemo(DemoLibrary.MANUAL);
        _stage3D?.ResetCords();
        UpdateSelection(manual: true);
        RenderConsole(CurrentSession.CurrentMachine!.Snapshot(), 0);
    }

    internal void ResetSession()
    {
        _audio?.Reset();
        CurrentSession.Reset();
        _stage3D?.ResetCords();
        UpdateSelection(CurrentSession.DemoId == DemoLibrary.MANUAL.Id);
        RenderConsole(CurrentSession.CurrentMachine!.Snapshot(), 0);
    }

    internal void SwitchProfile(string profileId)
    {
        _audio?.Reset();
        CurrentSession.SwitchProfile(profileId);
        _stage3D?.ResetCords();
        UpdateSelection(CurrentSession.DemoId == DemoLibrary.MANUAL.Id);
        RenderConsole(CurrentSession.CurrentMachine!.Snapshot(), 0);
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
