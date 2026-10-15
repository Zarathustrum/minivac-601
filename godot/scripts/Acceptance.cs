using System;
using System.Buffers;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Text.Json;
using Godot;
using Minivac.Conformance;
using Minivac.Core;

namespace Minivac.Godot;

public partial class Acceptance : Node
{
    internal readonly record struct CannedAction(int Frame, Command Command);
    private sealed record TraceReplay(string Text, int Accepted, bool SpyExact, bool CommandLinesExact);

    private sealed class SpyMachine(Machine inner, List<Command> observed) : Machine
    {
        public CmdResult Apply(Command command)
        {
            observed.Add(command);
            return inner.Apply(command);
        }

        public void Advance(int ticks) => inner.Advance(ticks);
        public State Snapshot() => inner.Snapshot();
        public int[] Observables() => inner.Observables();
        public int MotionMask() => inner.MotionMask();
        public Event[] DrainEvents() => inner.DrainEvents();
    }

    internal static readonly CannedAction[] TraceEqualityScript =
    [
        new(1, new Command.Power(true)),
        new(2, new Command.Button(1, 1000)),
        new(3, new Command.Button(1, 0)),
        new(4, new Command.Switch(1, 1000)),
        new(5, new Command.DialGrab(90_000_000)),
        new(5, new Command.DialRelease()),
    ];

    private readonly Stopwatch _clock = new();
    private Boot _boot = null!;
    private IArtifactSource _source = null!;
    private Session _session = null!;
    private FrameLoop _frame = null!;
    private DemoLibrary _library = null!;
    private PanelLayout _layout = null!;
    private TraceView _trace = null!;
    private string _suite = "";
    private string _preferencesPath = "";
    private int _passed;
    private int _total;
    private long _nowUs;
    private bool _exitRequested;
    private Action? _framedStep;
    private string _framedGate = "";
    private int _framedFrames;
    private readonly List<Command> _observedCommands = [];

    public override void _Process(double delta)
    {
        if (_framedStep is null) return;
        try
        {
            _framedFrames++;
            if (_framedFrames > 3000)
            {
                GD.Print("FAIL " + _framedGate + " harness-timeout");
                _exitRequested = true;
                RemoveTestPreferences();
                GetTree().Quit(2);
                _framedStep = null;
                return;
            }
            _framedStep();
        }
        catch (Exception error)
        {
            GD.Print("FAIL " + _framedGate + " harness-error " + error.Message);
            _exitRequested = true;
            RemoveTestPreferences();
            GetTree().Quit(2);
            _framedStep = null;
        }
    }

    public static void Start(Boot parent, string suite, IArtifactSource source)
    {
        ArgumentNullException.ThrowIfNull(parent);
        ArgumentException.ThrowIfNullOrWhiteSpace(suite);
        ArgumentNullException.ThrowIfNull(source);
        var acceptance = new Acceptance
        {
            Name = "Acceptance",
            _boot = parent,
            _source = source,
        };
        parent.AddChild(acceptance);
        acceptance.Run(suite);
    }

    internal void Run(string suite)
    {
        _suite = suite;
        _clock.Start();
        try
        {
            if (GetTree().Root.FindChild("Loop", true, false) is not null)
            {
                HarnessFailure("loop-node");
                return;
            }

            var netlist = Netlist.LoadNetlist(_source.ReadAllBytes("data/netlist.json"));
            _library = DemoLibrary.Load(_source, netlist);
            _layout = PanelLayout.Parse(_source.ReadAllBytes("data/panel-layout.json"), new NetlistView(netlist));
            _preferencesPath = "user://minivac-acceptance-" + suite + ".cfg";
            RemoveTestPreferences();
            if (suite == "boot")
            {
                RunBoot();
                return;
            }

            var forced3D = suite is "headless3d" or "popouts" or "budget" or "handles" or "a11y" or "visuals" ||
                suite.EndsWith("-3d", StringComparison.Ordinal);
            var routedSuite = forced3D && suite.EndsWith("-3d", StringComparison.Ordinal)
                ? suite[..^3]
                : suite;
            var framed = routedSuite is "budget" or "handles" or "a11y" or "visuals";
            if (routedSuite is "budget" or "visuals") GetWindow().Size = new Vector2I(1440, 900);
            _boot.BuildConsole(
                _source,
                framed ? MakeFramedSession : MakeDrivenSession,
                _preferencesPath,
                forced3D ? "3d" : "flat");
            var loop = GetTree().Root.FindChild("Loop", true, false);
            if (framed ? loop is null : loop is not null)
            {
                HarnessFailure("loop-node");
                return;
            }
            Node<HelpCredits>("HelpCredits").Close();

            if (routedSuite == "session")
            {
                ArmFramed("3.2.3", () =>
                {
                    var stage = _boot.CurrentStage2D;
                    if (stage is not null && (stage.Size.X <= 0 || stage.Size.Y <= 0)) return;
                    _framedStep = null;
                    RunSession();
                    Finish();
                });
                return;
            }

            if (routedSuite == "commands")
            {
                ArmFramed("3.2.2", () =>
                {
                    var push = FindButton(Node<Controls>("Controls"), "pushbutton", 1);
                    if (push.Size.X <= 0 || push.Size.Y <= 0) return;
                    _framedStep = null;
                    RunCommands();
                    Finish();
                });
                return;
            }

            if (routedSuite == "a11y")
            {
                ArmFramed("3.2.28", () =>
                {
                    var controls = Node<Controls>("Controls");
                    if (controls.Dial.Size.X <= 0 || controls.Dial.Size.Y <= 0) return;
                    _framedStep = null;
                    RunA11y();
                    Finish();
                });
                return;
            }

            if (routedSuite == "budget")
            {
                RunBudget();
                return;
            }

            if (routedSuite == "handles")
            {
                ArmFramed("3.2.19", () =>
                {
                    if (_boot.CurrentPanel.Size.X <= 0 || _boot.CurrentPanel.Size.Y <= 0) return;
                    _framedStep = null;
                    RunHandles();
                    Finish();
                });
                return;
            }

            if (routedSuite == "visuals")
            {
                RunVisuals();
                return;
            }

            switch (routedSuite)
            {
                case "audio":
                    RunAudio();
                    return;
                case "frozen-copy": RunFrozenCopy(); break;
                case "cords": RunCords(); break;
                case "lamps": RunLamps(); break;
                case "geometry": RunGeometry(); break;
                case "manual": RunManual(); break;
                case "keyboard": RunKeyboard(); break;
                case "renderer": RunRenderer(); break;
                case "headless3d": RunHeadless3D(); break;
                case "trace-equality": RunTraceEquality(); break;
                case "popouts": RunPopouts(); break;
                default:
                    GD.Print("acceptance: unknown suite " + suite);
                    GetTree().Quit(2);
                    return;
            }
            Finish();
            if (!_exitRequested)
            {
                GD.Print("FAIL " + suite + " harness-no-exit");
                GetTree().Quit(2);
            }
        }
        catch (HarnessTimeout)
        {
            GD.Print("FAIL " + suite + " harness-timeout");
            RemoveTestPreferences();
            GetTree().Quit(2);
        }
        catch (HarnessAbort)
        {
            RemoveTestPreferences();
        }
    }

    private Session MakeDrivenSession(Func<string, Machine> createMachine, TraceView trace)
    {
        _trace = trace;
        _session = new Session(
            profileId => new SpyMachine(createMachine(profileId), _observedCommands),
            (machine, _) =>
            {
                trace.Reset(machine.Observables());
                _frame = new FrameLoop(
                    machine,
                    (tick, observables, events) =>
                    {
                        trace.Frame(tick, observables, events);
                        _boot.SampleConsole(tick, observables, events);
                    },
                    (state, nowUs) =>
                    {
                        trace.Flush();
                        _boot.RenderConsole(state, nowUs);
                    });
                return () => { };
            });
        return _session;
    }

    private Session MakeFramedSession(Func<string, Machine> createMachine, TraceView trace)
    {
        _trace = trace;
        var loop = new Loop { Name = "Loop" };
        _boot.AddChild(loop);
        _session = new Session(
            createMachine,
            loop,
            trace,
            sample: _boot.SampleConsole,
            render: _boot.RenderConsole);
        return _session;
    }

    private void RunBoot()
    {
        var cleanBytes = _source.ReadAllBytes("data/netlist.json");
        var corruptBytes = (byte[])cleanBytes.Clone();
        corruptBytes[0] ^= 1;
        var actualHash = Ints.fnv1a64(corruptBytes);
        _boot.Start(new FlippedArtifactSource(_source, corruptBytes));
        var refusal = _boot.GetNodeOrNull<AcceptDialog>("StartupRefusal");
        var refusalPassed = refusal is not null &&
            refusal.DialogText.Contains("2354ceebf3f8c566", StringComparison.Ordinal) &&
            refusal.DialogText.Contains(actualHash, StringComparison.Ordinal);
        foreach (var child in _boot.GetChildren())
        {
            if (ReferenceEquals(child, this)) continue;
            child.QueueFree();
        }

        ArmFramed("3.2.1", () =>
        {
            foreach (var child in _boot.GetChildren())
            {
                if (!ReferenceEquals(child, this)) return;
            }
            Check("3.2.1", "refusal", refusalPassed, refusalPassed ? "StartupRefusal" : "missing");
            Check("3.2.1", "refusal-clean", GetTree().Root.FindChild("Loop", true, false) is null, "1");
            _boot.BuildConsole(_source, MakeDrivenSession, _preferencesPath);
            var help = Node<HelpCredits>("HelpCredits");
            Check("3.2.1", "default-view", _boot.CurrentViewMode == "3d", _boot.CurrentViewMode);
            Check("3.2.1", "profile", _session.ProfileId == Session.DEFAULT_PROFILE_ID, _session.ProfileId);
            Check("3.2.1", "demo", _session.DemoId == "IV-EXP1", _session.DemoId ?? "none");
            Check("3.2.1", "help-open", help.InitiallyOpen && help.IsOpen, help.IsOpen ? "1" : "0");
            Check("3.2.1", "hash", Ints.fnv1a64(cleanBytes) == "2354ceebf3f8c566", Ints.fnv1a64(cleanBytes));
            Check("3.2.1", "no-loop-node", GetTree().Root.FindChild("Loop", true, false) is null, "1");
            _framedStep = null;
            Finish();
        });
    }

    private void RunSession()
    {
        var experience = Node<DemoExperience>("DemoExperience");
        var selectedLabel = experience.ResetButton.Text;
        Check(
            "3.2.3",
            "reset-label",
            selectedLabel == DemoExperience.SelectedDemoResetLabel,
            selectedLabel);

        experience.ManualButton.EmitSignal(BaseButton.SignalName.Pressed);
        var blankLabel = experience.ResetButton.Text;
        Check(
            "3.2.3",
            "reset-label",
            blankLabel == DemoExperience.BlankPanelResetLabel,
            blankLabel);

        var loaded = 0;
        for (var index = 0; index < experience.DemoButtons.Count; index++)
        {
            experience.DemoButtons[index].EmitSignal(BaseButton.SignalName.Pressed);
            experience.LoadButton.EmitSignal(BaseButton.SignalName.Pressed);
            if (_session.DemoId == _library.Demos[index].Id) loaded++;
        }
        Check("3.2.3", "demos", loaded == 17, loaded + "/17");

        var longDemo = experience.DemoButtons.Single(button => button.Name == "Demo_V-JOBSELECT");
        longDemo.EmitSignal(BaseButton.SignalName.Pressed);
        var pages = 0;
        while (!experience.ScrollDownButton.Disabled && pages++ < 100)
            experience.ScrollDownButton.EmitSignal(BaseButton.SignalName.Pressed);
        var maximumOffset = Math.Max(0, experience.SelectedEntryContentHeight - experience.SelectedEntryViewportHeight);
        var reachedBottom = experience.ScrollDownButton.Disabled &&
            Math.Abs(experience.EntryScrollOffset - maximumOffset) <= 0.5f && maximumOffset > 0;
        while (!experience.ScrollUpButton.Disabled && pages++ < 200)
            experience.ScrollUpButton.EmitSignal(BaseButton.SignalName.Pressed);
        var returnedTop = experience.ScrollUpButton.Disabled && experience.EntryScrollOffset == 0;
        var contentScrollable = reachedBottom && returnedTop;
        Check("3.2.3", "demo-content-reachable", contentScrollable, contentScrollable ? "bottom+top" : "incomplete");

        var chrome = Node<Chrome>("Chrome");
        chrome.Toolbar.Library.EmitSignal(BaseButton.SignalName.Pressed);
        // The per-frame render skips the hidden panel, so opening the drawer must render it once.
        var diagnosticsOnOpen = !string.IsNullOrEmpty(chrome.Diagnostics.StatusTitle);
        Check("3.2.3", "diagnostics-on-open", diagnosticsOnOpen, diagnosticsOnOpen ? "rendered" : "stale");
        var stage = Node<Stage>("Stage2D");
        var controls = Node<Controls>("Controls");
        var overlayCommands = 0;
        void CountOverlayCommand(Command _) => overlayCommands++;
        controls.Emitted += CountOverlayCommand;
        var viewBeforeOverlayInput = stage.View;
        var scaleBeforeOverlayInput = stage.ViewScale;
        var panBeforeOverlayInput = stage.Pan;
        var overlayPoint = experience.SelectedEntryViewportRect.GetCenter();
        RouteGuiAt(chrome.Drawer, MouseButtonEvent(true), overlayPoint);
        RouteGuiAt(chrome.Drawer, MouseButtonEvent(false), overlayPoint);
        RouteGuiAt(chrome.Drawer, MouseButtonEvent(true, buttonIndex: MouseButton.WheelUp), overlayPoint);
        controls.Emitted -= CountOverlayCommand;
        var overlayInputBlocked = overlayCommands == 0 &&
            stage.View == viewBeforeOverlayInput && stage.ViewScale == scaleBeforeOverlayInput && stage.Pan == panBeforeOverlayInput;
        Check("3.2.3", "drawer-input-boundary", overlayInputBlocked, overlayInputBlocked ? "pointer+wheel" : "leaked");
        var diagnostics = chrome.Diagnostics;
        var diagnosticState = _session.CurrentMachine!.Snapshot() with
        {
            notes =
            [
                new Note.LampInCoilPath(2, 2_200),
                new Note.CoilStarved(
                    3,
                    12_000,
                    43_333,
                    [new Note.Drop("ind3", 9_000), new Note.Drop("cord:7", 4_500)]),
            ],
        };
        diagnostics.Render(diagnosticState);
        var noteCopyAndFit = diagnostics.Notes.Count == 2 &&
            diagnostics.Notes[0].Text == "Relay 2's indicator lamp is in series with its coil and drops 2200 mV." &&
            diagnostics.Notes[1].Text == "Relay 3 needs 43333 µA and has 12000 µA. Largest drops: ind3 9000 mV; cord:7 4500 mV." &&
            diagnostics.Notes.All(label => label.GetContentHeight() <= label.Size.Y + 0.5f) &&
            diagnostics.Notes[1].GetContentHeight() > 24;
        var worstDrops = Enumerable.Range(0, 278)
            .Select(index => new Note.Drop("element-" + index, index * 10))
            .ToArray();
        var worstDiagnosticState = diagnosticState with
        {
            notes = Enumerable.Range(1, 12)
                .Select(index => (Note)new Note.CoilStarved((index - 1) % 6 + 1, 12_000, 43_333, worstDrops))
                .ToArray(),
        };
        diagnostics.Render(worstDiagnosticState);
        var notePages = 0;
        var maximumNoteOffset = Math.Max(0, diagnostics.NoteContentHeight - diagnostics.NoteViewportHeight);
        while (diagnostics.NoteScrollOffset < maximumNoteOffset && notePages++ < 2_000)
        {
            chrome.Drawer.NotePageDown.EmitSignal(BaseButton.SignalName.Pressed);
            _boot.RenderConsole(worstDiagnosticState, _nowUs);
        }
        var reachedNotesBottom = Math.Abs(diagnostics.NoteScrollOffset - maximumNoteOffset) <= 0.5f && maximumNoteOffset > 0;
        while (diagnostics.NoteScrollOffset > 0 && notePages++ < 4_000)
        {
            chrome.Drawer.NotePageUp.EmitSignal(BaseButton.SignalName.Pressed);
            _boot.RenderConsole(worstDiagnosticState, _nowUs);
        }
        var notesReachable = reachedNotesBottom && diagnostics.NoteScrollOffset == 0 && diagnostics.Notes.Count == 12;
        var diagnosticsVisible = chrome.Drawer.Visible && chrome.DiagnosticsMount.Visible &&
            diagnostics.TerminalVoltages.Count == 186 &&
            !string.IsNullOrEmpty(diagnostics.StatusTitle) &&
            diagnostics.Notes.Count > 0;
        Check("3.2.3", "diagnostics", diagnosticsVisible, diagnosticsVisible ? "186/186" : "missing");
        var visitedTerminals = new HashSet<string>(StringComparer.Ordinal);
        var terminalCellsFit = true;
        for (var page = 0; page < diagnostics.TerminalPageCount; page++)
        {
            foreach (var label in diagnostics.TerminalVoltages.Where(label => label.Visible))
            {
                visitedTerminals.Add(label.GetMeta("terminal").AsString());
                terminalCellsFit &= label.GetMinimumSize().X <= label.Size.X + 0.5f;
            }
            if (page + 1 < diagnostics.TerminalPageCount)
                chrome.Drawer.TerminalPageDown.EmitSignal(BaseButton.SignalName.Pressed);
        }
        var visibleTerminals = diagnostics.TerminalVoltages.Where(label => label.Visible).ToArray();
        var terminalBottom = visibleTerminals.Max(label => label.Position.Y + label.Size.Y);
        var notesBottom = diagnostics.NoteViewportTop + diagnostics.NoteViewportHeight;
        var diagnosticsLayout = terminalBottom <= diagnostics.NoteViewportTop && notesBottom <= diagnostics.Trace.Position.Y &&
            diagnostics.Trace.Position.Y + diagnostics.Trace.Size.Y <= diagnostics.Size.Y + 0.5f &&
            diagnostics.TerminalVoltages.All(label =>
                label.Text.StartsWith(label.GetMeta("terminal").AsString() + ": ", StringComparison.Ordinal) &&
                (label.Text.EndsWith("floating", StringComparison.Ordinal) || label.Text.EndsWith(" mV", StringComparison.Ordinal))) &&
            terminalCellsFit && visitedTerminals.Count == 186 && noteCopyAndFit && notesReachable;
        var diagnosticsDetail = diagnosticsLayout
            ? "186/186"
            : "terminal=" + terminalBottom + " notes=" + diagnostics.NoteViewportTop + ".." + notesBottom +
                " trace=" + diagnostics.Trace.Position.Y + ".." + (diagnostics.Trace.Position.Y + diagnostics.Trace.Size.Y) +
                " height=" + diagnostics.Size.Y + " cells=" + terminalCellsFit + " ids=" + visitedTerminals.Count +
                " note-copy-fit=" + noteCopyAndFit + " note-scroll=" + notesReachable;
        Check("3.2.3", "diagnostics-layout", diagnosticsLayout, diagnosticsDetail);
        RouteGui(chrome.Drawer.CloseButton, KeyEvent(Key.Escape, true));
        var drawerFocusReturn = !chrome.Drawer.Visible && chrome.Toolbar.Library.HasFocus();
        Check("3.2.3", "drawer-focus-return", drawerFocusReturn, drawerFocusReturn ? "1" : "0");
    }

    private void RunAudio()
    {
        var preferences = Node<Preferences>("Preferences");
        var toolbar = Node<Toolbar>("Toolbar");
        toolbar.Sound.EmitSignal(BaseButton.SignalName.Pressed);
        preferences.SetHelpSeen(true);
        preferences.SetReduceMotion(true);

        preferences.Reload();
        var persisted = (preferences.AudioMuted ? 1 : 0) +
            (preferences.HelpSeen ? 1 : 0) +
            (preferences.ReduceMotion ? 1 : 0);
        Check("3.2.6", "prefs-persist", persisted == 3, persisted + "/3");

        _boot.SwitchProfile(DemoExperience.IdealProfileId);
        using var file = new ConfigFile();
        var loaded = (int)file.Load(_preferencesPath) == 0;
        var profileAbsent = loaded && !file.HasSection("profile") &&
            !file.HasSectionKey("session", "profile");
        Check("3.2.6", "profile-not-persisted", profileAbsent, profileAbsent ? "1" : "0");
        var productionSink = Node<AudioRouter>("Audio").Sink as GodotAudioSink;
        var productionLoops = productionSink?.MotorLoops == true;
        Check("3.2.6", "motor-loop", productionLoops, productionLoops ? "1" : "0");

        var pullInBytes = global::Godot.FileAccess.GetFileAsBytes("res://audio/relay-cue.wav");
        var dropOutBytes = global::Godot.FileAccess.GetFileAsBytes("res://audio/relay-drop-out-cue.wav");
        var samplesDistinct = pullInBytes.Length > 0 && dropOutBytes.Length > 0 &&
            !pullInBytes.SequenceEqual(dropOutBytes) &&
            AudioLayers.SelectRelaySample(RelayCueKind.PullIn) !=
                AudioLayers.SelectRelaySample(RelayCueKind.DropOut);
        Check("3.2.23", "relay-samples-distinct", samplesDistinct,
            samplesDistinct ? pullInBytes.Length + "/" + dropOutBytes.Length : "missing-or-equal");

        var roomBusIndex = AudioServer.GetBusIndex(AudioLayers.RoomBusName);
        var effectCountBefore = roomBusIndex < 0 ? 0 : AudioServer.GetBusEffectCount(roomBusIndex);
        var pullInStream = GD.Load<AudioStream>("res://audio/relay-cue.wav");
        var dropOutStream = GD.Load<AudioStream>("res://audio/relay-drop-out-cue.wav");
        var motorStream = GD.Load<AudioStream>("res://audio/rotary-drive-loop.wav");
        var roomIdempotent = false;
        if (pullInStream is not null && dropOutStream is not null && motorStream is not null)
        {
            var probeSink = AudioLayers.CreateSink(pullInStream, dropOutStream, motorStream);
            roomIdempotent = roomBusIndex >= 0 &&
                probeSink.RoomBusIndex == roomBusIndex &&
                AudioServer.GetBusIndex(AudioLayers.RoomBusName) == roomBusIndex &&
                AudioServer.GetBusEffectCount(roomBusIndex) == effectCountBefore;
            probeSink.Dispose();
            probeSink.RelayPlayer.Free();
            probeSink.MotorPlayer.Free();
        }

        var reverbIndex = -1;
        AudioEffectReverb? roomReverb = null;
        if (roomBusIndex >= 0)
        {
            for (var index = 0; index < AudioServer.GetBusEffectCount(roomBusIndex); index++)
            {
                if (AudioServer.GetBusEffect(roomBusIndex, index) is not AudioEffectReverb reverb) continue;
                reverbIndex = index;
                roomReverb = reverb;
            }
        }
        using var defaultReverb = new AudioEffectReverb();
        var defaultReverbExact = roomReverb is not null &&
            roomReverb.PredelayMsec == defaultReverb.PredelayMsec &&
            roomReverb.PredelayFeedback == defaultReverb.PredelayFeedback &&
            roomReverb.RoomSize == defaultReverb.RoomSize &&
            roomReverb.Damping == defaultReverb.Damping &&
            roomReverb.Spread == defaultReverb.Spread &&
            roomReverb.Hipass == defaultReverb.Hipass &&
            roomReverb.Dry == defaultReverb.Dry &&
            roomReverb.Wet == defaultReverb.Wet;
        var roomValid = productionSink is not null && roomBusIndex >= 0 &&
            productionSink.RoomBusIndex == roomBusIndex &&
            productionSink.RelayPlayer.Bus == AudioLayers.RoomBusName &&
            productionSink.MotorPlayer.Bus == AudioLayers.RoomBusName &&
            AudioServer.GetBusSend(roomBusIndex) == "Master" &&
            AudioServer.GetBusEffectCount(roomBusIndex) == 1 && reverbIndex >= 0 &&
            AudioServer.IsBusEffectEnabled(roomBusIndex, reverbIndex) &&
            defaultReverbExact && roomIdempotent;
        Check("3.2.23", "room-bus", roomValid, roomBusIndex.ToString());

        var polyphonicPools = GetTree().Root.FindChildren("*", "AudioStreamPlayer", true, false)
            .OfType<AudioStreamPlayer>()
            .Count(player => player.Stream is AudioStreamPolyphonic);
        var spatialPlayers = GetTree().Root.FindChildren("*", "AudioStreamPlayer3D", true, false).Count;
        var flatPool = _boot.CurrentViewMode == "flat" && productionSink?.RelayPolyphony == 32 &&
            polyphonicPools == 1 && spatialPlayers == 0;
        Check("3.2.23", "flat-mode-pool", flatPool,
            flatPool ? polyphonicPools.ToString() : polyphonicPools + "/spatial=" + spatialPlayers);

        var droppedDelta = -1L;
        var dropNotRetry = false;
        if (productionSink is not null)
        {
            productionSink.StopRelayCues();
            var droppedBefore = productionSink.DroppedRelayCount;
            for (var index = 0; index < AudioLayers.RelayPolyphony + 1; index++)
            {
                var kind = index % 2 == 0 ? RelayCueKind.PullIn : RelayCueKind.DropOut;
                productionSink.PlayRelay(new RelayCue(kind, index % 6 + 1, 0));
            }
            productionSink.Frame(0);
            var droppedAfterSaturation = productionSink.DroppedRelayCount;
            droppedDelta = droppedAfterSaturation - droppedBefore;
            var firstFrameDrained = productionSink.PendingRelayCount == 0;
            productionSink.Frame(0);
            dropNotRetry = productionSink.RelayPlayer.Playing && droppedDelta == 1 &&
                firstFrameDrained && productionSink.PendingRelayCount == 0 &&
                productionSink.DroppedRelayCount == droppedAfterSaturation;
            productionSink.StopRelayCues();
        }
        Check("3.2.23", "drop-not-retry", dropNotRetry,
            droppedDelta + " driver=" + AudioServer.GetDriverName());

        var sink = new RefusingAudioSink();
        var router = new AudioRouter();
        AddChild(router);
        var errors = 0;
        router.Initialize(sink, onError: _ => errors++);
        var state = _session.CurrentMachine!.Snapshot();
        router.Frame(state with { dial = state.dial with { mrpm = 45_000 } }, 0);
        sink.RefuseNextStop = true;
        router.SetMuted(true);
        router.Frame(state with { dial = state.dial with { mrpm = 0 } }, 100);
        var retriedStop = sink.StopAttempts == 2 && !sink.MotorRunning && errors == 1;
        Check("3.2.6", "motor-stop-retry", retriedStop, retriedStop ? "2/2" : sink.StopAttempts + "/2");

        var relay = new Event.RelayPullIn(1, 1, 40_000, 1_000);
        router.SetMuted(false);
        router.Sample([relay]);
        router.SetMuted(true);
        router.Sample([relay]);
        router.Frame(state with { dial = state.dial with { mrpm = 0 } }, 200);
        var muteDrops = router.Muted && sink.RelayCues == 0;
        router.SetMuted(false);
        router.Sample([relay]);
        router.Reset();
        router.Frame(state with { dial = state.dial with { mrpm = 0 } }, 300);
        var resetDrops = !router.Muted && sink.RelayCues == 0;
        router.Sample([relay]);
        router.Dispose();
        router.Frame(state, 400);
        var disposedDrops = sink.RelayCues == 0 && sink.StopRelayCalls >= 3;
        var lifecycle = muteDrops && resetDrops && disposedDrops;
        Check("3.2.6", "mute-reset-dispose", lifecycle, lifecycle ? "3/3" : "mismatch");
        router.QueueFree();

        _boot.FreeAudioForAcceptance();
        var previousMixAge = AudioServer.GetTimeSinceLastMix();
        ArmFramed("3.2.23", () =>
        {
            var mixAge = AudioServer.GetTimeSinceLastMix();
            if (mixAge >= previousMixAge)
            {
                previousMixAge = mixAge;
                return;
            }
            _framedStep = null;
            Finish();
        });
    }

    private void RunFrozenCopy()
    {
        var experience = Node<DemoExperience>("DemoExperience");
        var entries = experience.CaptureRenderedEntries();
        var exact = entries.Count == _library.Demos.Count;
        for (var index = 0; exact && index < entries.Count; index++)
            exact = EntryMatches(entries[index], _library.Demos[index]);
        Check("3.2.8", "data-derived", exact, exact ? "17/17" : "mismatch");

        var fallback = entries.Single(entry => entry.Id == "VI-TICTACTOE")
            .Source.Fallbacks.Contains("FALLBACK-TTT-RING-CW", StringComparer.Ordinal);
        Check("3.2.8", "fallback", fallback, fallback ? "FALLBACK-TTT-RING-CW" : "missing");

        var notices = entries.Where(entry => entry.NoticeParagraphs.Count != 0).ToArray();
        var noticeShape = string.Join(",", notices.Select(entry => entry.Id + "x" + entry.NoticeParagraphs.Count));
        var noticesExact = noticeShape == "IV-EXP1x3,ER-ALTCOUNTERx3,VI-COMBOLOCKx1,V-EXP19x1";
        Check("3.2.8", "notice-paragraphs", noticesExact, noticesExact ? "2x3+2x1" : noticeShape);

        var help = Node<HelpCredits>("HelpCredits");
        var limitsExact = help.Pages[1] == "Redraw and simulation limits\n\n" + HelpCredits.RedrawLimits + "\n\n" + HelpCredits.PowerLimits;
        Check("3.2.8", "limits", limitsExact, limitsExact ? "2/2" : "mismatch");
        var expectedCredits = new[]
        {
            (Id: "panel-ph2-primary", Heading: "Primary panel photograph (PH2)", Description:
                "Primary evidence for panel geometry and visual facts. The procedural HTML/CSS/SVG redraw changes the photograph into measured, fixed-geometry shapes without shipping the raster. It is an adaptation, and the panel-art derivative is licensed CC BY-SA 4.0."),
            (Id: "panel-ph3-corroboration", Heading: "POWER-jewel evidence (PH3)", Description:
                "Corroboration for the factory POWER jewel and unit-to-unit variation only; its oblique geometry was not measured and the raster is not shipped."),
            (Id: "relay-cue", Heading: "Relay simulation cue", Description:
                "The shipped attenuated derivative is a simulated operation cue, not an authenticated MINIVAC recording."),
            (Id: "rotary-drive-loop", Heading: "Rotary drive-wheel simulation loop", Description:
                "The shipped attenuated, wrap-crossfaded derivative is a simulated motor cue, not an authenticated MINIVAC recording."),
            (Id: "relay-drop-out-cue", Heading: "Relay release simulation", Description:
                "Both builds include the derivative; the desktop build uses it as a simulated relay drop-out cue. It is not an authenticated MINIVAC recording."),
        };
        using var assetDocument = JsonDocument.Parse(_source.ReadAllBytes("data/public-assets.json"));
        var assets = assetDocument.RootElement.GetProperty("records").EnumerateArray()
            .Where(record => expectedCredits.Any(expected => expected.Id == record.GetProperty("id").GetString()))
            .ToDictionary(record => record.GetProperty("id").GetString()!, StringComparer.Ordinal);
        var expectedCreditPages = new List<string>();
        var exactCredits = help.Credits.Count == expectedCredits.Length && help.Pages.Count == expectedCredits.Length + 2;
        for (var index = 0; exactCredits && index < expectedCredits.Length; index++)
        {
            var expected = expectedCredits[index];
            var actual = help.Credits[index];
            if (!assets.TryGetValue(expected.Id, out var asset))
            {
                exactCredits = false;
                break;
            }
            var creator = asset.GetProperty("creator").GetString()!;
            var sourcePage = asset.GetProperty("sourcePage").GetString()!;
            var license = asset.GetProperty("license").GetString()!;
            var licenseUrl = asset.GetProperty("licenseUrl").GetString()!;
            var licenseName = license switch
            {
                "CC-BY-SA-4.0" => "CC BY-SA 4.0",
                "CC-BY-2.0" => "CC BY 2.0",
                "CC0-1.0" => "CC0 1.0",
                _ => "unsupported",
            };
            exactCredits &= actual.Id == expected.Id && actual.Heading == expected.Heading &&
                actual.Description == expected.Description && actual.Creator == creator &&
                actual.SourcePage == sourcePage && actual.License == license && actual.LicenseUrl == licenseUrl &&
                licenseName != "unsupported";
            expectedCreditPages.Add(
                "Credits\n\n" + expected.Heading + " — " + creator + ".\n\n" + expected.Description +
                "\n\n" + expected.Heading + " source\n" + sourcePage + "\n\n" + licenseName + "\n" + licenseUrl);
        }
        while (help.PageIndex > 0) help.PreviousPage();
        var displayedCredits = 0;
        for (var index = 0; index < expectedCreditPages.Count; index++)
        {
            while (help.PageIndex < index + 2) help.NextPage();
            if (help.DialogText == expectedCreditPages[index]) displayedCredits++;
        }
        while (help.PageIndex > 0) help.PreviousPage();
        Check("3.2.8", "credits", exactCredits && displayedCredits == expectedCredits.Length,
            $"records={(exactCredits ? expectedCredits.Length : 0)}/{expectedCredits.Length}," +
            $"displayed={displayedCredits}/{expectedCredits.Length}");
        var controls = Node<Controls>("Controls");
        var accessibleNames = 0;
        foreach (var demo in _library.Demos)
        {
            _boot.LoadDemo(demo.Id);
            foreach (var (identity, baseName) in Controls.ControlBaseNames)
            {
                var expected = demo.ControlLabels.TryGetValue(identity, out var label)
                    ? baseName + ": " + label
                    : baseName;
                if (controls.AccessibleName(identity) == expected) accessibleNames++;
            }
        }
        _boot.LoadManual();
        foreach (var (identity, baseName) in Controls.ControlBaseNames)
            if (controls.AccessibleName(identity) == baseName) accessibleNames++;
        var expectedAccessibleNames = (_library.Demos.Count + 1) * Controls.ControlBaseNames.Count;
        Check(
            "3.2.8",
            "control-accessible-names",
            accessibleNames == expectedAccessibleNames,
            accessibleNames + "/" + expectedAccessibleNames);
        var capture = FrozenCaptureLine(entries);
        var captureExact = capture == FrozenSourceCaptureLine(_library.Demos);
        Check("3.2.8", "capture", captureExact, captureExact ? "17/17" : "mismatch");
        GD.Print("frozen-copy-hash: redraw=" + Ints.fnv1a64(Encoding.UTF8.GetBytes(HelpCredits.RedrawLimits)));
        GD.Print("frozen-copy-hash: power=" + Ints.fnv1a64(Encoding.UTF8.GetBytes(HelpCredits.PowerLimits)));
        GD.Print(capture);
    }

    private void RunCommands()
    {
        var controls = Node<Controls>("Controls");
        var panel = Node<PanelView>("Panel");
        var push = FindButton(controls, "pushbutton", 1);
        var relay = controls.Relays[0];
        var emitted = new List<Command>();
        controls.Emitted += emitted.Add;

        RoutePanelGui(push, MouseButtonEvent(true));
        RoutePanelGui(push, MouseButtonEvent(false));
        var routedPointer = IsButtonPair(emitted);
        emitted.Clear();

        var shellGestureIsolated = true;
        if (_boot.CurrentStage3D is not null)
        {
            var forwardedShellEvents = 0;
            void SawShellEvent(InputEvent _) => forwardedShellEvents++;
            push.GuiInput += SawShellEvent;
            var altDown = MouseButtonEvent(true);
            altDown.AltPressed = true;
            var altUp = MouseButtonEvent(false);
            RoutePanelGui(push, altDown);
            RoutePanelGui(push, altUp);
            foreach (var shellButton in new[] { MouseButton.Right, MouseButton.Middle, MouseButton.WheelUp })
            {
                RoutePanelGui(push, MouseButtonEvent(true, buttonIndex: shellButton));
                RoutePanelGui(push, MouseButtonEvent(false, buttonIndex: shellButton));
            }
            push.GuiInput -= SawShellEvent;
            shellGestureIsolated = forwardedShellEvents == 0 && emitted.Count == 0;
            emitted.Clear();
        }

        var holeOrder = panel.Holes.Values.Select(button => button.GetMeta("hole_id").AsString()).ToArray();
        Check("3.2.2", "holes", holeOrder.SequenceEqual(_layout.Holes.Select(hole => hole.Id)), "392/392");

        emitted.Clear();
        EmitGui(push, KeyEvent(Key.Space, true));
        EmitGui(push, MouseButtonEvent(true));
        EmitGui(push, KeyEvent(Key.Space, false));
        var keyboardThenPointerButtonHeld = emitted.Count == 1 && emitted[0] is Command.Button { target: 1000 };
        EmitGui(push, MouseButtonEvent(false));
        var keyboardThenPointerButton = keyboardThenPointerButtonHeld && IsButtonPair(emitted);
        emitted.Clear();
        EmitGui(push, MouseButtonEvent(true));
        EmitGui(push, KeyEvent(Key.Space, true));
        EmitGui(push, MouseButtonEvent(false));
        var pointerThenKeyboardButtonHeld = emitted.Count == 1 && emitted[0] is Command.Button { target: 1000 };
        EmitGui(push, KeyEvent(Key.Space, false));
        var pointerThenKeyboardButton = pointerThenKeyboardButtonHeld && IsButtonPair(emitted);

        EmitGui(relay, MouseButtonEvent(true, relay.Size.X));
        EmitGui(relay, MouseButtonEvent(false, relay.Size.X));
        emitted.Clear();
        EmitGui(relay, KeyEvent(Key.End, true));
        EmitGui(relay, MouseButtonEvent(true, relay.Size.X));
        EmitGui(relay, KeyEvent(Key.End, false));
        var keyboardThenPointerRelayHeld = emitted.Count(command => command is Command.RelayGrab) == 2 &&
            emitted.All(command => command is not Command.RelayRelease);
        EmitGui(relay, MouseButtonEvent(false, relay.Size.X));
        var keyboardThenPointerRelay = keyboardThenPointerRelayHeld && emitted.Count(command => command is Command.RelayGrab) == 2 &&
            emitted.Count(command => command is Command.RelayRelease) == 1;
        emitted.Clear();
        EmitGui(relay, MouseButtonEvent(true, relay.Size.X / 2));
        EmitGui(relay, KeyEvent(Key.Up, true));
        EmitGui(relay, MouseButtonEvent(false, relay.Size.X / 2));
        var pointerThenKeyboardRelayHeld = emitted.Count == 1 && emitted[0] is Command.RelayGrab;
        EmitGui(relay, KeyEvent(Key.Up, false));
        var pointerThenKeyboardRelay = pointerThenKeyboardRelayHeld && emitted.Count == 2 &&
            emitted[0] is Command.RelayGrab && emitted[1] is Command.RelayRelease;
        Check("3.2.2", "arbitration",
            keyboardThenPointerButton && pointerThenKeyboardButton && keyboardThenPointerRelay && pointerThenKeyboardRelay,
            "2/2");
        Check("3.2.2", "routing", routedPointer, routedPointer ? "1" : "0");
        Check("3.2.2", "shell-gesture-isolated", shellGestureIsolated,
            shellGestureIsolated ? "1" : "0");
        var chrome = Node<Chrome>("Chrome");
        var flatStage = _boot.CurrentStage2D;
        var chromeClear = flatStage is null ||
            (!flatStage.GetGlobalRect().Intersects(chrome.Toolbar.GetGlobalRect()) &&
             !flatStage.GetGlobalRect().Intersects(chrome.CordList.GetGlobalRect()));
        Check("3.2.2", "chrome-clear", chromeClear, chromeClear ? "2/2" : "0/2");

        emitted.Clear();
        controls.PointerDial(Vector2.Up, true);
        controls.PointerDialMove(new Vector2(1, -2));
        var dialValueProperty = controls.Dial.GetType().GetProperty(
            "Value",
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
        var dialPresented = dialValueProperty?.GetValue(controls.Dial) is long value && value == 26_565_051;
        controls.PointerDial(Vector2.Up, false);
        var dialCommandsExact = emitted.Count == 3 &&
            emitted[0] is Command.DialGrab { targetUdeg: 0 } &&
            emitted[1] is Command.DialGrab { targetUdeg: 26_565_051 } &&
            emitted[2] is Command.DialRelease;
        Check("3.2.2", "dial-pointer-presentation", dialPresented && dialCommandsExact,
            $"value={(dialPresented ? 26_565_051 : -1)},commands={(dialCommandsExact ? 3 : 0)}/3");

        emitted.Clear();
        EmitGui(controls.Relays[1], KeyEvent(Key.Up, true));
        var unrelatedKeyUpSuppressed = emitted.Count == 2;
        EmitGui(controls.Relays[1], KeyEvent(Key.Shift, false));
        unrelatedKeyUpSuppressed &= emitted.Count == 2;
        EmitGui(controls.Relays[1], KeyEvent(Key.Up, false));
        EmitGui(controls.Dial, KeyEvent(Key.Pageup, true));
        var push2 = FindButton(controls, "pushbutton", 2);
        EmitGui(push2, KeyEvent(Key.Space, true));
        EmitGui(push2, KeyEvent(Key.Space, false));
        Check("3.2.2", "keyboard", unrelatedKeyUpSuppressed && emitted.Count == 7, emitted.Count + "/7");

        emitted.Clear();
        RoutePanelGui(push, ShiftClick(true));
        RoutePanelGui(push, ShiftClick(false));
        var latchSurvivesUp = emitted.Count == 1 && emitted[0] is Command.Button { n: 1, target: 1000 };
        RoutePanelGui(push2, ShiftClick(true));
        RoutePanelGui(push2, ShiftClick(false));
        var secondLatch = emitted.Count == 2 && emitted[1] is Command.Button { n: 2, target: 1000 };
        RoutePanelGui(push, MouseButtonEvent(true));
        RoutePanelGui(push, MouseButtonEvent(false));
        var plainClickReleases = emitted.Count == 3 && emitted[2] is Command.Button { n: 1, target: 0 };
        RoutePanelGui(push2, MouseButtonEvent(true));
        RoutePanelGui(push2, MouseButtonEvent(false));
        var latchPassed = latchSurvivesUp && secondLatch && plainClickReleases &&
            emitted.Count == 4 && emitted[3] is Command.Button { n: 2, target: 0 };
        Check("3.2.2", "latch", latchPassed, emitted.Count + "/4");
    }

    private void RunCords()
    {
        LoadManual();
        var cords = Node<Cords>("Cords");
        var cordList = Node<CordList>("CordList");
        var panel = Node<PanelView>("Panel");
        if (cords.Size.X <= 0) cords.Size = panel.Size.X > 0 ? panel.Size : new Vector2(1000, (float)(1000 / PanelLayout.PanelAspect));
        var results = new List<bool>();
        Activate(cordList.AddButton);
        var first = cords.CordsState.Single().id;
        BeginTrayDrag(cords, first, CordSide.A);
        RoutePanelGuiAt(cords, MouseButtonEvent(false), panel.Holes[_layout.Holes[0].Id].GetGlobalRect().GetCenter());
        results.Add(cords.LastDropResolution is DropResolution.Replace);

        RoutePanelGui(panel.Holes[_layout.Holes[0].Id], MouseButtonEvent(true));
        RoutePanelGuiAt(cords, MouseButtonEvent(false), panel.Holes[_layout.Holes[0].Id].GetGlobalRect().GetCenter());
        results.Add(cords.LastDropResolution is DropResolution.Noop);

        RoutePanelGui(panel.Holes[_layout.Holes[0].Id], MouseButtonEvent(true));
        var tray = cords.GetGlobalTransformWithCanvas() * new Vector2(cords.Size.X / 2, cords.Size.Y - 12);
        RoutePanelGuiAt(cords, MouseButtonEvent(false), tray);
        results.Add(cords.LastDropResolution is DropResolution.Replace && cords.TrayGripCount == 2);

        BeginTrayDrag(cords, first, CordSide.A);
        RoutePanelGuiAt(cords, MouseButtonEvent(false), panel.Holes[_layout.Holes[0].Id].GetGlobalRect().GetCenter());
        results.Add(cords.LastDropResolution is DropResolution.Replace);

        BeginTrayDrag(cords, first, CordSide.B);
        RoutePanelGuiAt(cords, MouseButtonEvent(false), new Vector2(-100, -100));
        results.Add(cords.LastDropResolution is DropResolution.Cancelled { Reason: DropCancelReason.Outside });

        BeginTrayDrag(cords, first, CordSide.B);
        RoutePanelGui(cords, KeyEvent(Key.Escape, true));
        results.Add(cords.LastDropResolution is DropResolution.Cancelled { Reason: DropCancelReason.Cancel });

        var second = RequireAdded(cords.AddFreeCord());
        cords.Replace(new EndpointRef(second, CordSide.A), new CordEnd.Hole(_layout.Holes[1].Id));
        BeginTrayDrag(cords, first, CordSide.B);
        RoutePanelGuiAt(cords, MouseButtonEvent(false), panel.Holes[_layout.Holes[1].Id].GetGlobalRect().GetCenter());
        results.Add(cords.LastDropResolution is DropResolution.Cancelled { Reason: DropCancelReason.Occupied });
        Check("3.2.5", "drag", results.All(value => value), results.All(value => value)
            ? results.Count + "/" + results.Count
            : string.Join("", results.Select(value => value ? "1" : "0")));

        var touchEndpoint = new EndpointRef(first, CordSide.B);
        var touchStarted = cords.BeginTouch(touchEndpoint, _layout.Terminals[0].Id) is TouchStartResult.Started;
        var secondTouchSuppressed = cords.BeginTouch(touchEndpoint, _layout.Terminals[1].Id) is TouchStartResult.NotFree;
        var touchReleased = cords.EndTouch() is ReplacementResult.Committed &&
            cords.CordsState.Single(cord => cord.id == first).b is CordEnd.Free;
        var touchChecks = (touchStarted ? 1 : 0) + (secondTouchSuppressed ? 1 : 0) + (touchReleased ? 1 : 0);
        Check("3.2.5", "touch", touchChecks == 3, touchChecks + "/3");

        LoadDemo("VI-TICTACTOE");
        var state = _session.CurrentMachine!.Snapshot();
        var slots = CordModel.FreeTraySlots(state.cords);
        var renderedFreeEnds = 0;
        var trayRendered = true;
        if (_boot.CurrentStage3D is { } stage3D)
        {
            var records = cords.Project(state.cords).ToDictionary(record => record.Id);
            foreach (var slot in slots)
            {
                var particles = stage3D.CordMeshes.Lay.Particles(slot.Endpoint.Cord);
                var actual = slot.Endpoint.Side == CordSide.A ? particles[0] : particles[^1];
                var record = records[slot.Endpoint.Cord];
                var point = slot.Endpoint.Side == CordSide.A ? record.A : record.B;
                if (actual == new Vector3(point.X, point.Y, (float)TactileTheme.TaperPinStub.Value))
                    renderedFreeEnds++;
            }
            trayRendered = stage3D.Tray.FindChild("TrayStrip", false, false) is MeshInstance3D;
        }
        else renderedFreeEnds = slots.Count;
        var freeEndsPassed = slots.Count == 2 && renderedFreeEnds == slots.Count && trayRendered;
        Check(
            "3.2.5",
            "free-ends",
            freeEndsPassed,
            _boot.CurrentStage3D is null
                ? slots.Count.ToString()
                : $"{slots.Count} rendered={renderedFreeEnds}/{slots.Count} tray={(trayRendered ? 1 : 0)}");
        var trayInState = state.cords.Any(cord => cord.a.GetType().Name.Contains("Tray", StringComparison.Ordinal) ||
            cord.b.GetType().Name.Contains("Tray", StringComparison.Ordinal));
        Check("3.2.5", "tray-not-in-state", !trayInState, trayInState ? "1" : "0");
    }

    private void RunLamps()
    {
        var lamps = Node<Lamps>("Lamps");
        var state = _session.CurrentMachine!.Snapshot();
        lamps.Render(state);
        var linear = true;
        for (var index = 0; index < 6; index++)
        {
            linear &= lamps.Levels[index] == state.outLamps[index].milli / 1000.0;
            linear &= lamps.Levels[index + 6] == state.indLamps[index].milli / 1000.0;
        }
        Check("3.2.7", "lenses", lamps.LensCount == 12 && linear, lamps.LensCount + "/12");

        var binary = 0;
        lamps.Render(state with { railMv = 13_000 });
        if (lamps.JewelLit) binary++;
        lamps.Render(state with { railMv = 0 });
        if (!lamps.JewelLit) binary++;
        lamps.Render(state with { railMv = 13_000 });
        if (lamps.JewelLit) binary++;
        Check("3.2.7", "jewel-binary", binary == 3, binary + "/3");
    }

    private void RunGeometry()
    {
        if (_boot.CurrentStage3D is { } stage3D)
        {
            RunGeometry3D(stage3D);
            return;
        }
        var stage = Node<Stage>("Stage2D");
        var panel = stage.Surface;
        var ratios = new List<double>();
        var holeTargets = 0;
        stage.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.TopLeft);
        foreach (var size in new[] { new Vector2(1440, 900), new Vector2(1920, 1080) })
        {
            stage.Size = size;
            stage.SetView("fit");
            ratios.Add(panel.Size.X / panel.Size.Y);
            stage.SetView("wire");
            holeTargets += panel.Holes.Values.Count(hole => hole.Size.X * panel.Scale.X >= 24 && hole.Size.Y * panel.Scale.Y >= 24);
        }
        Check("3.2.9", "aspect", ratios.All(ratio => ratio is >= 1.78 and <= 1.82), ratios[1].ToString("0.00"));
        Check("3.2.9", "edges", Math.Abs(_layout.Plates[0].X + _layout.Plates[0].Width - 0.716) < 0.01 &&
            Math.Abs(_layout.Plates[1].X - 0.728) < 0.01, "2/2");
        var relayXs = _layout.Controls.Where(control => control.Kind == "relay-crossbar").Select(control => control.X).ToArray();
        var pitches = relayXs.Zip(relayXs.Skip(1), (left, right) => right - left).ToArray();
        Check("3.2.9", "pitch", relayXs.Length == 6 &&
            pitches.All(pitch => Math.Abs(pitch - pitches[0]) * 1920 < 1), "6/6");

        LoadManual();
        var cords = Node<Cords>("Cords");
        var cord = RequireAdded(cords.AddFreeCord());
        cords.Replace(new EndpointRef(cord, CordSide.A), new CordEnd.Hole(_layout.Holes[0].Id));
        cords.Replace(new EndpointRef(cord, CordSide.B), new CordEnd.Hole(_layout.Holes[1].Id));
        var line = cords.GetChildren().OfType<Line2D>().Single(candidate => !candidate.IsQueuedForDeletion());
        var endpoints = line.Points.Length == 2 &&
            line.Points[0].DistanceTo(panel.HoleCenter(_layout.Holes[0].Id)) <= 1 &&
            line.Points[1].DistanceTo(panel.HoleCenter(_layout.Holes[1].Id)) <= 1;
        Check("3.2.9", "endpoints", endpoints, endpoints ? "2/2" : "0/2");
        Check("3.2.9", "hole-target", holeTargets == 784, (holeTargets / 2) + "/392");
        var palette = new[]
        {
            PanelTheme.ConsoleTeal == Color.FromHtml("62979a"),
            PanelTheme.ConsoleDark == Color.FromHtml("24241f"),
            PanelTheme.ConsoleCream == Color.FromHtml("e6dfc7"),
            PanelTheme.ConsoleRed == Color.FromHtml("a9473d"),
            PanelTheme.ConsoleRedLit == Color.FromHtml("d65a4b"),
        };
        Check("3.2.9", "palette", palette.All(value => value), palette.Count(value => value) + "/5");
        var controls = Node<Controls>("Controls");
        Check("3.2.9", "styled-controls", controls.Buttons.All(button => button.Flat),
            controls.Buttons.Count(button => button.Flat) + "/" + controls.Buttons.Count);
    }

    private void RunGeometry3D(Stage3D stage)
    {
        var panel = stage.Surface;
        var viewport = stage.PanelViewport;
        var ratios = new List<double>();
        var holeTargets = new List<int>();
        var minimumHoleExtents = new List<float>();
        var panelBounds = 0;
        var endpointChecks = 0;
        var rectMatches = 0;

        LoadManual();
        var cords = Node<Cords>("Cords");
        var cord = RequireAdded(cords.AddFreeCord());
        cords.Replace(new EndpointRef(cord, CordSide.A), new CordEnd.Hole(_layout.Holes[0].Id));
        cords.Replace(new EndpointRef(cord, CordSide.B), new CordEnd.Hole(_layout.Holes[1].Id));
        var line = cords.GetChildren().OfType<Line2D>().Single(candidate => !candidate.IsQueuedForDeletion());
        var sizes = new[] { new Vector2I(2880, 1600), new Vector2I(1440, 800) };
        cords.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.TopLeft);
        foreach (var size in sizes)
        {
            viewport.Size = size;
            panel.Size = size;
            cords.Size = size;
            cords._Notification((int)Control.NotificationResized);
            stage.SetView("wire");
            ratios.Add(panel.Size.X / panel.Size.Y);
            holeTargets.Add(panel.Holes.Values.Count(hole => hole.Size.X >= 24 && hole.Size.Y >= 24));
            minimumHoleExtents.Add(panel.Holes.Values.Min(hole => Math.Min(hole.Size.X, hole.Size.Y)));
            if (panel.Position == Vector2.Zero && panel.Size.X <= viewport.Size.X && panel.Size.Y <= viewport.Size.Y)
                panelBounds++;
            if (line.Points.Length == 2 &&
                line.Points[0].DistanceTo(panel.HoleCenter(_layout.Holes[0].Id)) <= 1 &&
                line.Points[1].DistanceTo(panel.HoleCenter(_layout.Holes[1].Id)) <= 1)
                endpointChecks += 2;
            if (size == sizes[0])
            {
                var frame = new PanelFrame(0, 0, size.X, size.Y);
                foreach (var hole in _layout.Holes)
                {
                    var live = panel.Holes[hole.Id].GetGlobalRect();
                    var expected = _layout.HoleRect(hole.Id, frame);
                    if (Math.Abs(live.Position.X - expected.X) <= 0.01 &&
                        Math.Abs(live.Position.Y - expected.Y) <= 0.01 &&
                        Math.Abs(live.Size.X - expected.Width) <= 0.01 &&
                        Math.Abs(live.Size.Y - expected.Height) <= 0.01)
                        rectMatches++;
                }
            }
        }

        Check("3.2.9a", "aspect", ratios.All(ratio => ratio is >= 1.78 and <= 1.82), ratios[^1].ToString("0.00"));
        Check("3.2.9a", "edges", Math.Abs(_layout.Plates[0].X + _layout.Plates[0].Width - 0.716) < 0.01 &&
            Math.Abs(_layout.Plates[1].X - 0.728) < 0.01, "2/2");
        var relayXs = _layout.Controls.Where(control => control.Kind == "relay-crossbar").Select(control => control.X).ToArray();
        var pitches = relayXs.Zip(relayXs.Skip(1), (left, right) => right - left).ToArray();
        Check("3.2.9a", "pitch", relayXs.Length == 6 &&
            sizes.All(size => pitches.All(pitch => Math.Abs(pitch - pitches[0]) * size.X < 1)), "6/6");
        Check("3.2.9a", "endpoints", endpointChecks == 4, endpointChecks + "/4");
        Check("3.2.9a", "hole-target", holeTargets[0] == 392 &&
            Math.Abs(minimumHoleExtents[1] - 15.12f) <= 0.01f,
            "shipped=" + holeTargets[0] + "/392 temp-observation=" + minimumHoleExtents[1].ToString("0.00") + "px");
        Check("3.2.9a", "panel-bounds", panelBounds == 2, panelBounds + "/2");
        var palette = new[]
        {
            PanelTheme.ConsoleTeal == Color.FromHtml("62979a"),
            PanelTheme.ConsoleDark == Color.FromHtml("24241f"),
            PanelTheme.ConsoleCream == Color.FromHtml("e6dfc7"),
            PanelTheme.ConsoleRed == Color.FromHtml("a9473d"),
            PanelTheme.ConsoleRedLit == Color.FromHtml("d65a4b"),
        };
        Check("3.2.9a", "palette", palette.All(value => value), palette.Count(value => value) + "/5");
        var controls = Node<Controls>("Controls");
        Check("3.2.9a", "styled-controls", controls.Buttons.All(button => button.Flat),
            controls.Buttons.Count(button => button.Flat) + "/" + controls.Buttons.Count);
        Check("3.2.15", "rects-match", rectMatches == 392, rectMatches + "/392");

        viewport.Size = new Vector2I((int)TactileTheme.SubViewportSize.Value.X, (int)TactileTheme.SubViewportSize.Value.Y);
        panel.Size = TactileTheme.SubViewportSize.Value;
        cords.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
    }

    private void RunManual()
    {
        LoadManual();
        var cords = Node<Cords>("Cords");
        var picker = Node<Picker>("Picker");
        var cordList = Node<CordList>("CordList");
        var controls = Node<Controls>("Controls");
        if (picker.Size.X <= 0) picker.Size = new Vector2(288, 572);
        if (cordList.Size.X <= 0) cordList.Size = new Vector2(248, 572);
        var fixture = FixtureLoader.LoadFixture(_source, "conformance/fixtures/A/MM-RLY-CHECK.fixture.json");
        foreach (var wire in fixture.cords)
        {
            Bound();
            Activate(cordList.AddButton);
            var id = cords.CordsState.Max(cord => cord.id);
            PressChoice(picker, wire.a.id);
            var b = cordList.EndpointButton(id, CordSide.B) ?? throw new InvalidOperationException("acceptance: missing cord B button");
            b.EmitSignal(BaseButton.SignalName.Pressed);
            PressChoice(picker, wire.b.id);
        }
        AdvanceBy(100);
        var state = _session.CurrentMachine!.Snapshot();
        var exactWires = 0;
        for (var index = 0; index < fixture.cords.Count && index < state.cords.Length; index++)
        {
            var cord = state.cords[index];
            var wire = fixture.cords[index];
            if (cord.id == index && cord.a is CordEnd.Hole a && a.hole == wire.a.id &&
                cord.b is CordEnd.Hole b && b.hole == wire.b.id) exactWires++;
        }
        Check("3.2.10", "wires", exactWires == 13, exactWires + "/13");

        FindButton(controls, "power", null).EmitSignal(BaseButton.SignalName.Pressed);
        AdvanceBy(200_000);
        state = _session.CurrentMachine!.Snapshot();
        var first = state.outLamps[0].milli >= 500 && state.outLamps[1].milli < 500 &&
            state.outLamps[2].milli >= 500 && state.outLamps[3].milli < 500;
        RoutePanelGui(FindButton(controls, "pushbutton", 1), MouseButtonEvent(true));
        AdvanceBy(230_000);
        state = _session.CurrentMachine!.Snapshot();
        var second = state.outLamps[0].milli < 500 && state.outLamps[1].milli >= 500 &&
            state.outLamps[2].milli < 500 && state.outLamps[3].milli >= 500;
        var lampStates = (first ? 1 : 0) + (second ? 1 : 0);
        Check("3.2.10", "lamp-states", lampStates == 2, lampStates + "/2");
        Check("3.2.10", "library-unchanged", _library.Demos.Count == 17, _library.Demos.Count.ToString());
    }

    private void RunKeyboard()
    {
        var controls = Node<Controls>("Controls");
        var panelControls = controls.Buttons.Cast<Control>().Concat(controls.Relays).Append(controls.Dial).ToArray();
        var focused = 0;
        foreach (var control in panelControls)
        {
            control.GrabFocus();
            if (control.HasFocus()) focused++;
        }
        Check("3.2.11", "focus", focused == 21, focused + "/21");

        var emitted = new List<Command>();
        controls.Emitted += emitted.Add;
        for (var section = 1; section <= 6; section++)
        {
            EmitGui(FindButton(controls, "pushbutton", section), KeyEvent(Key.Space, true));
            EmitGui(controls.Relays[section - 1], KeyEvent(Key.Home, true));
        }
        emitted.Clear();
        RoutePanelGui(controls.Relays[^1], KeyEvent(Key.Escape, true));
        var releases = emitted.Count(command => command is Command.Button { target: 0 } or Command.RelayRelease);
        Check("3.2.11", "release-on-escape", releases == 12, releases + "/12");

        emitted.Clear();
        var push = FindButton(controls, "pushbutton", 1);
        RoutePanelGui(push, KeyEvent(Key.Space, true));
        RoutePanelGui(push, KeyEvent(Key.Space, false));
        RoutePanelGui(controls.Relays[0], KeyEvent(Key.Pageup, true));
        RoutePanelGui(controls.Relays[0], KeyEvent(Key.Pageup, false));
        RoutePanelGui(controls.Dial, KeyEvent(Key.Up, true));
        Check("3.2.11", "pointerless", emitted.Count == 7, emitted.Count + "/7");

        emitted.Clear();
        RoutePanelGui(push, MouseButtonEvent(true));
        RoutePanelGui(controls.Relays[0], MouseButtonEvent(true, controls.Relays[0].Size.X));
        RoutePanelGui(controls.Dial, MouseButtonEvent(true, controls.Dial.Size.X));
        emitted.Clear();
        controls._Notification((int)NotificationApplicationFocusOut);
        var focusLossReleases = emitted.Count(command => command is Command.Button { target: 0 } or Command.RelayRelease or Command.DialRelease);
        Check("3.2.11", "focus-loss", focusLossReleases == 3, focusLossReleases + "/3");

        emitted.Clear();
        var push2 = FindButton(controls, "pushbutton", 2);
        var shiftSpace = KeyEvent(Key.Space, true);
        shiftSpace.ShiftPressed = true;
        RoutePanelGui(push, ShiftClick(true));
        RoutePanelGui(push, ShiftClick(false));
        RoutePanelGui(push2, shiftSpace);
        var latched = emitted.Count == 2;
        push2.ReleaseFocus();
        controls._Notification((int)NotificationApplicationFocusOut);
        var latchSurvivesFocusLoss = latched && emitted.Count == 2;
        RoutePanelGui(controls.Relays[0], KeyEvent(Key.Escape, true));
        var escapeReleases = emitted.Skip(2).Count(command => command is Command.Button { target: 0 });
        Check("3.2.11", "latch-escape", latchSurvivesFocusLoss && escapeReleases == 2,
            (latchSurvivesFocusLoss ? "held," : "dropped,") + escapeReleases + "/2");

        LoadManual();
        var cordList = Node<CordList>("CordList");
        var picker = Node<Picker>("Picker");
        Activate(cordList.AddButton);
        var endpoint = cordList.EndpointButton(0, CordSide.A);
        var cancel = picker.Choices.FirstOrDefault(button => button.Text == "Cancel");
        cancel?.GrabFocus();
        if (cancel is not null) RouteGui(cancel, KeyEvent(Key.Escape, true));
        var cancelledFocus = endpoint is not null && !picker.IsOpen && endpoint.HasFocus();
        endpoint?.EmitSignal(BaseButton.SignalName.Pressed);
        PressChoice(picker, _layout.Holes[0].Id);
        AdvanceBy(100);
        var rebuiltEndpoint = cordList.EndpointButton(0, CordSide.A);
        var rebuiltFocus = rebuiltEndpoint is not null && rebuiltEndpoint.HasFocus();
        var chromeKeyboard = endpoint is not null && picker.Choices.Count > 2 && cancelledFocus && rebuiltFocus &&
            cordList.ScrollDownButton.FocusMode == Control.FocusModeEnum.All && picker.ScrollDownButton.FocusMode == Control.FocusModeEnum.All;
        var chromeDetail = string.Join("", new[]
        {
            endpoint is not null, picker.Choices.Count > 2, cancelledFocus, rebuiltFocus,
            cordList.ScrollDownButton.FocusMode == Control.FocusModeEnum.All,
            picker.ScrollDownButton.FocusMode == Control.FocusModeEnum.All,
        }.Select(value => value ? "1" : "0"));
        Check("3.2.11", "chrome-keyboard", chromeKeyboard, chromeKeyboard ? "6/6" : chromeDetail);

        GetViewport().GuiGetFocusOwner()?.ReleaseFocus();
        var panel = Node<PanelView>("Panel");
        var stageFocusChecks = 0;
        if (_boot.CurrentStage2D is { } stage)
        {
            controls.Relays[0].GrabFocus();
            var pan = stage.Pan;
            stage._GuiInput(KeyEvent(Key.Left, true));
            stage._UnhandledKeyInput(KeyEvent(Key.Escape, true));
            var stageReleasedFocus = GetViewport().GuiGetFocusOwner() is null;
            stage._UnhandledKeyInput(KeyEvent(Key.W, true));
            stageFocusChecks = (stage.Pan == pan ? 1 : 0) + (stage.FocusMode == Control.FocusModeEnum.None ? 1 : 0) +
                (panel.FocusMode == Control.FocusModeEnum.None ? 1 : 0) + (stageReleasedFocus ? 1 : 0) +
                (stage.View == "wire" ? 1 : 0);
        }
        else if (_boot.CurrentStage3D is { } stage3D)
        {
            controls.Relays[0].GrabFocus();
            var pose = stage3D.Camera.CurrentPose;
            stage3D.Camera._UnhandledKeyInput(KeyEvent(Key.Left, true));
            var cameraStayedPut = stage3D.Camera.CurrentPose == pose;
            stage3D.Camera._UnhandledKeyInput(KeyEvent(Key.Escape, true));
            var stageReleasedFocus = stage3D.PanelViewport.GuiGetFocusOwner() is null;
            stage3D.Camera._UnhandledKeyInput(KeyEvent(Key.W, true));
            var wirePose = stage3D.Camera.CurrentPose.ElevationDeg == TactileTheme.CameraWireElevationDeg.Value &&
                stage3D.Camera.CurrentPose.DollyW == TactileTheme.CameraWireDollyW.Value;
            stageFocusChecks = (cameraStayedPut ? 1 : 0) +
                (Input.MouseMode == Input.MouseModeEnum.Visible ? 1 : 0) +
                (panel.FocusMode == Control.FocusModeEnum.None ? 1 : 0) +
                (stageReleasedFocus ? 1 : 0) + (wirePose ? 1 : 0);
        }
        Check("3.2.11", "stage-focus", stageFocusChecks == 5, stageFocusChecks + "/5");

        var preferences = Node<Preferences>("Preferences");
        var previous = preferences.ReduceMotion;
        preferences.SetReduceMotion(false);
        Node<HelpCredits>("HelpCredits").ToggleReduceMotion();
        var reduced = preferences.ReduceMotion;
        if (_boot.CurrentStage3D is { } reducedStage)
        {
            reducedStage.Camera.ResetPose();
            reducedStage.Camera.WirePose();
            reduced &= reducedStage.Camera.CurrentPose.ElevationDeg == TactileTheme.CameraWireElevationDeg.Value &&
                reducedStage.Camera.CurrentPose.DollyW == TactileTheme.CameraWireDollyW.Value;
        }
        Check("3.2.11", "reduce-motion", reduced, reduced ? "1" : "0");
        preferences.SetReduceMotion(previous);
    }

    private void RunRenderer()
    {
        var method = RenderingServer.GetCurrentRenderingMethod();
        var driver = RenderingServer.GetCurrentRenderingDriverName();
        Check("3.2.26", "method", method == "forward_plus", method);
        Check("3.2.26", "driver", driver == "metal", driver);
    }

    private void RunHeadless3D()
    {
        var stage = _boot.CurrentStage3D;
        if (stage is null)
        {
            Check("3.2.27", "tree", false, "missing");
            Check("3.2.27", "subviewport", false, "missing");
            Check("3.2.20", "pickable-areas", false, "0");
            return;
        }
        var viewport = stage.PanelViewport ?? throw new InvalidOperationException("acceptance: missing panel viewport");
        var inputSurface = stage.InputSurface ?? throw new InvalidOperationException("acceptance: missing input surface");
        GD.Print("headless3d nodes=" + string.Join(",",
            stage.Name,
            stage.Camera.Name,
            stage.World.Name,
            stage.PanelQuad.Name,
            viewport.Name,
            stage.Surface.Name,
            inputSurface.Name,
            inputSurface.GetNode<CollisionShape3D>("CollisionShape3D").Name,
            stage.CordMeshes.Name,
            stage.Tray.Name,
            stage.KeyLight.Name,
            stage.Case.Name,
            stage.PopOuts.Name));
        var tree = _boot.CurrentStage2D is null &&
            stage.Camera is not null && stage.World is not null && stage.PanelQuad is not null &&
            stage.CordMeshes is not null && stage.Tray is not null && stage.KeyLight is not null &&
            stage.Case is not null && stage.PopOuts is not null &&
            viewport.FindChild("Panel", false, false) is PanelView &&
            inputSurface.FindChild("CollisionShape3D", false, false) is CollisionShape3D;
        Check("3.2.27", "tree", tree, tree ? "Stage3D" : "missing");
        var configured = viewport.Size == new Vector2I(2880, 1600) &&
            (int)viewport.RenderTargetUpdateMode == 2 &&
            (int)viewport.RenderTargetClearMode == 0 &&
            viewport.UseHdr2D;
        Check("3.2.27", "subviewport", configured, configured ? "2880x1600 hdr" : "mismatch");
        var material = stage.PanelQuad?.Mesh is QuadMesh quad ? quad.Material as StandardMaterial3D : null;
        var unshaded = material is not null &&
            material.ShadingMode == StandardMaterial3D.ShadingModeEnum.Unshaded &&
            material.AlbedoTexture is not null;
        Check("3.2.27", "quad-material", unshaded, unshaded ? "unshaded" : "mismatch");
        var areas = Descendants(stage).Count(node => node is Area3D area && area.InputRayPickable);
        Check("3.2.20", "pickable-areas", areas == 1, areas.ToString());
        _boot.LoadDemo("VI-TICTACTOE");
        var cordIds = _session.CurrentMachine!.Snapshot().cords.Select(cord => cord.id).ToArray();
        if (cordIds.Length != 72)
            throw new InvalidOperationException("acceptance: mesh-equivalence demo has " + cordIds.Length + " cords");
        RunCordMeshEquivalence(stage, cordIds[0]);
    }

    private void RunBudget()
    {
        _boot.LoadDemo("VI-TICTACTOE");
        var stage = _boot.CurrentStage3D ?? throw new InvalidOperationException("acceptance: missing Stage3D");
        var ids = _session.CurrentMachine!.Snapshot().cords.Select(cord => cord.id).ToArray();
        if (ids.Length != 72) throw new InvalidOperationException("acceptance: budget demo has " + ids.Length + " cords");
        var times = new List<double>();
        ArmFramed("3.2.18", () =>
        {
            var timer = Stopwatch.StartNew();
            foreach (var id in ids) stage.CordMeshes.Rebuild(id);
            timer.Stop();
            times.Add(timer.Elapsed.TotalMilliseconds);
            if (times.Count < 600) return;

            var sorted = times.Order().ToArray();
            var mean = times.Average();
            var p95 = sorted[(int)Math.Ceiling(sorted.Length * 0.95) - 1];
            var viewport = GetWindow().Size;
            Check(
                "3.2.18",
                "rebuild-ms",
                viewport == new Vector2I(1440, 900) && p95 <= 4.0,
                $"mean={mean:F6} p95={p95:F6} viewport={viewport.X}x{viewport.Y} framed=Loop");
            _framedStep = null;
            Finish();
        });
    }

    private void RunCordMeshEquivalence(Stage3D stage, int cordId)
    {
        var particles = stage.CordMeshes.Lay.Particles(cordId) as Vector3[] ??
            throw new InvalidOperationException("acceptance: cord particles are not mutable test storage");
        var saved = (Vector3[])particles.Clone();
        particles[1] = particles[0];
        try
        {
            stage.CordMeshes.Rebuild(cordId);
            var instance = stage.CordMeshes.GetNode<MeshInstance3D>("Cord_" + cordId);
            var mesh = instance.Mesh as ImmediateMesh ??
                throw new InvalidOperationException("acceptance: cord did not build an ImmediateMesh");
            using var reference = new ImmediateMesh();
            reference.SurfaceBegin(Mesh.PrimitiveType.Triangles, mesh.SurfaceGetMaterial(0));
            for (var index = 0; index < particles.Length - 1; index++)
                ReferenceTubeSegment(particles[index], particles[index + 1],
                    (float)TactileTheme.CordRadius.Value, reference);
            reference.SurfaceEnd();
            reference.SurfaceBegin(Mesh.PrimitiveType.Triangles, mesh.SurfaceGetMaterial(1));
            var first = particles[0];
            var last = particles[^1];
            ReferenceTubeSegment(new Vector3(first.X, first.Y, 0), first,
                (float)(TactileTheme.CordRadius.Value * 0.5), reference);
            ReferenceTubeSegment(new Vector3(last.X, last.Y, 0), last,
                (float)(TactileTheme.CordRadius.Value * 0.5), reference);
            reference.SurfaceEnd();

            var actualVertices = new List<Vector3>();
            var actualNormals = new List<Vector3>();
            var expectedVertices = new List<Vector3>();
            var expectedNormals = new List<Vector3>();
            var actualBodyVertices = mesh.SurfaceGetArrays(0)[(int)Mesh.ArrayType.Vertex].AsVector3Array().Length;
            var expectedBodyVertices = reference.SurfaceGetArrays(0)[(int)Mesh.ArrayType.Vertex].AsVector3Array().Length;
            var actualPinVertices = mesh.SurfaceGetArrays(1)[(int)Mesh.ArrayType.Vertex].AsVector3Array().Length;
            var expectedPinVertices = reference.SurfaceGetArrays(1)[(int)Mesh.ArrayType.Vertex].AsVector3Array().Length;
            var requiredPinVertices = 2 * TactileTheme.TubeSides.Value * 6;
            for (var surfaceIndex = 0; surfaceIndex < mesh.GetSurfaceCount(); surfaceIndex++)
            {
                ReadSurface(mesh, surfaceIndex, actualVertices, actualNormals);
                ReadSurface(reference, surfaceIndex, expectedVertices, expectedNormals);
            }
            var coverage = first.Z != 0 && last.Z != 0 && actualBodyVertices > 0 && expectedBodyVertices > 0 &&
                actualPinVertices == requiredPinVertices && expectedPinVertices == requiredPinVertices;
            var exact = mesh.GetSurfaceCount() == 2 && reference.GetSurfaceCount() == 2 && coverage &&
                actualVertices.Count == expectedVertices.Count && actualNormals.Count == expectedNormals.Count &&
                actualVertices.Zip(expectedVertices).All(pair => VectorBitsEqual(pair.First, pair.Second)) &&
                actualNormals.Zip(expectedNormals).All(pair => VectorBitsEqual(pair.First, pair.Second));
            Check("3.2.18", "cord-mesh-equivalence", exact,
                $"surfaces={mesh.GetSurfaceCount()},vertices={actualVertices.Count}/{expectedVertices.Count}," +
                $"body={actualBodyVertices}/{expectedBodyVertices},pins={actualPinVertices}/{expectedPinVertices}/" +
                $"{requiredPinVertices},endpoint-z={first.Z}/{last.Z},zero-length=1");
        }
        finally
        {
            Array.Copy(saved, particles, saved.Length);
            stage.CordMeshes.Rebuild(cordId);
        }
    }

    private static void ReferenceTubeSegment(
        Vector3 a,
        Vector3 b,
        float radius,
        ImmediateMesh mesh)
    {
        var tangent = (b - a).Normalized();
        if (tangent == Vector3.Zero) return;
        var side = tangent.Cross(Vector3.Back);
        if (side == Vector3.Zero) side = tangent.Cross(Vector3.Up);
        side = side.Normalized();
        var up = side.Cross(tangent).Normalized();
        var sides = TactileTheme.TubeSides.Value;
        for (var radial = 0; radial < sides; radial++)
        {
            var angleA = Math.Tau * radial / sides;
            var angleB = Math.Tau * (radial + 1) / sides;
            var normalA = side * (float)Math.Cos(angleA) + up * (float)Math.Sin(angleA);
            var normalB = side * (float)Math.Cos(angleB) + up * (float)Math.Sin(angleB);
            ReferenceTriangle(a + normalA * radius, normalA, b + normalA * radius, normalA,
                b + normalB * radius, normalB, mesh);
            ReferenceTriangle(a + normalA * radius, normalA, b + normalB * radius, normalB,
                a + normalB * radius, normalB, mesh);
        }
    }

    private static void ReferenceTriangle(
        Vector3 a,
        Vector3 normalA,
        Vector3 b,
        Vector3 normalB,
        Vector3 c,
        Vector3 normalC,
        ImmediateMesh mesh)
    {
        mesh.SurfaceSetNormal(normalA);
        mesh.SurfaceAddVertex(a);
        mesh.SurfaceSetNormal(normalB);
        mesh.SurfaceAddVertex(b);
        mesh.SurfaceSetNormal(normalC);
        mesh.SurfaceAddVertex(c);
    }

    private static void ReadSurface(
        ImmediateMesh mesh,
        int surfaceIndex,
        List<Vector3> vertices,
        List<Vector3> normals)
    {
        var arrays = mesh.SurfaceGetArrays(surfaceIndex);
        vertices.AddRange(arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array());
        normals.AddRange(arrays[(int)Mesh.ArrayType.Normal].AsVector3Array());
    }

    private static bool VectorBitsEqual(Vector3 a, Vector3 b) =>
        BitConverter.SingleToInt32Bits(a.X) == BitConverter.SingleToInt32Bits(b.X) &&
        BitConverter.SingleToInt32Bits(a.Y) == BitConverter.SingleToInt32Bits(b.Y) &&
        BitConverter.SingleToInt32Bits(a.Z) == BitConverter.SingleToInt32Bits(b.Z);

    private void RunHandles()
    {
        _boot.LoadDemo("III-RELAYNOT");
        var state = _session.CurrentMachine!.Snapshot();
        var cords = Node<Cords>("Cords");
        var records = cords.Project(state.cords).ToDictionary(record => record.Id);
        var panel = _boot.CurrentPanel;
        var stage = _boot.CurrentStage3D ?? throw new InvalidOperationException("acceptance: missing Stage3D");
        var poses = new[]
        {
            new Pose(TactileTheme.CameraElevationDeg.Value.X, TactileTheme.CameraAzimuthDeg.Value.X, TactileTheme.CameraDefaultPose.Value.DollyW),
            new Pose(TactileTheme.CameraElevationDeg.Value.X, 0, TactileTheme.CameraDefaultPose.Value.DollyW),
            new Pose(TactileTheme.CameraElevationDeg.Value.X, TactileTheme.CameraAzimuthDeg.Value.Y, TactileTheme.CameraDefaultPose.Value.DollyW),
            new Pose(TactileTheme.CameraDefaultPose.Value.ElevationDeg, TactileTheme.CameraAzimuthDeg.Value.X, TactileTheme.CameraDefaultPose.Value.DollyW),
            new Pose(TactileTheme.CameraDefaultPose.Value.ElevationDeg, 0, TactileTheme.CameraDefaultPose.Value.DollyW),
            new Pose(TactileTheme.CameraDefaultPose.Value.ElevationDeg, TactileTheme.CameraAzimuthDeg.Value.Y, TactileTheme.CameraDefaultPose.Value.DollyW),
            new Pose(TactileTheme.CameraElevationDeg.Value.Y, TactileTheme.CameraAzimuthDeg.Value.X, TactileTheme.CameraDefaultPose.Value.DollyW),
            new Pose(TactileTheme.CameraElevationDeg.Value.Y, 0, TactileTheme.CameraDefaultPose.Value.DollyW),
            new Pose(TactileTheme.CameraElevationDeg.Value.Y, TactileTheme.CameraAzimuthDeg.Value.Y, TactileTheme.CameraDefaultPose.Value.DollyW),
        };
        var reached = 0;
        string? firstFailure = null;
        foreach (var pose in poses)
        {
            SetCameraPose(stage.Camera, pose);
            foreach (var cord in state.cords)
            {
                foreach (var side in new[] { CordSide.A, CordSide.B })
                {
                    var target = EndpointTarget(cord, side, panel, cords);
                    var record = records[cord.id];
                    var point = side == CordSide.A ? record.A : record.B;
                    var pin = side == CordSide.A
                        ? stage.CordMeshes.Lay.Particles(cord.id)[0]
                        : stage.CordMeshes.Lay.Particles(cord.id)[^1];
                    var pixel = target.GetGlobalRect().GetCenter();
                    var world = PanelWorldPoint(stage, pixel);
                    var screen = stage.Camera.UnprojectPosition(world);
                    var viewport = GetWindow().Size;
                    var visible = target.IsVisibleInTree() && !stage.Camera.IsPositionBehind(world) &&
                        screen.X >= 0 && screen.X < viewport.X && screen.Y >= 0 && screen.Y < viewport.Y;
                    var hit = QuadInput.QuadPointFromRay(
                        stage.Camera.ProjectRayOrigin(screen),
                        stage.Camera.ProjectRayNormal(screen),
                        stage.PanelQuad.GlobalTransform);
                    var presses = 0;
                    void SawInput(InputEvent input)
                    {
                        if (input is InputEventMouseButton { Pressed: true }) presses++;
                    }
                    target.GuiInput += SawInput;
                    stage.InputSurface.Forward(MouseButtonEvent(true, global: screen), hit);
                    stage.InputSurface.Forward(MouseButtonEvent(false, global: screen), hit);
                    target.GuiInput -= SawInput;
                    var expectedPin = new Vector3(point.X, point.Y, (float)TactileTheme.TaperPinStub.Value);
                    var passed = stage.Camera.CurrentPose == pose &&
                        stage.Camera.Fov == TactileTheme.CameraFovDeg.Value &&
                        visible && presses == 1 && pin == expectedPin;
                    if (passed) reached++;
                    else firstFailure ??=
                        $"cord={cord.id} side={side} pose={pose} visible={visible} presses={presses}";
                }
            }
        }
        var expected = state.cords.Length * 2 * poses.Length;
        Check(
            "3.2.19",
            "grabbable",
            reached == expected,
            reached + "/" + expected + " framed=Loop" + (firstFailure is null ? "" : " first=" + firstFailure));
    }

    private void RunVisuals()
    {
        var stage = _boot.CurrentStage3D ?? throw new InvalidOperationException("acceptance: missing Stage3D");
        Node<Loop>("Loop").ProcessMode = ProcessModeEnum.Disabled;
        var state = _session.CurrentMachine!.Snapshot();
        var off = state with
        {
            railMv = 0,
            outLamps = state.outLamps.Select(lamp => lamp with { milli = 0 }).ToArray(),
            indLamps = state.indLamps.Select(lamp => lamp with { milli = 0 }).ToArray(),
        };
        var on = state with
        {
            railMv = 1,
            outLamps = state.outLamps.Select(lamp => lamp with { milli = 1000 }).ToArray(),
            indLamps = state.indLamps.Select(lamp => lamp with { milli = 1000 }).ToArray(),
        };
        var tempDir = OS.GetTempDir();
        var paths = new[]
        {
            tempDir.PathJoin("minivac-p6-normal.png"),
            tempDir.PathJoin("minivac-p6-wire.png"),
            tempDir.PathJoin("minivac-p6-glow-off.png"),
            tempDir.PathJoin("minivac-p6-glow-on.png"),
        };
        var hashes = new List<string>();
        var phase = 0;
        var settledFrames = 0;
        Configure();
        ArmFramed("P6-visuals", () =>
        {
            if (++settledFrames < 2) return;
            using var image = GetViewport().GetTexture().GetImage();
            var result = image.SavePng(paths[phase]);
            hashes.Add(Ints.fnv1a64(image.GetData()));
            using var capture = global::Godot.FileAccess.Open(paths[phase], global::Godot.FileAccess.ModeFlags.Read);
            var length = capture?.GetLength() ?? 0;
            Check("P6-visuals", "capture-" + phase, result == Error.Ok && length > 0,
                paths[phase] + " bytes=" + length);
            phase++;
            if (phase == paths.Length)
            {
                Check("P6-visuals", "glow-delta", hashes[2] != hashes[3], hashes[2] + "/" + hashes[3]);
                _framedStep = null;
                Finish();
                return;
            }
            settledFrames = 0;
            Configure();
        });

        void Configure()
        {
            if (phase == 0)
            {
                stage.Camera.ResetPose();
                _boot.RenderConsole(state, _nowUs);
            }
            else if (phase == 1)
            {
                stage.Camera.WirePose();
                _boot.RenderConsole(state, _nowUs);
            }
            else if (phase == 2)
            {
                stage.Camera.ResetPose();
                _boot.RenderConsole(off, _nowUs);
            }
            else _boot.RenderConsole(on, _nowUs);
        }
    }

    private static void SetCameraPose(OrbitCamera camera, Pose pose)
    {
        camera.ResetPose();
        var current = camera.CurrentPose;
        camera._UnhandledInput(MouseButtonEvent(true, buttonIndex: MouseButton.Right));
        camera._UnhandledInput(new InputEventMouseMotion
        {
            Relative = new Vector2(
                (float)((pose.AzimuthDeg - current.AzimuthDeg) / TactileTheme.OrbitDegPerPixel.Value),
                (float)((current.ElevationDeg - pose.ElevationDeg) / TactileTheme.OrbitDegPerPixel.Value)),
        });
        camera._UnhandledInput(MouseButtonEvent(false, buttonIndex: MouseButton.Right));
    }

    private static Vector3 PanelWorldPoint(Stage3D stage, Vector2 pixel)
    {
        var mesh = (QuadMesh)stage.PanelQuad.Mesh;
        var viewport = stage.PanelViewport.Size;
        var uv = pixel / new Vector2(viewport.X, viewport.Y);
        var local = new Vector3(
            (uv.X - 0.5f) * mesh.Size.X,
            -(uv.Y - 0.5f) * mesh.Size.Y,
            0);
        return stage.PanelQuad.GlobalTransform * local;
    }

    private void RunTraceEquality()
    {
        Check("3.2.16", "no-loop-node", GetTree().Root.FindChild("Loop", true, false) is null, "1");
        var rootViewport = GetViewport();
        var originalPicking = rootViewport.PhysicsObjectPicking;
        rootViewport.PhysicsObjectPicking = false;
        var flat = ReplayTrace("flat");
        var threeD = ReplayTrace("3d");
        var pickingEnabledIn3D = rootViewport.PhysicsObjectPicking;
        var byteLength = Encoding.UTF8.GetByteCount(flat.Text);
        Check("3.2.16", "bytes-equal", flat.Text == threeD.Text, byteLength.ToString());
        var accepted = flat.Accepted == TraceEqualityScript.Length && threeD.Accepted == TraceEqualityScript.Length;
        Check("3.2.16", "commands-accepted", accepted, flat.Accepted + "/" + TraceEqualityScript.Length);
        Check("3.2.16", "spy-commands", flat.SpyExact && threeD.SpyExact,
            flat.SpyExact && threeD.SpyExact ? "6/6" : "mismatch");
        Check("3.2.16", "command-lines", flat.CommandLinesExact && threeD.CommandLinesExact,
            flat.CommandLinesExact && threeD.CommandLinesExact ? "6/6" : "mismatch");

        _boot.ChangeViewMode("flat");
        var flatStage = _boot.CurrentStage2D ?? throw new InvalidOperationException("acceptance: missing Stage2D");
        flatStage.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.TopLeft);
        flatStage.Size = new Vector2(800, 600);
        flatStage.SetView("wire");
        flatStage.PanBy(new Vector2(10, 10));
        var panel = _boot.CurrentPanel;
        var panelWasTransformed = panel.Scale != Vector2.One || panel.Position != Vector2.Zero;

        LoadDemo("III-RELAYAND");
        _frame.Frame(0);
        _observedCommands.Clear();
        var before = _session.CurrentMachine!.Snapshot();
        GetViewport().GuiGetFocusOwner()?.ReleaseFocus();
        flatStage._UnhandledKeyInput(KeyEvent(Key.F, true));
        var after = _session.CurrentMachine!.Snapshot();
        var beforeCords = before.cords.Select(CordFingerprint).ToArray();
        var afterCords = after.cords.Select(CordFingerprint).ToArray();
        var preserved = after.tick >= before.tick && afterCords.SequenceEqual(beforeCords, StringComparer.Ordinal) &&
            _observedCommands.Count == 0;
        Check("3.2.16", "toggle-preserves-tick", preserved, preserved ? "1" : "0");
        var panelNormalized = panelWasTransformed && panel.Position == Vector2.Zero && panel.Scale == Vector2.One &&
            panel.PivotOffset == Vector2.Zero && panel.Rotation == 0 && panel.Size == TactileTheme.SubViewportSize.Value;
        Check("3.2.16", "toggle-normalizes-panel", panelNormalized, panelNormalized ? "1" : "0");
        var mounted3D = _boot.CurrentStage3D ?? throw new InvalidOperationException("acceptance: missing Stage3D");
        var camera = mounted3D.Camera;
        camera.ResetPose();
        var orbitStart = camera.CurrentPose;
        var altOrbitDown = MouseButtonEvent(true);
        altOrbitDown.AltPressed = true;
        camera._UnhandledInput(altOrbitDown);
        camera._UnhandledInput(new InputEventMouseMotion { Relative = new Vector2(12, 4) });
        var orbitMoved = camera.CurrentPose != orbitStart;
        var altOrbitUp = MouseButtonEvent(false);
        camera._UnhandledInput(altOrbitUp);
        var orbitStop = camera.CurrentPose;
        camera._UnhandledInput(new InputEventMouseMotion { Relative = new Vector2(12, 4) });
        var orbitStopped = camera.CurrentPose == orbitStop;
        camera.ResetPose();
        camera._UnhandledInput(MouseButtonEvent(true, buttonIndex: MouseButton.WheelUp));
        var wheelDollied = camera.CurrentPose.DollyW < TactileTheme.CameraDefaultPose.Value.DollyW;
        camera.ResetPose();
        camera._UnhandledInput(MouseButtonEvent(true, buttonIndex: MouseButton.Middle));
        camera._UnhandledInput(new InputEventMouseMotion { Relative = new Vector2(12, 4) });
        camera._UnhandledInput(MouseButtonEvent(false, buttonIndex: MouseButton.Middle));
        var middlePanned = camera.Target != Vector3.Zero;
        var gestureChecks = new[] { orbitMoved, orbitStopped, wheelDollied, middlePanned };
        Check("3.2.16", "camera-gestures", gestureChecks.All(value => value),
            gestureChecks.Count(value => value) + "/4");

        camera.WirePose();
        camera.DollyBy(-1);
        var wireZoomIn = camera.Fov == TactileTheme.CameraWireFovDeg.Value &&
            camera.CurrentPose.DollyW == TactileTheme.CameraDolly.Value.X;
        camera.DollyBy(1);
        var wireZoomOut = camera.Fov == TactileTheme.CameraWireFovDeg.Value &&
            camera.CurrentPose.DollyW == TactileTheme.CameraWireDollyW.Value;
        camera.PanBy(new Vector2(12, 4));
        var wirePan = camera.Fov == TactileTheme.CameraWireFovDeg.Value;
        camera._UnhandledInput(MouseButtonEvent(true, buttonIndex: MouseButton.Right));
        camera._UnhandledInput(new InputEventMouseMotion { Relative = new Vector2(12, 4) });
        camera._UnhandledInput(MouseButtonEvent(false, buttonIndex: MouseButton.Right));
        var wireOrbit = camera.Fov == TactileTheme.CameraWireFovDeg.Value;
        camera.ResetPose();
        var resetExitsWire = camera.Fov == TactileTheme.CameraFovDeg.Value &&
            camera.CurrentPose == new Pose(
                TactileTheme.CameraDefaultPose.Value.ElevationDeg,
                TactileTheme.CameraDefaultPose.Value.AzimuthDeg,
                TactileTheme.CameraDefaultPose.Value.DollyW);
        var wireNavigation = new[] { wireZoomIn, wireZoomOut, wirePan, wireOrbit, resetExitsWire };
        Check("3.2.16", "wire-navigation", wireNavigation.All(value => value),
            wireNavigation.Count(value => value) + "/5");

        GetViewport().GuiGetFocusOwner()?.ReleaseFocus();
        mounted3D.Camera._UnhandledKeyInput(KeyEvent(Key.F, true));
        var shellKeyToggle = _boot.CurrentStage2D is not null && _observedCommands.Count == 0;
        Check("3.2.16", "shell-key-toggle", shellKeyToggle, shellKeyToggle ? "1" : "0");
        var pickingRestored = pickingEnabledIn3D && !rootViewport.PhysicsObjectPicking;
        rootViewport.PhysicsObjectPicking = originalPicking;
        Check("3.2.16", "flat-picking-restored", pickingRestored, pickingRestored ? "1" : "mismatch");
    }

    private TraceReplay ReplayTrace(string mode)
    {
        _boot.ChangeViewMode(mode);
        LoadDemo("III-RELAYAND");
        _observedCommands.Clear();
        long[] times = [0, 62, 125, 100125, 100187, 100250];
        var expectedLines = new List<string>();
        var accepted = 0;
        for (var frame = 0; frame < times.Length; frame++)
        {
            foreach (var action in TraceEqualityScript.Where(action => action.Frame == frame))
            {
                Bound();
                var before = _session.CurrentMachine!.Snapshot();
                if (Inject("3.2.16", action.Command).ok) accepted++;
                expectedLines.Add(Minivac.Core.Trace.formatCommand(
                    Session.CommandTraceTick(before, action.Command),
                    action.Command));
            }
            Bound();
            _frame.Frame(times[frame]);
        }
        var actualLines = _trace.TraceText.Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Where(line => line.Contains(" > ", StringComparison.Ordinal))
            .ToArray();
        var commands = TraceEqualityScript.Select(action => action.Command).ToArray();
        return new TraceReplay(
            _trace.TraceText,
            accepted,
            _observedCommands.SequenceEqual(commands),
            actualLines.SequenceEqual(expectedLines, StringComparer.Ordinal));
    }

    private void RunPopouts()
    {
        var stage = _boot.CurrentStage3D ?? throw new InvalidOperationException("acceptance: missing Stage3D");
        var roots = Descendants(stage)
            .Where(node => node.Name.ToString() is "Case" or "PopOuts")
            .ToArray();
        var caseRoots = roots.Count(node => node.Name.ToString() == "Case");
        var popoutRoots = roots.Count(node => node.Name.ToString() == "PopOuts");
        Check("3.2.20", "roots", caseRoots == 1 && popoutRoots == 1,
            $"case={caseRoots},popouts={popoutRoots}");
        var popoutIdentities = roots
            .Where(node => node.Name.ToString() == "PopOuts")
            .SelectMany(SelfAndDescendants)
            .Where(node => node.HasMeta("popout_id"))
            .Select(node => node.GetMeta("popout_id").AsString())
            .ToArray();
        var distinctIdentities = popoutIdentities.Distinct(StringComparer.Ordinal).Count();
        var expectedIdentities = Enumerable.Range(1, 6).Select(index => "relay" + index)
            .Concat(Enumerable.Range(1, 6).Select(index => "button" + index))
            .Concat(Enumerable.Range(1, 6).Select(index => "switch" + index))
            .Concat(new[] { "power", "breaker", "dial" })
            .Concat(Enumerable.Range(1, 6).Select(index => "out-lamp-" + index))
            .Concat(Enumerable.Range(1, 6).Select(index => "relay-lamp-" + index))
            .Append("power-jewel")
            .ToHashSet(StringComparer.Ordinal);
        var exactInventory = expectedIdentities.SetEquals(popoutIdentities);
        Check("3.2.20", "inventory",
            popoutIdentities.Length == 34 && distinctIdentities == 34 && exactInventory,
            $"nodes={popoutIdentities.Length},distinct={distinctIdentities}");
        var laterRoots = Descendants(stage)
            .Where(node => node.Name.ToString() is "Case" or "PopOuts" or "CordMeshes")
            .ToArray();
        var colliders = laterRoots.SelectMany(root => SelfAndDescendants(root).Concat(Ancestors(root)))
            .Distinct()
            .Count(node => node is CollisionShape3D or CollisionObject3D);
        Check("3.2.20", "no-colliders", colliders == 0, colliders.ToString());
        var areas = Descendants(stage).Count(node => node is Area3D area && area.InputRayPickable);
        Check("3.2.20", "pickable-areas", areas == 1, areas.ToString());

        var controls = Node<Controls>("Controls");
        RunPopoutInventoryGeometry(stage, controls, expectedIdentities);
        var targets = controls.Buttons.Cast<Control>().Concat(controls.Relays).Append(controls.Dial).ToArray();
        var reached = 0;
        foreach (var target in targets)
        {
            var presses = 0;
            void SawInput(InputEvent input)
            {
                if (input is InputEventMouseButton { Pressed: true }) presses++;
            }
            var wasDisabled = target is BaseButton button && button.Disabled;
            if (target is BaseButton enabled) enabled.Disabled = false;
            target.GuiInput += SawInput;
            RoutePanelGui(target, MouseButtonEvent(true));
            RoutePanelGui(target, MouseButtonEvent(false));
            target.GuiInput -= SawInput;
            if (target is BaseButton restored) restored.Disabled = wasDisabled;
            if (presses == 1) reached++;
        }
        Check("3.2.20", "press-through", targets.Length == 21 && reached == targets.Length,
            reached + "/" + targets.Length);
        RunRaisedHitChecks(stage, controls);
        RunPopoutStateChecks(stage, controls);
        RunPresentationSurfaceChecks(stage);
    }

    private void RunPopoutInventoryGeometry(
        Stage3D stage,
        Controls controls,
        IReadOnlySet<string> expectedIdentities)
    {
        var neutral = _session.CurrentMachine!.Snapshot();
        _boot.RenderConsole(neutral, _nowUs);
        var roots = SelfAndDescendants(stage.PopOuts).OfType<Node3D>()
            .Where(node => node.HasMeta("popout_id"))
            .ToDictionary(node => node.GetMeta("popout_id").AsString(), StringComparer.Ordinal);
        var controlItems = _layout.Controls.ToDictionary(item => item.Id, StringComparer.Ordinal);
        var componentItems = _layout.Components
            .Where(item => item.Kind is "standard-lamp" or "power-jewel")
            .ToDictionary(item => item.Id, StringComparer.Ordinal);
        var checkedCount = 0;
        string? firstFailure = null;
        foreach (var identity in expectedIdentities.OrderBy(identity => identity, StringComparer.Ordinal))
        {
            if (!roots.TryGetValue(identity, out var root))
            {
                firstFailure ??= identity + ":missing-root";
                continue;
            }
            var hasVertices = SelfAndDescendants(root).OfType<MeshInstance3D>()
                .Any(instance => instance.Mesh is not null && MeshVertexCount(instance) > 0);
            var expectedPosition = componentItems.TryGetValue(identity, out var component)
                ? Anchor(component.X, component.Y, 0)
                : NeutralControlPosition(controlItems[identity]);
            var expectedRotation = identity == "dial"
                ? new Vector3(0, 0, (float)-(neutral.dial.udeg / TactileTheme.DialRotation.Value))
                : Vector3.Zero;
            var exact = hasVertices && root.Position.IsEqualApprox(expectedPosition) &&
                root.RotationDegrees.IsEqualApprox(expectedRotation);
            if (exact) checkedCount++;
            else firstFailure ??=
                $"{identity}:mesh={(hasVertices ? 1 : 0)},position={root.Position},rotation={root.RotationDegrees}";
        }
        Check("3.2.20", "inventory-mesh-anchors", checkedCount == 34,
            checkedCount + "/34" + (firstFailure is null ? "" : " first=" + firstFailure));
        return;

        Vector3 NeutralControlPosition(PanelControl item)
        {
            if (item.Kind == "relay-crossbar")
            {
                var travel = neutral.relays[SectionIndex(item)].travel;
                var shiftCqi = travel * TactileTheme.CrossbarShift.Value / 1000 -
                    TactileTheme.CrossbarShift.Value / 2;
                return Anchor(item.X + shiftCqi / 100, item.Y, 0);
            }
            if (item.Kind == "pushbutton")
                return Anchor(item.X, item.Y,
                    -TactileTheme.PushbuttonStroke.Value * neutral.buttons[SectionIndex(item)].travel / 1000);
            if (item.Kind == "slide-switch")
            {
                var shift = (neutral.switches[SectionIndex(item)].travel / 1000.0 - 0.5) *
                    TactileTheme.SlideThrow.Value;
                return Anchor(item.X + shift, item.Y, 0);
            }
            if (item.Kind == "power-switch")
            {
                var shift = ((neutral.power ? 1000 : 0) / 1000.0 - 0.5) * TactileTheme.SlideThrow.Value;
                return new Vector3(
                    (float)(item.X - 0.5),
                    (float)((0.5 - item.Y) / PanelLayout.PanelAspect + shift),
                    0);
            }
            if (item.Kind == "breaker-button")
            {
                var proud = neutral.breakerTripped
                    ? TactileTheme.BreakerProud.Value.X
                    : TactileTheme.BreakerProud.Value.Y;
                return Anchor(item.X, item.Y, proud - TactileTheme.BreakerProud.Value.X);
            }
            return Anchor(item.X, item.Y, 0);
        }

        static Vector3 Anchor(double x, double y, double z) => new(
            (float)(x - 0.5),
            (float)((0.5 - y) / PanelLayout.PanelAspect),
            (float)z);

        static int SectionIndex(PanelControl item) =>
            (item.Section ?? throw new InvalidOperationException("acceptance: missing control section " + item.Id)) - 1;
    }

    private void RunRaisedHitChecks(Stage3D stage, Controls controls)
    {
        var samples = new (string Identity, Control Target)[]
        {
            ("button1", FindButton(controls, "pushbutton", 1)),
            ("relay1", controls.Relays.Single(control =>
                control.GetMeta("control_id").AsString() == "relay1")),
            ("dial", controls.Dial),
        };
        var popouts = SelfAndDescendants(stage.PopOuts)
            .OfType<Node3D>()
            .Where(node => node.HasMeta("popout_id"))
            .ToDictionary(node => node.GetMeta("popout_id").AsString(), StringComparer.Ordinal);

        stage.Camera.ResetPose();
        var defaultReached = samples.Count(sample => ProjectAndPress(sample, popouts[sample.Identity]));
        Check("3.2.20", "raised-centres-default", defaultReached == samples.Length,
            defaultReached + "/" + samples.Length + " cap/crossbar/dial");

        SetCameraPose(stage.Camera, new Pose(
            TactileTheme.CameraElevationDeg.Value.X,
            0,
            TactileTheme.CameraDefaultPose.Value.DollyW));
        var lowAngleReached = samples.Count(sample =>
        {
            var planePixel = ProjectedPanelPixel(RaisedCentre(popouts[sample.Identity]));
            return sample.Target.GetGlobalRect().HasPoint(planePixel);
        });
        GD.Print("popouts low-angle raised-centres=" + lowAngleReached + "/" + samples.Length + " observation");
        stage.Camera.ResetPose();
        return;

        bool ProjectAndPress((string Identity, Control Target) sample, Node3D popout)
        {
            var top = RaisedCentre(popout);
            var screen = stage.Camera.UnprojectPosition(top);
            var viewport = GetWindow().Size;
            var visible = !stage.Camera.IsPositionBehind(top) &&
                screen.X >= 0 && screen.X < viewport.X && screen.Y >= 0 && screen.Y < viewport.Y;
            var plane = QuadInput.QuadPointFromRay(
                stage.Camera.ProjectRayOrigin(screen),
                stage.Camera.ProjectRayNormal(screen),
                stage.PanelQuad.GlobalTransform);
            var planePixel = QuadMap.PixelFromWorld(
                plane,
                stage.PanelQuad.GlobalTransform,
                ((QuadMesh)stage.PanelQuad.Mesh).Size,
                stage.PanelViewport.Size);
            var onTarget = sample.Target.GetGlobalRect().HasPoint(planePixel);
            var presses = 0;
            void SawInput(InputEvent input)
            {
                if (input is InputEventMouseButton { Pressed: true }) presses++;
            }
            var wasDisabled = sample.Target is BaseButton button && button.Disabled;
            if (sample.Target is BaseButton enabled) enabled.Disabled = false;
            sample.Target.GuiInput += SawInput;
            stage.InputSurface.Forward(MouseButtonEvent(true, global: screen), plane);
            stage.InputSurface.Forward(MouseButtonEvent(false, global: screen), plane);
            sample.Target.GuiInput -= SawInput;
            if (sample.Target is BaseButton restored) restored.Disabled = wasDisabled;
            return visible && onTarget && presses == 1;
        }

        Vector2 ProjectedPanelPixel(Vector3 top)
        {
            var screen = stage.Camera.UnprojectPosition(top);
            var plane = QuadInput.QuadPointFromRay(
                stage.Camera.ProjectRayOrigin(screen),
                stage.Camera.ProjectRayNormal(screen),
                stage.PanelQuad.GlobalTransform);
            return QuadMap.PixelFromWorld(
                plane,
                stage.PanelQuad.GlobalTransform,
                ((QuadMesh)stage.PanelQuad.Mesh).Size,
                stage.PanelViewport.Size);
        }
    }

    private static Vector3 RaisedCentre(Node3D root)
    {
        var bestZ = float.NegativeInfinity;
        foreach (var instance in SelfAndDescendants(root).OfType<MeshInstance3D>())
        {
            if (instance.Mesh is null) continue;
            for (var surfaceIndex = 0; surfaceIndex < instance.Mesh.GetSurfaceCount(); surfaceIndex++)
            {
                var vertices = instance.Mesh.SurfaceGetArrays(surfaceIndex)[(int)Mesh.ArrayType.Vertex]
                    .AsVector3Array();
                for (var vertex = 0; vertex + 2 < vertices.Length; vertex += 3)
                {
                    var a = root.ToLocal(instance.ToGlobal(vertices[vertex]));
                    var b = root.ToLocal(instance.ToGlobal(vertices[vertex + 1]));
                    var c = root.ToLocal(instance.ToGlobal(vertices[vertex + 2]));
                    if (VerticalIntersectionAtOrigin(a, b, c, out var z)) bestZ = Math.Max(bestZ, z);
                }
            }
        }
        if (float.IsNegativeInfinity(bestZ))
            throw new InvalidOperationException("acceptance: pop-out has no raised centre surface " + root.Name);
        return root.ToGlobal(new Vector3(0, 0, bestZ));
    }

    private static bool VerticalIntersectionAtOrigin(Vector3 a, Vector3 b, Vector3 c, out float z)
    {
        const float tolerance = 0.000001f;
        var denominator = (b.Y - c.Y) * (a.X - c.X) + (c.X - b.X) * (a.Y - c.Y);
        if (Math.Abs(denominator) <= tolerance)
        {
            z = 0;
            return false;
        }
        var wa = ((b.Y - c.Y) * -c.X + (c.X - b.X) * -c.Y) / denominator;
        var wb = ((c.Y - a.Y) * -c.X + (a.X - c.X) * -c.Y) / denominator;
        var wc = 1 - wa - wb;
        z = wa * a.Z + wb * b.Z + wc * c.Z;
        return wa >= -tolerance && wb >= -tolerance && wc >= -tolerance;
    }

    private void RunPopoutStateChecks(Stage3D stage, Controls controls)
    {
        var state = _session.CurrentMachine!.Snapshot();
        var push = Popout("button1");
        var slide = Popout("switch1");
        var power = Popout("power");
        var breaker = Popout("breaker");
        var relay = Popout("relay1");
        var dial = Popout("dial");

        Vector3 PushAt(int travel)
        {
            var buttons = (State.Button[])state.buttons.Clone();
            buttons[0] = buttons[0] with { travel = travel };
            var sample = state with { buttons = buttons };
            controls.Render(sample);
            stage.RenderPresentation(sample, controls);
            return push.Position;
        }
        Vector3 SlideAt(int travel)
        {
            var switches = (State.Switch[])state.switches.Clone();
            switches[0] = switches[0] with { travel = travel };
            var sample = state with { switches = switches };
            controls.Render(sample);
            stage.RenderPresentation(sample, controls);
            return slide.Position;
        }

        var pushPositions = new[] { PushAt(0), PushAt(500), PushAt(1000) };
        var pushStep = new Vector3(0, 0, (float)(-TactileTheme.PushbuttonStroke.Value / 2));
        Check("3.2.20", "push-travel",
            pushPositions[1].IsEqualApprox(pushPositions[0] + pushStep) &&
            pushPositions[2].IsEqualApprox(pushPositions[1] + pushStep),
            "0/500/1000");

        var slidePositions = new[] { SlideAt(0), SlideAt(500), SlideAt(1000) };
        var slideStep = new Vector3((float)(TactileTheme.SlideThrow.Value / 2), 0, 0);
        Check("3.2.20", "slide-travel",
            slidePositions[1].IsEqualApprox(slidePositions[0] + slideStep) &&
            slidePositions[2].IsEqualApprox(slidePositions[1] + slideStep),
            "0/500/1000");

        controls.Render(state with { power = false, breakerTripped = false });
        stage.RenderPresentation(state with { power = false, breakerTripped = false }, controls);
        var powerOff = power.Position;
        var breakerReset = breaker.Position;
        controls.Render(state with { power = true, breakerTripped = true });
        stage.RenderPresentation(state with { power = true, breakerTripped = true }, controls);
        var powerOn = power.Position;
        var breakerTripped = breaker.Position;
        Check("3.2.20", "boolean-travel",
            Math.Abs(powerOn.Y - powerOff.Y - TactileTheme.SlideThrow.Value) < 0.000001 &&
            Math.Abs(breakerTripped.Z - breakerReset.Z -
                (TactileTheme.BreakerProud.Value.X - TactileTheme.BreakerProud.Value.Y)) < 0.000001,
            "power=2/2,breaker=2/2");

        controls.PointerRelayPress(1, 500);
        controls.Render(state);
        stage.RenderPresentation(state, controls);
        var relayItem = _layout.Controls.Single(item => item.Id == "relay1");
        var expectedRelay = Case3D.PanelPoint(
            relayItem.X + PanelTheme.RelayCrossbarShift(500) / 100,
            relayItem.Y,
            0);
        var relayPresented = relay.Position.IsEqualApprox(expectedRelay);
        controls.PointerRelayRelease(1);

        controls.Render(state);
        var relayKeyboardCommands = new List<Command>();
        controls.Emitted += SawRelayKeyboardCommand;
        controls.KeyboardRelayStep(1, Commands.KeyStep.ArrowUp);
        var differingRelays = (State.Relay[])state.relays.Clone();
        differingRelays[0] = differingRelays[0] with { travel = 1000 };
        _boot.RenderConsole(state with { relays = differingRelays }, _nowUs);
        var relayKeyboardHeld = controls.PresentedValue("relay1") == 1;
        var relayKeyboardItem = _layout.Controls.Single(item => item.Id == "relay1");
        var relayKeyboardShift = (TactileTheme.CrossbarShift.Value / 1000 -
            TactileTheme.CrossbarShift.Value / 2) / 100;
        var relayKeyboardExpected = new Vector3(
            (float)(relayKeyboardItem.X + relayKeyboardShift - 0.5),
            (float)((0.5 - relayKeyboardItem.Y) / PanelLayout.PanelAspect),
            0);
        relayKeyboardHeld &= relay.Position.IsEqualApprox(relayKeyboardExpected);
        controls.KeyboardRelayRelease(1);
        controls.Emitted -= SawRelayKeyboardCommand;
        var relayKeyboardCommandsExact = relayKeyboardCommands.Count == 3 &&
            relayKeyboardCommands[0] is Command.RelayGrab { n: 1, target: 0 } &&
            relayKeyboardCommands[1] is Command.RelayGrab { n: 1, target: 1 } &&
            relayKeyboardCommands[2] is Command.RelayRelease { n: 1 };
        Check("3.2.20", "keyboard-relay-handoff", relayKeyboardHeld && relayKeyboardCommandsExact,
            $"held={(relayKeyboardHeld ? 1 : 0)},commands={(relayKeyboardCommandsExact ? 3 : 0)}/3");

        var fractional = state with { dial = state.dial with { udeg = 500_000 } };
        controls.Render(fractional);
        stage.RenderPresentation(fractional, controls);
        var fractionalStateRendered = Math.Abs(dial.RotationDegrees.Z + 0.5) < 0.000001;

        var pointerCommands = new List<Command>();
        controls.Emitted += SawPointerCommand;
        controls.PointerDial(Vector2.Up, true);
        controls.PointerDialMove(new Vector2(1, -2));
        _boot.RenderConsole(state with { dial = state.dial with { udeg = 1_000_000 } }, _nowUs);
        var pointerTarget = controls.PresentedValue("dial");
        var pointerHeld = pointerTarget == 26_565_051 && Mathf.IsEqualApprox(
            dial.RotationDegrees.Z,
            (float)-PanelTheme.DialPointerDegrees(pointerTarget));
        controls.PointerDial(Vector2.Up, false);
        controls.Emitted -= SawPointerCommand;
        var pointerCommandsExact = pointerCommands.Count == 3 &&
            pointerCommands[0] is Command.DialGrab { targetUdeg: 0 } &&
            pointerCommands[1] is Command.DialGrab { targetUdeg: 26_565_051 } &&
            pointerCommands[2] is Command.DialRelease;
        Check("3.2.20", "presented-values",
            relayPresented && fractionalStateRendered && pointerHeld && pointerCommandsExact,
            $"relay-pointer-held={(relayPresented ? 1 : 0)},fractional-state={(fractionalStateRendered ? 1 : 0)}," +
            $"dial-pointer-held={(pointerHeld ? 1 : 0)}:{pointerTarget}:{dial.RotationDegrees.Z:F6}," +
            $"commands={(pointerCommandsExact ? 3 : 0)}/3");

        controls.Render(fractional);
        var keyboardCommands = new List<Command>();
        controls.Emitted += SawKeyboardCommand;
        controls.KeyboardDialStep(Commands.KeyStep.ArrowUp);
        controls.Emitted -= SawKeyboardCommand;
        var keyboardCommandsExact = keyboardCommands.Count == 2 &&
            keyboardCommands[0] is Command.DialGrab { targetUdeg: 500_001 } &&
            keyboardCommands[1] is Command.DialRelease;
        var coreState = _session.CurrentMachine!.Snapshot();
        _boot.RenderConsole(coreState, _nowUs);
        var handedOff = controls.PresentedValue("dial");
        var expectedRotation = -PanelTheme.DialPointerDegrees(handedOff);
        var keyboardHandoff = handedOff == coreState.dial.udeg &&
            Math.Abs(dial.RotationDegrees.Z - expectedRotation) < 0.000001;
        Check("3.2.20", "keyboard-atomic-handoff", keyboardCommandsExact && keyboardHandoff,
            $"atomic-grab-release={(keyboardCommandsExact ? 2 : 0)}/2," +
            $"core={coreState.dial.udeg},presented={handedOff},rotation={dial.RotationDegrees.Z:F6}," +
            "limitation=atomic-pair-does-not-advance-core");

        controls.Render(state);
        stage.RenderPresentation(state, controls);
        return;

        void SawPointerCommand(Command command) => pointerCommands.Add(command);
        void SawKeyboardCommand(Command command) => keyboardCommands.Add(command);
        void SawRelayKeyboardCommand(Command command) => relayKeyboardCommands.Add(command);

        Node3D Popout(string identity) => Descendants(stage.PopOuts)
            .OfType<Node3D>()
            .Single(node => node.HasMeta("popout_id") && node.GetMeta("popout_id").AsString() == identity);
    }

    private void RunPresentationSurfaceChecks(Stage3D stage)
    {
        var lighting = TactileTheme.SceneLighting.Value;
        var environment = stage.World.Environment;
        var lightConfigured = stage.KeyLight.LightColor == lighting.Colour &&
            Math.Abs(stage.KeyLight.LightEnergy - lighting.KeyEnergy) < 0.000001 &&
            Math.Abs(stage.KeyLight.RotationDegrees.X - lighting.KeyRotationDeg.X) < 0.000001 &&
            Math.Abs(stage.KeyLight.RotationDegrees.Y - lighting.KeyRotationDeg.Y) < 0.000001 &&
            !stage.KeyLight.ShadowEnabled && environment is not null &&
            environment.AmbientLightSource == global::Godot.Environment.AmbientSource.Color &&
            environment.AmbientLightColor == lighting.Colour &&
            Math.Abs(environment.AmbientLightEnergy - lighting.AmbientEnergy) < 0.000001;
        Check("3.2.20", "lighting", lightConfigured, lightConfigured ? "key+ambient" : "mismatch");

        var meshes = SelfAndDescendants(stage.Case).Concat(SelfAndDescendants(stage.PopOuts))
            .OfType<MeshInstance3D>()
            .Where(instance => instance.Mesh is not null)
            .ToArray();
        var caseBody = meshes.Single(instance => instance.Name.ToString() == "CaseBody");
        var footMeshes = meshes.Where(instance => instance.Name.ToString().StartsWith("Foot", StringComparison.Ordinal))
            .ToArray();
        var caseBottom = WorldZExtrema(caseBody).Min;
        var feetTouch = footMeshes.Length == TactileTheme.FootCount.Value &&
            footMeshes.All(foot => Math.Abs(WorldZExtrema(foot).Max - caseBottom) < 0.000001);
        Check("3.2.20", "feet-contact", feetTouch,
            $"feet={footMeshes.Length},case-bottom={caseBottom:F6}");
        var railMeshes = meshes.Where(instance =>
            instance.Name.ToString().StartsWith("FrameRail_", StringComparison.Ordinal)).ToArray();
        var railNames = railMeshes.Select(instance => instance.Name.ToString()).ToHashSet(StringComparer.Ordinal);
        var lastX = _layout.Plates.SelectMany(plate => new[] { plate.X, plate.X + plate.Width })
            .Append(0).Append(1).Distinct().Count() - 2;
        var lastY = _layout.Plates.SelectMany(plate => new[] { plate.Y, plate.Y + plate.Height })
            .Append(0).Append(1).Distinct().Count() - 2;
        var cornerRails = new[]
        {
            "FrameRail_0_0", $"FrameRail_0_{lastY}", $"FrameRail_{lastX}_0", $"FrameRail_{lastX}_{lastY}",
        };
        var caseEnvelopeMeshes = railMeshes.Append(caseBody).ToArray();
        var caseEnvelopeVertices = caseEnvelopeMeshes.SelectMany(instance =>
            Enumerable.Range(0, instance.Mesh.GetSurfaceCount()).SelectMany(surfaceIndex =>
                instance.Mesh.SurfaceGetArrays(surfaceIndex)[(int)Mesh.ArrayType.Vertex].AsVector3Array()
                    .Select(instance.ToGlobal))).ToArray();
        var halfWidth = 0.5;
        var halfHeight = 0.5 / PanelLayout.PanelAspect;
        var cornerRadius = TactileTheme.CaseEdgeRadius.Value;
        var outsideEnvelope = caseEnvelopeVertices.Count(vertex =>
        {
            var dx = Math.Max(0, Math.Abs(vertex.X) - (halfWidth - cornerRadius));
            var dy = Math.Max(0, Math.Abs(vertex.Y) - (halfHeight - cornerRadius));
            return dx * dx + dy * dy > cornerRadius * cornerRadius + 0.000001;
        });
        Check("3.2.20", "case-rounded-envelope",
            railMeshes.Length >= cornerRails.Length && cornerRails.All(railNames.Contains) &&
            caseEnvelopeVertices.Length > 0 && outsideEnvelope == 0,
            $"rails={railMeshes.Length},corners={cornerRails.Count(railNames.Contains)}/{cornerRails.Length}," +
            $"vertices={caseEnvelopeVertices.Length},outside={outsideEnvelope}");
        var dialRoot = SelfAndDescendants(stage.PopOuts).OfType<Node3D>()
            .Single(node => node.HasMeta("popout_id") && node.GetMeta("popout_id").AsString() == "dial");
        var knob = SelfAndDescendants(dialRoot).OfType<MeshInstance3D>()
            .Single(instance => instance.Name.ToString() == "Knob");
        var innerCircleRadius = _layout.Linework
            .Single(item => item.Id == "decimal/inner-circle").RadiusX ??
            throw new InvalidOperationException("acceptance: decimal inner circle has no radius");
        var expectedKnobRadius = innerCircleRadius * TactileTheme.KnobWedgeRadiusOverInnerCircle.Value;
        var bodyRadius = knob.Mesh.GetSurfaceCount() > 0 ? MeshSurfaceRadius(knob, 0) : 0;
        var wedgeRadius = knob.Mesh.GetSurfaceCount() > 1 ? MeshSurfaceRadius(knob, 1) : 0;
        var knobRimExact = knob.Mesh.GetSurfaceCount() == 2 &&
            Math.Abs(bodyRadius - expectedKnobRadius) < 0.000001 &&
            Math.Abs(wedgeRadius - expectedKnobRadius) < 0.000001;
        Check("3.2.20", "knob-rim", knobRimExact,
            $"body={bodyRadius:F6},wedge={wedgeRadius:F6},expected={expectedKnobRadius:F6}");
        var surfaceMaterials = meshes.SelectMany(instance => Enumerable.Range(0, instance.Mesh.GetSurfaceCount())
                .Select(index => instance.Mesh.SurfaceGetMaterial(index)))
            .ToArray();
        var shadedCount = surfaceMaterials.Count(material =>
            material is BaseMaterial3D { ShadingMode: not BaseMaterial3D.ShadingModeEnum.Unshaded });
        var shaded = surfaceMaterials.Length > 0 && shadedCount == surfaceMaterials.Length;
        Check("3.2.20", "shaded-materials", shaded,
            $"shaded={shadedCount},surfaces={surfaceMaterials.Length}");

        var clockwise = true;
        var triangles = 0;
        foreach (var instance in meshes)
        {
            for (var surfaceIndex = 0; surfaceIndex < instance.Mesh.GetSurfaceCount(); surfaceIndex++)
            {
                var arrays = instance.Mesh.SurfaceGetArrays(surfaceIndex);
                var vertices = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var normals = arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
                for (var vertex = 0; vertex + 2 < vertices.Length; vertex += 3)
                {
                    var cross = (vertices[vertex + 1] - vertices[vertex])
                        .Cross(vertices[vertex + 2] - vertices[vertex]);
                    clockwise &= cross.Dot(normals[vertex]) < 0;
                    triangles++;
                }
            }
        }
        Check("3.2.20", "mesh-winding", clockwise && triangles > 0,
            $"clockwise={(clockwise ? 1 : 0)},triangles={triangles}");

        var state = _session.CurrentMachine!.Snapshot();
        var levels = new[] { (Milli: 0, Energy: 0.0), (Milli: 500, Energy: 1.0), (Milli: 1000, Energy: 2.0) };
        var emissionChecks = 0;
        foreach (var level in levels)
        {
            var sample = state with
            {
                outLamps = state.outLamps.Select(lamp => lamp with { milli = level.Milli }).ToArray(),
                indLamps = state.indLamps.Select(lamp => lamp with { milli = level.Milli }).ToArray(),
            };
            _boot.RenderConsole(sample, _nowUs);
            emissionChecks += stage.PopOuts.LampMaterials.Count(material =>
                Math.Abs(material.EmissionEnergyMultiplier - level.Energy) < 0.000001);
        }
        _boot.RenderConsole(state with { railMv = 0 }, _nowUs);
        var jewelOff = stage.PopOuts.JewelMaterial.EmissionEnergyMultiplier == 0;
        _boot.RenderConsole(state with { railMv = 1 }, _nowUs);
        var jewelOn = Math.Abs(stage.PopOuts.JewelMaterial.EmissionEnergyMultiplier -
            TactileTheme.LampEmissionMax.Value) < 0.000001;
        var typedLenses = stage.PopOuts.LampMaterials.Append(stage.PopOuts.JewelMaterial)
            .OfType<StandardMaterial3D>()
            .ToArray();
        var lensAlpha = typedLenses.Length == 13 && typedLenses
            .All(material => Math.Abs(material.AlbedoColor.A - TactileTheme.LampSurface.Value.Alpha) < 0.000001);
        var expectedEmissionChecks = levels.Length * stage.PopOuts.LampMaterials.Count;
        Check("3.2.7", "3d-emission",
            stage.PopOuts.LampMaterials.Count == 12 && emissionChecks == expectedEmissionChecks &&
            jewelOff && jewelOn && lensAlpha,
            $"linear={emissionChecks}/{expectedEmissionChecks},jewel={((jewelOff && jewelOn) ? 2 : 0)}/2,alpha={(lensAlpha ? 1 : 0)}");
        _boot.RenderConsole(state, _nowUs);
        var glowConfigured = environment is not null && environment.GlowEnabled &&
            Math.Abs(environment.GlowIntensity - TactileTheme.GlowIntensity.Value) < 0.000001 &&
            Math.Abs(environment.GlowBloom - TactileTheme.GlowBloom.Value) < 0.000001 &&
            Math.Abs(environment.GlowHdrThreshold - TactileTheme.GlowHdrThreshold.Value) < 0.000001;
        Check("3.2.7", "environment-glow", glowConfigured, glowConfigured ? "exact" : "mismatch");
    }

    private static (float Min, float Max) WorldZExtrema(MeshInstance3D instance)
    {
        var minimum = float.PositiveInfinity;
        var maximum = float.NegativeInfinity;
        for (var surfaceIndex = 0; surfaceIndex < instance.Mesh.GetSurfaceCount(); surfaceIndex++)
        {
            var vertices = instance.Mesh.SurfaceGetArrays(surfaceIndex)[(int)Mesh.ArrayType.Vertex]
                .AsVector3Array();
            foreach (var vertex in vertices)
            {
                var z = instance.ToGlobal(vertex).Z;
                minimum = Math.Min(minimum, z);
                maximum = Math.Max(maximum, z);
            }
        }
        if (float.IsPositiveInfinity(minimum) || float.IsNegativeInfinity(maximum))
            throw new InvalidOperationException("acceptance: mesh has no vertices " + instance.Name);
        return (minimum, maximum);
    }

    private static float MeshSurfaceRadius(MeshInstance3D instance, int surfaceIndex)
    {
        var vertices = instance.Mesh.SurfaceGetArrays(surfaceIndex)[(int)Mesh.ArrayType.Vertex]
            .AsVector3Array();
        if (vertices.Length == 0)
            throw new InvalidOperationException("acceptance: mesh surface has no vertices " + instance.Name);
        return vertices.Max(vertex => new Vector2(vertex.X, vertex.Y).Length());
    }

    private static int MeshVertexCount(MeshInstance3D instance)
    {
        var count = 0;
        for (var surfaceIndex = 0; surfaceIndex < instance.Mesh.GetSurfaceCount(); surfaceIndex++)
        {
            count += instance.Mesh.SurfaceGetArrays(surfaceIndex)[(int)Mesh.ArrayType.Vertex]
                .AsVector3Array().Length;
        }
        return count;
    }

    private void RunA11y()
    {
        var stage = _boot.CurrentStage3D ?? throw new InvalidOperationException("acceptance: missing Stage3D");
        var controls = Node<Controls>("Controls");
        var power = controls.Buttons.Single(button => button.GetMeta("control_id").AsString() == "power");
        var breaker = controls.Buttons.Single(button => button.GetMeta("control_id").AsString() == "breaker");
        var push = FindButton(controls, "pushbutton", 1);
        var slide = FindButton(controls, "slide-switch", 1);
        var relay = controls.Relays[0];
        var samples = new (Control Control, Key Key, int Commands)[]
        {
            (power, Key.Enter, 1),
            (breaker, Key.Enter, 1),
            (push, Key.Space, 2),
            (slide, Key.Enter, 1),
            (relay, Key.Up, 3),
            (controls.Dial, Key.Up, 2),
        };
        var emitted = new List<Command>();
        controls.Emitted += emitted.Add;
        var keyboardChecks = 0;
        var details = new List<string>();
        foreach (var sample in samples)
        {
            var wasDisabled = sample.Control is BaseButton button && button.Disabled;
            if (sample.Control is BaseButton enabled) enabled.Disabled = false;
            stage.PanelViewport.GuiGetFocusOwner()?.ReleaseFocus();
            sample.Control.GrabFocus();
            var before = emitted.Count;
            stage.Camera._UnhandledKeyInput(KeyEvent(sample.Key, true));
            stage.Camera._UnhandledKeyInput(KeyEvent(sample.Key, false));
            var focusAndTooltip = sample.Control.HasFocus() && !string.IsNullOrWhiteSpace(sample.Control.TooltipText);
            var delta = emitted.Count - before;
            if (focusAndTooltip && delta == sample.Commands) keyboardChecks++;
            details.Add(sample.Control.Name + ":" + (focusAndTooltip ? "1" : "0") + ":" + delta);
            if (sample.Control is BaseButton restored) restored.Disabled = wasDisabled;
        }

        stage.PanelViewport.GuiGetFocusOwner()?.ReleaseFocus();
        push.GrabFocus();
        var escapeStart = emitted.Count;
        stage.Camera._UnhandledKeyInput(KeyEvent(Key.Space, true));
        stage.Camera._UnhandledKeyInput(KeyEvent(Key.Escape, true));
        var escape = emitted.Count - escapeStart == 2 && stage.PanelViewport.GuiGetFocusOwner() is null;
        if (escape) keyboardChecks++;
        details.Add("escape:" + (escape ? "1" : "0"));

        push.GrabFocus();
        var lossStart = emitted.Count;
        stage.Camera._UnhandledKeyInput(KeyEvent(Key.Space, true));
        power.GrabFocus();
        var focusLoss = emitted.Count - lossStart == 2 && power.HasFocus();
        if (focusLoss) keyboardChecks++;
        details.Add("focus-loss:" + (focusLoss ? "1" : "0"));

        Check("3.2.28", "keyboard", keyboardChecks == samples.Length + 2,
            keyboardChecks == samples.Length + 2
                ? keyboardChecks + "/" + (samples.Length + 2)
                : string.Join(",", details));
    }

    private void LoadManual()
    {
        _boot.LoadManual();
        _nowUs = 0;
    }

    private void LoadDemo(string id)
    {
        _boot.LoadDemo(id);
        _nowUs = 0;
    }

    private CmdResult Inject(string gate, Command command)
    {
        Bound();
        var machine = _session.CurrentMachine!;
        var before = machine.Snapshot();
        var result = _session.Apply(command);
        if (!result.ok)
        {
            GD.Print("FAIL " + gate + " command-rejected " + command.k);
            _exitRequested = true;
            GetTree().Quit(2);
            throw new HarnessAbort();
        }
        _trace.Command(Session.CommandTraceTick(before, command), command);
        return result;
    }

    private void AdvanceBy(long microseconds)
    {
        Bound();
        _frame.Frame(_nowUs);
        var remaining = microseconds;
        while (remaining > 0)
        {
            Bound();
            var step = Math.Min(50_000, remaining);
            _nowUs += step;
            _frame.Frame(_nowUs);
            remaining -= step;
        }
    }

    private static bool EntryMatches(DemoRenderedEntry rendered, Demo source) =>
        rendered.Id == source.Id &&
        rendered.Title == source.Title &&
        rendered.Category == source.Category.ToString() &&
        rendered.Source.Program == source.Source.Program &&
        rendered.Source.Locator == source.Source.Locator &&
        rendered.Source.Confidence == source.Source.Confidence.ToString() &&
        rendered.Source.Errata.SequenceEqual(source.Source.Errata, StringComparer.Ordinal) &&
        rendered.Source.Fallbacks.SequenceEqual(source.Source.Fallbacks, StringComparer.Ordinal) &&
        rendered.Instructions.SequenceEqual(source.Instructions, StringComparer.Ordinal) &&
        rendered.ControlLabels.SequenceEqual(source.ControlLabels) &&
        rendered.NoticeParagraphs.SequenceEqual(
            source.Notice?.Split("\n\n", StringSplitOptions.None) ?? Array.Empty<string>(),
            StringComparer.Ordinal);

    private static string FrozenCaptureLine(IReadOnlyList<DemoRenderedEntry> entries)
    {
        var bytes = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(bytes))
        {
            writer.WriteStartObject();
            writer.WriteString("schema", "minivac.frozen-copy/1");
            writer.WritePropertyName("records");
            writer.WriteStartArray();
            foreach (var entry in entries)
            {
                writer.WriteStartObject();
                writer.WriteString("id", entry.Id);
                writer.WriteString("title", entry.Title);
                writer.WriteString("category", entry.Category);
                WriteStrings(writer, "instructions", entry.Instructions);
                writer.WritePropertyName("controlLabels");
                writer.WriteStartObject();
                foreach (var pair in entry.ControlLabels) writer.WriteString(pair.Key, pair.Value);
                writer.WriteEndObject();
                writer.WritePropertyName("source");
                writer.WriteStartObject();
                writer.WriteString("program", entry.Source.Program);
                writer.WriteString("locator", entry.Source.Locator);
                writer.WriteString("confidence", entry.Source.Confidence);
                WriteStrings(writer, "errata", entry.Source.Errata);
                WriteStrings(writer, "fallbacks", entry.Source.Fallbacks);
                writer.WriteEndObject();
                WriteStrings(writer, "noticeParagraphs", entry.NoticeParagraphs);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            writer.WriteEndObject();
        }
        return "frozen-copy: " + Encoding.UTF8.GetString(bytes.WrittenSpan);
    }

    private static string FrozenSourceCaptureLine(IReadOnlyList<Demo> demos)
    {
        var bytes = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(bytes))
        {
            writer.WriteStartObject();
            writer.WriteString("schema", "minivac.frozen-copy/1");
            writer.WritePropertyName("records");
            writer.WriteStartArray();
            foreach (var demo in demos)
            {
                writer.WriteStartObject();
                writer.WriteString("id", demo.Id);
                writer.WriteString("title", demo.Title);
                writer.WriteString("category", demo.Category.ToString());
                WriteStrings(writer, "instructions", demo.Instructions);
                writer.WritePropertyName("controlLabels");
                writer.WriteStartObject();
                foreach (var pair in demo.ControlLabels) writer.WriteString(pair.Key, pair.Value);
                writer.WriteEndObject();
                writer.WritePropertyName("source");
                writer.WriteStartObject();
                writer.WriteString("program", demo.Source.Program);
                writer.WriteString("locator", demo.Source.Locator);
                writer.WriteString("confidence", demo.Source.Confidence.ToString());
                WriteStrings(writer, "errata", demo.Source.Errata);
                WriteStrings(writer, "fallbacks", demo.Source.Fallbacks);
                writer.WriteEndObject();
                WriteStrings(
                    writer,
                    "noticeParagraphs",
                    demo.Notice?.Split("\n\n", StringSplitOptions.None) ?? Array.Empty<string>());
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            writer.WriteEndObject();
        }
        return "frozen-copy: " + Encoding.UTF8.GetString(bytes.WrittenSpan);
    }

    private static void WriteStrings(Utf8JsonWriter writer, string name, IReadOnlyList<string> values)
    {
        writer.WritePropertyName(name);
        writer.WriteStartArray();
        foreach (var value in values) writer.WriteStringValue(value);
        writer.WriteEndArray();
    }

    private void Check(string gate, string check, bool passed, string detail)
    {
        _total++;
        if (passed) _passed++;
        GD.Print((passed ? "PASS " : "FAIL ") + gate + " " + check + " " + detail);
    }

    private void Finish()
    {
        GD.Print("acceptance: " + _suite + " " + _passed + "/" + _total);
        _exitRequested = true;
        _boot.FreeAudioForAcceptance();
        RemoveTestPreferences();
        GetTree().Quit(_passed == _total ? 0 : 1);
    }

    private void HarnessFailure(string detail)
    {
        GD.Print("FAIL " + _suite + " harness-error " + detail);
        _exitRequested = true;
        RemoveTestPreferences();
        GetTree().Quit(2);
    }

    private void RemoveTestPreferences()
    {
        if (string.IsNullOrEmpty(_preferencesPath)) return;
        _ = DirAccess.RemoveAbsolute(ProjectSettings.GlobalizePath(_preferencesPath));
    }

    private sealed class RefusingAudioSink : IAudioSink
    {
        public bool RefuseNextStop { get; set; }
        public bool MotorRunning { get; private set; }
        public int StopAttempts { get; private set; }
        public int RelayCues { get; private set; }
        public int StopRelayCalls { get; private set; }

        public void PlayRelay(RelayCue cue) => RelayCues++;

        public bool SetMotor(MotorCue cue)
        {
            MotorRunning = true;
            return true;
        }

        public void StopMotor()
        {
            StopAttempts++;
            if (RefuseNextStop)
            {
                RefuseNextStop = false;
                throw new InvalidOperationException("refused stop");
            }
            MotorRunning = false;
        }

        public void StopRelayCues()
        {
            StopRelayCalls++;
            RelayCues = 0;
        }
    }

    internal void ArmFramed(string gate, Action step)
    {
        _framedGate = gate;
        _framedStep = step;
        _framedFrames = 0;
    }

    private void Bound()
    {
        if (_clock.Elapsed.TotalSeconds > 60) throw new HarnessTimeout();
    }

    private T Node<T>(string name) where T : Node =>
        GetTree().Root.FindChild(name, true, false) as T ?? throw new InvalidOperationException("acceptance: missing node " + name);

    private static IEnumerable<Node> Descendants(Node root)
    {
        foreach (var child in root.GetChildren())
        {
            yield return child;
            foreach (var descendant in Descendants(child)) yield return descendant;
        }
    }

    private static IEnumerable<Node> SelfAndDescendants(Node root)
    {
        yield return root;
        foreach (var descendant in Descendants(root)) yield return descendant;
    }

    private static IEnumerable<Node> Ancestors(Node node)
    {
        for (var parent = node.GetParent(); parent is not null; parent = parent.GetParent()) yield return parent;
    }

    private static string CordFingerprint(State.Cord cord) =>
        cord.id + ":" + EndFingerprint(cord.a) + ":" + EndFingerprint(cord.b) + ":" + cord.r_uohm;

    private static string EndFingerprint(CordEnd end) => end switch
    {
        CordEnd.Hole hole => "hole:" + hole.hole,
        CordEnd.Touch touch => "touch:" + touch.term,
        CordEnd.Free => "free",
        _ => throw new InvalidOperationException("acceptance: unknown cord end"),
    };

    private Control EndpointTarget(State.Cord cord, CordSide side, PanelView panel, Cords cords)
    {
        var end = side == CordSide.A ? cord.a : cord.b;
        return end switch
        {
            CordEnd.Hole hole => panel.Holes[hole.hole],
            CordEnd.Touch touch => panel.Holes[
                _layout.Terminals.Single(terminal => terminal.Id == touch.term).Holes[0].Id],
            CordEnd.Free => cords.TrayGrip(cord.id, side),
            _ => throw new InvalidOperationException("acceptance: unknown cord end"),
        };
    }

    private static Button FindButton(Controls controls, string kind, int? section)
    {
        var id = kind switch
        {
            "pushbutton" => "button" + section,
            "slide-switch" => "switch" + section,
            _ => kind,
        };
        return controls.Buttons.Single(button => button.GetMeta("control_id").AsString() == id);
    }

    private static void EmitGui(Control control, InputEvent input) =>
        control.EmitSignal(Control.SignalName.GuiInput, input);

    private static void RouteGui(Control control, InputEvent input)
    {
        if (input is InputEventMouseButton mouse)
        {
            var position = control.GetGlobalRect().GetCenter();
            mouse.Position = position;
            mouse.GlobalPosition = position;
        }
        else if (input is InputEventKey)
        {
            if (control.FocusMode != Control.FocusModeEnum.None) control.GrabFocus();
        }
        control.GetViewport().PushInput(input);
    }

    private void RoutePanelGui(Control control, InputEvent input)
    {
        var stage = _boot.CurrentStage3D;
        if (stage is null)
        {
            RouteGui(control, input);
            return;
        }
        if (input is InputEventKey)
        {
            if (control.FocusMode != Control.FocusModeEnum.None) control.GrabFocus();
            stage.PanelViewport.PushInput(input);
            return;
        }
        if (input is not InputEventMouseButton mouse) return;
        RoutePanelGuiAt(control, mouse, control.GetGlobalRect().GetCenter());
    }

    private void RoutePanelGuiAt(Control control, InputEventMouseButton mouse, Vector2 pixel)
    {
        var stage = _boot.CurrentStage3D;
        if (stage is null)
        {
            RouteGuiAt(control, mouse, pixel);
            return;
        }
        mouse.Position = pixel;
        mouse.GlobalPosition = pixel;
        var mesh = (QuadMesh)stage.PanelQuad.Mesh;
        var viewportSize = stage.PanelViewport.Size;
        var uv = pixel / new Vector2(viewportSize.X, viewportSize.Y);
        var local = new Vector3(
            (uv.X - 0.5f) * mesh.Size.X,
            -(uv.Y - 0.5f) * mesh.Size.Y,
            0);
        stage.InputSurface.Forward(mouse, stage.PanelQuad.GlobalTransform * local);
    }

    private static void RouteGuiAt(Control control, InputEventMouseButton input, Vector2 globalPosition)
    {
        input.Position = globalPosition;
        input.GlobalPosition = globalPosition;
        control.GetViewport().PushInput(input);
    }

    private static InputEventKey KeyEvent(Key key, bool pressed) => new()
    {
        Keycode = key,
        PhysicalKeycode = key,
        Pressed = pressed,
    };

    private static InputEventMouseButton ShiftClick(bool pressed)
    {
        var mouse = MouseButtonEvent(pressed);
        mouse.ShiftPressed = true;
        return mouse;
    }

    private static InputEventMouseButton MouseButtonEvent(
        bool pressed,
        float x = 0,
        Vector2? global = null,
        MouseButton buttonIndex = MouseButton.Left) => new()
    {
        ButtonIndex = buttonIndex,
        Pressed = pressed,
        Position = new Vector2(x, 0),
        GlobalPosition = global ?? new Vector2(x, 0),
    };

    private static void BeginTrayDrag(Cords cords, int cord, CordSide side)
    {
        cords.TrayGrip(cord, side).EmitSignal(Control.SignalName.GuiInput, MouseButtonEvent(true));
    }

    private static void PressChoice(Picker picker, string text)
    {
        picker.Search.Text = text;
        var choice = picker.Choices.Single(button => button.Text == text);
        choice.EmitSignal(BaseButton.SignalName.Pressed);
    }

    private static void Activate(Control control)
    {
        RouteGui(control, KeyEvent(Key.Enter, true));
        RouteGui(control, KeyEvent(Key.Enter, false));
    }

    private static int RequireAdded(AddCordResult result) => result is AddCordResult.Added added
        ? added.Cord
        : throw new InvalidOperationException("acceptance: add free cord failed");

    private static bool IsButtonPair(IReadOnlyList<Command> commands) =>
        commands.Count == 2 && commands[0] is Command.Button { target: 1000 } && commands[1] is Command.Button { target: 0 };

    private sealed class HarnessTimeout : Exception { }
    private sealed class HarnessAbort : Exception { }

    private sealed class FlippedArtifactSource : IArtifactSource
    {
        private readonly IArtifactSource _inner;
        private readonly byte[] _netlist;

        public FlippedArtifactSource(IArtifactSource inner, byte[] netlist)
        {
            _inner = inner;
            _netlist = netlist;
        }

        public byte[] ReadAllBytes(string relativePath) =>
            relativePath == "data/netlist.json" ? (byte[])_netlist.Clone() : _inner.ReadAllBytes(relativePath);

        public IReadOnlyList<string> EnumerateFiles(string relativeDir, string pattern) =>
            _inner.EnumerateFiles(relativeDir, pattern);
    }

    private sealed class NetlistView : IRawNetlistView
    {
        public NetlistView(LoadedNetlist netlist) =>
            Terminals = netlist.terminals.Select(terminal => new RawTerminalView(terminal.id, terminal.holes)).ToArray();

        public IReadOnlyList<RawTerminalView> Terminals { get; }
    }
}
