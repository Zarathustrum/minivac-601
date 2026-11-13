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
using Minivac.Hands;

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

    // The lock suite's machine: counts every call the session makes on the adopted machine. The
    // owner's own calls go to Inner and are not counted.
    private sealed class CountingMachine(Machine inner) : Machine
    {
        public Machine Inner => inner;
        public int Applies { get; private set; }
        public int Advances { get; private set; }
        public int Drains { get; private set; }
        public int Reads { get; private set; }
        public int Mutations => Applies + Advances + Drains;

        public CmdResult Apply(Command command)
        {
            Applies++;
            return inner.Apply(command);
        }

        public void Advance(int ticks)
        {
            Advances++;
            inner.Advance(ticks);
        }

        public Event[] DrainEvents()
        {
            Drains++;
            return inner.DrainEvents();
        }

        public State Snapshot()
        {
            Reads++;
            return inner.Snapshot();
        }

        public int[] Observables()
        {
            Reads++;
            return inner.Observables();
        }

        public int MotionMask()
        {
            Reads++;
            return inner.MotionMask();
        }
    }

    // A machine whose mount fails: the frame loop's mount reads its observables first (Session's loop mount).
    private sealed class MountRefusingMachine(Machine inner) : Machine
    {
        public CmdResult Apply(Command command) => inner.Apply(command);
        public void Advance(int ticks) => inner.Advance(ticks);
        public Event[] DrainEvents() => inner.DrainEvents();
        public State Snapshot() => inner.Snapshot();
        public int[] Observables() => throw new InvalidOperationException("acceptance: this mount is refused");
        public int MotionMask() => inner.MotionMask();
    }

    // What any input could visibly or electrically change; a locked path must leave all of it alone.
    private sealed record LockProbe(
        int Mutations,
        int Refused,
        bool PickerOpen,
        bool DrawerOpen,
        Machine? Machine,
        bool Dragging,
        bool PushHeld,
        string ControlsStatus,
        string CordsStatus,
        int Cords);

    private sealed record LockPath(string Name, Action Act, bool ReachesWhenLive);

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
            var framed = routedSuite is "budget" or "handles" or "a11y" or "visuals" or "lock" or "chat" or "pane-e2e" or "pane-quit";
            if (routedSuite is "budget" or "visuals") GetWindow().Size = new Vector2I(1440, 900);
            if (routedSuite == "chat") PrepareChat();
            // A headless run's window is 64 x 64, too small for the stage beside the dock.
            if (routedSuite is "pane-e2e" or "pane-quit") GetWindow().Size = new Vector2I(1152, 640);
            _boot.BuildConsole(
                _source,
                framed ? MakeFramedSession : MakeDrivenSession,
                _preferencesPath,
                forced3D ? "3d" : "flat",
                _chatFake);
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

            if (routedSuite == "lock")
            {
                ArmFramed("C2", () =>
                {
                    var controls = Node<Controls>("Controls");
                    if (controls.Dial.Size.X <= 0 || controls.Dial.Size.Y <= 0) return;
                    _framedStep = null;
                    RunLock();
                });
                return;
            }

            if (routedSuite == "chat")
            {
                ArmFramed("C4", () =>
                {
                    var stage = _boot.CurrentStage2D;
                    if (stage is not null && (stage.Size.X <= 0 || stage.Size.Y <= 0)) return;
                    if (++_chatFrames < 3) return;
                    _framedStep = null;
                    RunChat();
                });
                return;
            }

            if (routedSuite is "pane-e2e" or "pane-quit")
            {
                ArmFramed("C6", () =>
                {
                    var stage = _boot.CurrentStage2D;
                    if (stage is not null && (stage.Size.X <= 0 || stage.Size.Y <= 0)) return;
                    _framedStep = null;
                    RunPaneE2E(quit: routedSuite == "pane-quit");
                });
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
            (machine, context) =>
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
                    },
                    context.Frozen);
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
            // The default window, not headless's 64 x 64: help must fit it on every page.
            GetWindow().Size = new Vector2I(1152, 640);
            var args = OS.GetCmdlineUserArgs();
            var shots = Array.IndexOf(args, "--shots");
            if (shots >= 0 && shots + 1 < args.Length) _shotDir = args[shots + 1];
            _boot.BuildConsole(_source, MakeDrivenSession, _preferencesPath);
            var help = Node<HelpCredits>("HelpCredits");
            Check("3.2.1", "default-view", _boot.CurrentViewMode == "3d", _boot.CurrentViewMode);
            Check("3.2.1", "profile", _session.ProfileId == Session.DEFAULT_PROFILE_ID, _session.ProfileId);
            Check("3.2.1", "demo", _session.DemoId == "IV-EXP1", _session.DemoId ?? "none");
            Check("3.2.1", "help-open", help.InitiallyOpen && help.IsOpen, help.IsOpen ? "1" : "0");
            Check("3.2.1", "hash", Ints.fnv1a64(cleanBytes) == "2354ceebf3f8c566", Ints.fnv1a64(cleanBytes));
            Check("3.2.1", "no-loop-node", GetTree().Root.FindChild("Loop", true, false) is null, "1");

            // Each help page in turn, a frame or two after it shows: the dialog, its title bar and Close help inside the window.
            var page = 0;
            var frames = 0;
            var outside = new List<string>();
            ArmFramed("3.2.1", () =>
            {
                if (++frames < 3) return;
                frames = 0;
                if (page == 0) Shot("help-page-0");
                var problem = HelpOutside(help);
                if (problem.Length > 0) outside.Add("page" + page + ":" + problem);
                if (help.IsOpen && page < help.Pages.Count - 1)
                {
                    help.NextPage();
                    page++;
                    return;
                }
                Check("3.2.1", "help-fits-window", help.IsOpen && page == help.Pages.Count - 1 && outside.Count == 0,
                    $"pages={page + 1}/{help.Pages.Count} dialog={help.Position.X},{help.Position.Y}+{help.Size.X}x{help.Size.Y} " +
                    (outside.Count == 0 ? "inside" : string.Join(" ", outside)));
                _framedStep = null;
                Finish();
            });
        });
    }

    /// <summary>Where the help dialog (title bar included) or its Close help button leaves the window; "" when inside.</summary>
    private string HelpOutside(HelpCredits help)
    {
        var window = GetViewport().GetVisibleRect();
        var title = help.GetThemeConstant("title_height");
        var dialog = new Rect2(help.Position.X, help.Position.Y - title, help.Size.X, help.Size.Y + title);
        var ok = help.GetOkButton();
        var close = new Rect2(ok.GetGlobalRect().Position + help.Position, ok.Size);
        var inside = window.Encloses(dialog) && window.Encloses(close) && ok.IsVisibleInTree();
        return inside ? "" : $"window={window.Size.X:0}x{window.Size.Y:0} dialog={dialog.Position.X:0},{dialog.Position.Y:0}+{dialog.Size.X:0}x{dialog.Size.Y:0} close={close.Position.X:0},{close.Position.Y:0}+{close.Size.X:0}x{close.Size.Y:0}";
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
        CheckLogotype("3.2.9", panel);
    }

    // Inside its plate and centred on its point, like the web build's .panel-logo.
    private void CheckLogotype(string gate, PanelView panel)
    {
        var logo = panel.GetNode<Label>("Legend_right_logotype");
        var point = _layout.Legends.Single(legend => legend.Id == "right/logotype").X * panel.Size.X;
        var plate = _layout.Plates.Single(item => item.Id == "upper-right");
        var rect = logo.GetRect();
        var fits = logo.GetMinimumSize().X <= rect.Size.X + 0.5f &&
            Math.Abs(rect.GetCenter().X - point) <= 1 &&
            rect.Position.X >= plate.X * panel.Size.X && rect.End.X <= (plate.X + plate.Width) * panel.Size.X;
        Check(gate, "logotype-fit", fits,
            (rect.Position.X / panel.Size.X).ToString("0.0000") + "-" + (rect.End.X / panel.Size.X).ToString("0.0000"));
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
        CheckLogotype("3.2.9a", panel);

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

    // C2 zero-applies suite: a machine adopted frozen and locked takes no command, tick or drain
    // from the session whatever the user does, the camera stays free, and after Release the same
    // inputs reach it. Runs in the starting view, the other view, and back.
    private CountingMachine _lockMachine = null!;
    private int _bannerStops;
    private int _bannerEnds;
    private int _resetCordsAfter = -1;
    private string _resetDemoAfter = "";

    private void RunLock()
    {
        var netlist = Netlist.LoadNetlist(_source.ReadAllBytes("data/netlist.json"));
        using var profileDocument = JsonDocument.Parse(_source.ReadAllBytes("data/profiles/MV601-REF-A.json"));
        var profile = Profile.LoadProfile(profileDocument.RootElement);
        var owner = Machine.CreateMachine(netlist, profile);
        // The owner's first call: one cord hole to hole, one with a free end.
        OwnerApply(owner, new Command.Connect(0, new CordEnd.Hole(_layout.Holes[0].Id), new CordEnd.Hole(_layout.Holes[1].Id)));
        OwnerApply(owner, new Command.Connect(1, new CordEnd.Hole(_layout.Holes[2].Id), new CordEnd.Free()));
        OwnerTicks(owner, 1);

        // An adopt whose mount fails leaves the console as it was: unlocked, live, the same machine.
        var chrome = Node<Chrome>("Chrome");
        var liveBefore = _session.CurrentMachine;
        var threw = false;
        try
        {
            _boot.Adopt(new MountRefusingMachine(owner));
        }
        catch (InvalidOperationException)
        {
            threw = true;
        }
        var restored = threw && !_boot.Adopted && ReferenceEquals(_session.CurrentMachine, liveBefore) && !_session.Locked &&
            !_session.Frozen && !Node<Controls>("Controls").Locked && !Node<Cords>("Cords").Locked && !chrome.Banner.Visible &&
            !chrome.Toolbar.Library.Disabled && !chrome.Toolbar.Reset.Disabled;
        var tickAtFailure = _session.CurrentMachine!.Snapshot().tick;
        var waited = 0;
        ArmFramed("C2", () =>
        {
            if (++waited < 4) return;
            _framedStep = null;
            var live = _session.CurrentMachine!.Snapshot().tick > tickAtFailure && !_session.Frozen;
            Check("C2", "failed-adopt-stays-live", restored && live,
                $"threw={(threw ? 1 : 0)} restored={(restored ? 1 : 0)} ticks={tickAtFailure}->{_session.CurrentMachine!.Snapshot().tick}");
            // The console runs the motor before the lock (a machine handed back live, as Release mounts it, set up
            // as LockRefresh sets up the owner), so the adopt must silence it.
            var motor = Machine.CreateMachine(netlist, profile);
            OwnerApply(motor, new Command.Connect(0, new CordEnd.Hole(_layout.Holes[0].Id), new CordEnd.Hole(_layout.Holes[1].Id)));
            OwnerApply(motor, new Command.Connect(1, new CordEnd.Hole(_layout.Holes[2].Id), new CordEnd.Free()));
            OwnerTicks(motor, 1);
            var free = FreeHoles(motor.Snapshot().cords);
            OwnerApply(motor, new Command.Power(true));
            OwnerApply(motor, new Command.Connect(2, new CordEnd.Hole(free[5]), new CordEnd.Hole(free[6])));
            OwnerApply(motor, new Command.Switch(1, 1000));
            OwnerApply(motor, new Command.RelayGrab(2, 1000));
            OwnerApply(motor, new Command.DialGrab(180_000_000));
            OwnerTicks(motor, 20);
            _session.Adopt(motor, new AdoptContext(DemoLibrary.MANUAL, Session.DEFAULT_PROFILE_ID, Frozen: false, Locked: false));
            // The hand slews the dial for a moment: adopt once the router has started the motor cue.
            var spun = 0;
            ArmFramed("C2", () =>
            {
                var playing = Node<AudioRouter>("Audio").Sink is GodotAudioSink { MotorDirection: not 0 };
                if (!playing && ++spun < 30) return;
                _framedStep = null;
                LockAdopt(owner);
            });
        });
    }

    private void LockAdopt(Machine owner)
    {
        var controls = Node<Controls>("Controls");
        var cords = Node<Cords>("Cords");
        var cordList = Node<CordList>("CordList");
        var picker = Node<Picker>("Picker");
        var panel = Node<PanelView>("Panel");
        var chrome = Node<Chrome>("Chrome");
        chrome.Banner.StopPressed += () => _bannerStops++;
        chrome.Banner.EndSessionPressed += () => _bannerEnds++;

        // Leave the live panel mid-gesture: picker open, a cord drag begun, a pushbutton held.
        var live = _session.CurrentMachine!.Snapshot();
        var liveCord = live.cords.First(cord => cord.a is CordEnd.Hole);
        RoutePanelGui(panel.Holes[((CordEnd.Hole)liveCord.a).hole], MouseButtonEvent(true));
        var wasDragging = cords.Dragging;
        Activate(cordList.EndpointButton(liveCord.id, CordSide.B) ?? throw new InvalidOperationException("acceptance: missing endpoint"));
        var pickerWasOpen = picker.IsOpen;
        var push1 = FindButton(controls, "pushbutton", 1);
        RoutePanelKey(push1, KeyEvent(Key.Space, true));
        var wasHeld = controls.PushHeld(1);
        chrome.Drawer.Open();
        var drawerWasOpen = chrome.Drawer.Visible;
        var sink = Node<AudioRouter>("Audio").Sink as GodotAudioSink;
        var motorBefore = sink is not null && sink.MotorDirection != 0;

        _lockMachine = new CountingMachine(owner);
        _boot.Adopt(_lockMachine);
        Check("C2", "drawer-closed-at-lock", drawerWasOpen && !chrome.Drawer.Visible,
            $"open={(drawerWasOpen ? 1 : 0)}{(chrome.Drawer.Visible ? 1 : 0)}");
        // Judged at once: the free-controls checks below toggle Sound, and muting stops the motor too.
        var silenced = motorBefore && sink is not null && sink.MotorDirection == 0 && !sink.MotorPlayer.Playing;
        Check("C2", "audio-reset-at-adopt", silenced,
            $"motor before={(motorBefore ? 1 : 0)} after={sink?.MotorDirection}/{(sink?.MotorPlayer.Playing == true ? 1 : 0)}");
        var adoptedClean = _lockMachine.Mutations == 0;
        var cleared = pickerWasOpen && !picker.IsOpen && wasDragging && !cords.Dragging && wasHeld && !controls.PushHeld(1);
        var beforeDirtyEnd = Probe();
        // The other halves of the interrupted gestures arrive after the lock and apply nothing.
        RoutePanelGuiAt(cords, MouseButtonEvent(false), panel.Holes[_layout.Holes[40].Id].GetGlobalRect().GetCenter());
        RoutePanelKey(push1, KeyEvent(Key.Space, false));
        var dirtyEndInert = Probe() == beforeDirtyEnd;
        Check("C2", "dirty-input-cleared", cleared && dirtyEndInert,
            $"picker={(pickerWasOpen ? 1 : 0)}{(picker.IsOpen ? 1 : 0)} drag={(wasDragging ? 1 : 0)}{(cords.Dragging ? 1 : 0)} held={(wasHeld ? 1 : 0)}{(controls.PushHeld(1) ? 1 : 0)} ends={(dirtyEndInert ? 1 : 0)}");

        var adoptShape = ReferenceEquals(_session.CurrentMachine, _lockMachine) && _session.Locked && _session.Frozen &&
            _session.DemoId == DemoLibrary.MANUAL.Id && _session.ProfileId == Session.DEFAULT_PROFILE_ID &&
            _boot.Adopted && controls.Locked && cords.Locked && cords.CordsState.Count == 2 &&
            Node<DemoExperience>("DemoExperience").Manual;
        Check("C2", "adopt", adoptShape && adoptedClean,
            $"mutations={_lockMachine.Mutations} locked={(_session.Locked ? 1 : 0)} frozen={(_session.Frozen ? 1 : 0)} cords={cords.CordsState.Count}");

        var refusedBefore = _session.RefusedWhileLocked;
        var chokeRefused = false;
        try
        {
            _session.Apply(new Command.Power(true));
        }
        catch (InvalidOperationException)
        {
            chokeRefused = true;
        }
        Check("C2", "choke-point", chokeRefused && _session.RefusedWhileLocked == refusedBefore + 1 && _lockMachine.Applies == 0,
            $"refused={(chokeRefused ? 1 : 0)} applies={_lockMachine.Applies}");
        var chokeBaseline = _session.RefusedWhileLocked;

        CheckLockedView("view-" + _boot.CurrentViewMode, chokeBaseline);
        var ownerTick = owner.Snapshot().tick;
        var framesSeen = 0;
        ArmFramed("C2", () =>
        {
            if (++framesSeen < 6) return;
            _framedStep = null;
            var frozen = _lockMachine.Mutations == 0 && owner.Snapshot().tick == ownerTick;
            Check("C2", "frozen", frozen, $"frames={framesSeen} advances={_lockMachine.Advances} drains={_lockMachine.Drains} tick={owner.Snapshot().tick}/{ownerTick}");
            LockRefresh(owner, chokeBaseline);
        });
    }

    // The owner's next call changes cords, power, a switch, a relay and the dial; adopting again
    // must be enough for every view to follow.
    private void LockRefresh(Machine owner, int chokeBaseline)
    {
        var freeHoles = FreeHoles(owner.Snapshot().cords);
        OwnerApply(owner, new Command.Power(true));
        OwnerApply(owner, new Command.Connect(2, new CordEnd.Hole(freeHoles[5]), new CordEnd.Hole(freeHoles[6])));
        OwnerApply(owner, new Command.Switch(1, 1000));
        OwnerApply(owner, new Command.RelayGrab(2, 1000));
        OwnerApply(owner, new Command.DialGrab(180_000_000));
        OwnerTicks(owner, 20);
        var expected = owner.Snapshot();
        _boot.Adopt(_lockMachine);
        var frames = 0;
        ArmFramed("C2", () =>
        {
            if (++frames < 2) return;
            _framedStep = null;
            var controls = Node<Controls>("Controls");
            var cords = Node<Cords>("Cords");
            var lamps = Node<Lamps>("Lamps");
            var state = _session.CurrentMachine!.Snapshot();
            var follows = new List<string>();
            if (cords.CordsState.Count != 3 || Node<CordList>("CordList").RowCount != 3) follows.Add("cords");
            if (FindButton(controls, "power", null).ButtonPressed != expected.power || !expected.power) follows.Add("power");
            if (FindButton(controls, "slide-switch", 1).ButtonPressed != expected.switches[0].travel >= 500) follows.Add("switch");
            if (controls.PresentedValue("relay2") != expected.relays[1].travel || expected.relays[1].travel == 0) follows.Add("relay");
            if (controls.PresentedValue("dial") != expected.dial.udeg || expected.dial.udeg == 0) follows.Add("dial");
            if (!lamps.JewelLit || lamps.Levels[0] != expected.outLamps[0].milli / 1000.0) follows.Add("lamps");
            if (_boot.CurrentStage3D is { } stage3D &&
                stage3D.CordMeshes.GetChildren().Count(node => node.Name.ToString().StartsWith("Cord_", StringComparison.Ordinal)) != 3)
                follows.Add("cord-meshes");
            Check("C2", "adopt-again-refresh", follows.Count == 0 && state.tick == expected.tick,
                follows.Count == 0 ? "cords,power,switch,relay,dial,lamps" + (_boot.CurrentStage3D is null ? "" : ",cord-meshes") : string.Join(",", follows));

            var sink = Node<AudioRouter>("Audio").Sink as GodotAudioSink;
            var silent = expected.dial.mrpm != 0 && sink is not null && !sink.MotorPlayer.Playing && _lockMachine.Mutations == 0;
            Check("C2", "audio-silent", silent, $"mrpm={expected.dial.mrpm} motor={(sink?.MotorPlayer.Playing == true ? 1 : 0)}");

            // Without adopting again the frame loop still redraws from the machine (the plan's claim).
            OwnerApply(owner, new Command.Switch(2, 1000));
            OwnerTicks(owner, 2000);
            var switchTwo = owner.Snapshot().switches[1].travel >= 500;
            var waited = 0;
            ArmFramed("C2", () =>
            {
                if (++waited < 2) return;
                _framedStep = null;
                var redrawn = FindButton(Node<Controls>("Controls"), "slide-switch", 2).ButtonPressed == switchTwo && switchTwo;
                Check("C2", "redraw-without-adopt", redrawn, redrawn ? "switch2" : "stale");
                var from = _boot.CurrentViewMode;
                _boot.ToggleViewMode();
                LockAfterToggle(owner, from, chokeBaseline, back: false);
            });
        });
    }

    private void LockAfterToggle(Machine owner, string from, int chokeBaseline, bool back)
    {
        var frames = 0;
        ArmFramed("C2", () =>
        {
            if (++frames < 3) return;
            var stage = _boot.CurrentStage2D;
            if (stage is not null && (stage.Size.X <= 0 || stage.Size.Y <= 0)) return;
            _framedStep = null;
            var chrome = Node<Chrome>("Chrome");
            var survives = _boot.CurrentViewMode != from && _session.Locked && _session.Frozen &&
                Node<Controls>("Controls").Locked && Node<Cords>("Cords").Locked && chrome.Banner.Visible &&
                chrome.Toolbar.Library.Disabled && chrome.Toolbar.Reset.Disabled && _lockMachine.Mutations == 0;
            Check("C2", "lock-survives-toggle", survives, from + "->" + _boot.CurrentViewMode);
            CheckLockedView("view-" + _boot.CurrentViewMode + (back ? "-again" : ""), chokeBaseline);
            if (!back)
            {
                var current = _boot.CurrentViewMode;
                _boot.ToggleViewMode();
                LockAfterToggle(owner, current, chokeBaseline, back: true);
                return;
            }
            LockRelease(owner);
        });
    }

    private void LockRelease(Machine owner)
    {
        var chrome = Node<Chrome>("Chrome");
        var controls = Node<Controls>("Controls");
        var cords = Node<Cords>("Cords");
        var ownerCords = owner.Snapshot().cords.Length;
        _boot.Release();
        var sink = Node<AudioRouter>("Audio").Sink as GodotAudioSink;
        var released = ReferenceEquals(_session.CurrentMachine, _lockMachine) && !_session.Locked && !_session.Frozen &&
            !_boot.Adopted && _session.DemoId == DemoLibrary.MANUAL.Id && cords.CordsState.Count == ownerCords &&
            !chrome.Banner.Visible && !controls.Locked && !cords.Locked &&
            !chrome.Toolbar.Library.Disabled && !chrome.Toolbar.BlankPanel.Disabled &&
            !chrome.Toolbar.Reset.Disabled && !chrome.Toolbar.Profile.Disabled;
        Check("C2", "release", released, $"cords={cords.CordsState.Count}/{ownerCords} locked={(_session.Locked ? 1 : 0)}");
        // The router retries a motor start that did not take on the next frame, so judge it a few frames on.
        var motorAtRelease = sink is not null && sink.MotorPlayer.Playing;
        var startMutations = _lockMachine.Mutations;
        var frames = 0;
        ArmFramed("C2", () =>
        {
            if (++frames < 3) return;
            _framedStep = null;
            var motor = motorAtRelease || sink is not null && sink.MotorPlayer.Playing;
            Check("C2", "audio-back", motor && _session.CurrentMachine!.Snapshot().dial.mrpm != 0,
                (motor ? "motor" : "silent") + (motorAtRelease ? " at release" : " after frames"));
            Check("C2", "live-time", _lockMachine.Advances > 0 && _lockMachine.Mutations > startMutations,
                "advances=" + _lockMachine.Advances);
            var failures = RunLockPaths(live: true);
            Check("C2", "released-paths-" + _boot.CurrentViewMode, failures.Count == 0,
                failures.Count == 0 ? "all reach" : "dead: " + string.Join(",", failures));
            var resetClears = _resetCordsAfter == 0 && _resetDemoAfter == DemoLibrary.MANUAL.Id;
            Check("C2", "reset-clears", resetClears, $"cords={_resetCordsAfter} demo={_resetDemoAfter}");
            Finish();
        });
    }

    // Every input path while locked: none may change the machine, the session or the view's state.
    private void CheckLockedView(string view, int chokeBaseline)
    {
        var failures = RunLockPaths(live: false);
        Check("C2", "locked-paths-" + view, failures.Count == 0 && _session.RefusedWhileLocked == chokeBaseline,
            failures.Count == 0 ? $"{LockPaths().Count} inert" : "leaked: " + string.Join(",", failures));
        CheckFreeControls(view);
        CheckBanner(view);
        var inert = _lockMachine.Mutations == 0 && _session.RefusedWhileLocked == chokeBaseline;
        Check("C2", "zero-applies-" + view, inert,
            $"applies={_lockMachine.Applies} advances={_lockMachine.Advances} drains={_lockMachine.Drains} refused={_session.RefusedWhileLocked - chokeBaseline}");
    }

    private List<string> RunLockPaths(bool live)
    {
        var failures = new List<string>();
        foreach (var path in LockPaths())
        {
            Bound();
            if (live && !path.ReachesWhenLive) continue;
            ClearFocus();
            var before = Probe();
            path.Act();
            var after = Probe();
            var changed = before != after;
            if (changed != live) failures.Add(path.Name);
            NormalizeLockInput();
        }
        return failures;
    }

    private List<LockPath> LockPaths()
    {
        var controls = Node<Controls>("Controls");
        var cords = Node<Cords>("Cords");
        var cordList = Node<CordList>("CordList");
        var picker = Node<Picker>("Picker");
        var panel = Node<PanelView>("Panel");
        var chrome = Node<Chrome>("Chrome");
        var push1 = FindButton(controls, "pushbutton", 1);
        var switch1 = FindButton(controls, "slide-switch", 1);
        var power = FindButton(controls, "power", null);
        var breaker = FindButton(controls, "breaker", null);
        var relay = controls.Relays[0];
        var dial = controls.Dial;
        // The cords as shown: the machine applies a command at its next tick, and no tick runs
        // between two paths.
        IReadOnlyList<State.Cord> Shown() => cords.CordsState;
        Vector2 HoleAt(string hole) => panel.Holes[hole].GetGlobalRect().GetCenter();
        void ClickPanel(Control control, bool shift = false)
        {
            RoutePanelGui(control, shift ? ShiftClick(true) : MouseButtonEvent(true));
            RoutePanelGui(control, shift ? ShiftClick(false) : MouseButtonEvent(false));
        }
        void DragPanel(Control control, Vector2 from, Vector2 to)
        {
            RoutePanelGuiAt(control, MouseButtonEvent(true), from);
            RoutePanelMotionAt((from + to) / 2);
            RoutePanelMotionAt(to);
            RoutePanelGuiAt(control, MouseButtonEvent(false), to);
        }
        void Keys(Control control, Key key, bool shift = false)
        {
            var down = KeyEvent(key, true);
            down.ShiftPressed = shift;
            var up = KeyEvent(key, false);
            up.ShiftPressed = shift;
            RoutePanelKey(control, down);
            RoutePanelKey(control, up);
        }
        Button ListButton(string name) =>
            cordList.FindChild(name, true, false) as Button ?? throw new InvalidOperationException("acceptance: missing " + name);
        var relayRect = relay.GetGlobalRect();
        var dialRect = dial.GetGlobalRect();
        return
        [
            new("push-click", () => ClickPanel(push1), true),
            new("push-shift-click", () =>
            {
                ClickPanel(push1, shift: true);
                ClickPanel(push1);
            }, true),
            new("switch-click", () => ClickPanel(switch1), true),
            new("power-click", () => ClickPanel(power), true),
            new("breaker-click", () => ClickPanel(breaker), false),
            new("relay-drag", () => DragPanel(
                relay,
                relayRect.Position + new Vector2(relayRect.Size.X * 0.1f, relayRect.Size.Y / 2),
                relayRect.Position + new Vector2(relayRect.Size.X * 0.9f, relayRect.Size.Y / 2)), true),
            new("dial-drag", () => DragPanel(
                dial,
                dialRect.GetCenter() + new Vector2(0, -dialRect.Size.Y / 4),
                dialRect.GetCenter() + new Vector2(dialRect.Size.X / 4, 0)), true),
            new("push-space", () => Keys(push1, Key.Space), true),
            new("push-shift-space", () =>
            {
                Keys(push1, Key.Space, shift: true);
                Keys(push1, Key.Space, shift: true);
            }, true),
            new("switch-enter", () => Keys(switch1, Key.Enter), true),
            new("power-enter", () => Keys(power, Key.Enter), true),
            new("breaker-enter", () => Keys(breaker, Key.Enter), true),
            new("relay-keys", () =>
            {
                foreach (var key in new[] { Key.Up, Key.Pageup, Key.End, Key.Home }) Keys(relay, key);
            }, true),
            new("dial-keys", () => Keys(dial, Key.Up), true),
            new("list-add", () => Click(cordList.AddButton), true),
            new("list-add-keyboard", () => Activate(cordList.AddButton), true),
            new("hole-drag", () =>
            {
                var cord = Shown().First(item => item.a is CordEnd.Hole);
                var from = ((CordEnd.Hole)cord.a).hole;
                DragPanel(panel.Holes[from], HoleAt(from), HoleAt(FreeHoles(Shown())[0]));
            }, true),
            new("grip-drag", () =>
            {
                var slot = CordModel.FreeTraySlots(Shown()).First();
                var grip = cords.TrayGrip(slot.Endpoint.Cord, slot.Endpoint.Side);
                DragPanel(grip, grip.GetGlobalRect().GetCenter(), HoleAt(FreeHoles(Shown())[1]));
            }, true),
            new("grip-keyboard", () =>
            {
                var slot = CordModel.FreeTraySlots(Shown()).First();
                Keys(cords.TrayGrip(slot.Endpoint.Cord, slot.Endpoint.Side), Key.Enter);
                RoutePanelGuiAt(cords, MouseButtonEvent(false), HoleAt(FreeHoles(Shown())[2]));
            }, true),
            new("list-endpoint", () => Click(cordList.EndpointButton(Shown()[0].id, CordSide.A)!), true),
            new("list-free", () =>
            {
                var cord = Shown().First(item => item.a is CordEnd.Hole);
                Click(ListButton("Free_" + cord.id + "_A"));
            }, true),
            new("picker-choose", () =>
            {
                var cord = Shown()[0];
                Click(cordList.EndpointButton(cord.id, CordSide.B)!);
                var hole = FreeHoles(Shown())[3];
                if (picker.IsOpen) Activate(picker.Choices.Single(choice => choice.Text == hole));
                else picker.Open(new EndpointRef(cord.id, CordSide.B));
            }, true),
            new("list-remove", () => Click(ListButton("Remove_" + Shown()[^1].id)), true),
            new("drawer-routes", () =>
            {
                _boot.LoadDemo(_library.Demos[1].Id);
                _boot.SwitchProfile(DemoExperience.IdealProfileId);
                _boot.LoadManual();
                _boot.ResetSession();
            }, false),
            new("toolbar-library", () => Click(chrome.Toolbar.Library), true),
            new("toolbar-profile", () => Click(chrome.Toolbar.Profile), true),
            new("toolbar-reset", () =>
            {
                Click(chrome.Toolbar.Reset);
                if (_boot.Adopted) return;
                _resetCordsAfter = _session.CurrentMachine!.Snapshot().cords.Length;
                _resetDemoAfter = _session.DemoId ?? "";
            }, true),
            new("toolbar-reset-keyboard", () => Activate(chrome.Toolbar.Reset), true),
            new("toolbar-blank", () => Click(chrome.Toolbar.BlankPanel), true),
        ];
    }

    private LockProbe Probe()
    {
        var controls = Node<Controls>("Controls");
        var cords = Node<Cords>("Cords");
        var held = false;
        for (var section = 1; section <= 6; section++) held |= controls.PushHeld(section);
        return new LockProbe(
            _lockMachine.Mutations,
            _session.RefusedWhileLocked,
            Node<Picker>("Picker").IsOpen,
            Node<Chrome>("Chrome").Drawer.Visible,
            _session.CurrentMachine,
            cords.Dragging,
            held,
            controls.LastStatus,
            cords.LastStatus,
            cords.CordsState.Count);
    }

    // Puts the console back between paths; with nothing open, dragged or latched it does nothing.
    private void NormalizeLockInput()
    {
        var picker = Node<Picker>("Picker");
        var chrome = Node<Chrome>("Chrome");
        var cords = Node<Cords>("Cords");
        if (picker.IsOpen) picker.Close();
        if (chrome.Drawer.Visible) chrome.Drawer.Close();
        if (cords.Dragging) cords.CancelDrag();
        Node<Controls>("Controls").ReleaseLatches();
        ClearFocus();
    }

    // Orbit, zoom, pan, Fit, Wire, Sound and Help keep working while locked and apply nothing.
    private void CheckFreeControls(string view)
    {
        var chrome = Node<Chrome>("Chrome");
        var toolbar = chrome.Toolbar;
        var failures = new List<string>();
        var steps = new List<(string Name, Action Act)>
        {
            ("wire", () => Click(toolbar.Wire)),
            ("zoom-in", () => Click(toolbar.ZoomIn)),
            ("zoom-out", () => Click(toolbar.ZoomOut)),
            ("pan", () => Click(toolbar.PanLeft)),
            ("fit", () => Click(toolbar.Fit)),
        };
        if (_boot.CurrentStage3D is { } stage3D)
        {
            var point = GetViewport().GetVisibleRect().Size * new Vector2(0.4f, 0.65f);
            steps.Add(("orbit", () =>
            {
                RouteGuiAt(chrome.Toolbar, MouseButtonEvent(true, buttonIndex: MouseButton.Right), point);
                GetViewport().PushInput(new InputEventMouseMotion { Position = point + new Vector2(40, 10), GlobalPosition = point + new Vector2(40, 10), Relative = new Vector2(40, 10) }, inLocalCoords: true);
                RouteGuiAt(chrome.Toolbar, MouseButtonEvent(false, buttonIndex: MouseButton.Right), point + new Vector2(40, 10));
            }));
            steps.Add(("drag-pan", () =>
            {
                RouteGuiAt(chrome.Toolbar, MouseButtonEvent(true, buttonIndex: MouseButton.Middle), point);
                GetViewport().PushInput(new InputEventMouseMotion { Position = point + new Vector2(30, 20), GlobalPosition = point + new Vector2(30, 20), Relative = new Vector2(30, 20) }, inLocalCoords: true);
                RouteGuiAt(chrome.Toolbar, MouseButtonEvent(false, buttonIndex: MouseButton.Middle), point + new Vector2(30, 20));
            }));
            steps.Add(("wheel", () =>
            {
                RouteGuiAt(chrome.Toolbar, MouseButtonEvent(true, buttonIndex: MouseButton.WheelDown), point);
                RouteGuiAt(chrome.Toolbar, MouseButtonEvent(false, buttonIndex: MouseButton.WheelDown), point);
            }));
            steps.Add(("key-wire", () => PushKey(Key.W)));
            steps.Add(("key-reset", () => PushKey(Key.R)));
        }
        else
        {
            steps.Add(("key-pan", () => PushKey(Key.Left)));
            steps.Add(("key-wire", () => PushKey(Key.W)));
            steps.Add(("key-fit", () => PushKey(Key.Key0)));
        }
        foreach (var step in steps)
        {
            ClearFocus();
            var before = Probe();
            var viewBefore = CameraView();
            step.Act();
            if (Probe() != before || CameraView() == viewBefore) failures.Add(step.Name);
        }

        var bannerPoint = chrome.Banner.GetGlobalRect().GetCenter() - new Vector2(chrome.Banner.Size.X / 4, 0);
        var viewAtBanner = CameraView();
        RouteGuiAt(chrome.Banner, MouseButtonEvent(true, buttonIndex: MouseButton.WheelUp), bannerPoint);
        RouteGuiAt(chrome.Banner, MouseButtonEvent(false, buttonIndex: MouseButton.WheelUp), bannerPoint);
        if (CameraView() != viewAtBanner) failures.Add("banner-wheel-leaked");

        var audio = Node<AudioRouter>("Audio");
        var mutedBefore = audio.Muted;
        Click(toolbar.Sound);
        var toggled = audio.Muted != mutedBefore;
        Click(toolbar.Sound);
        if (!toggled || audio.Muted != mutedBefore) failures.Add("sound");
        var help = Node<HelpCredits>("HelpCredits");
        Click(toolbar.Help);
        if (!help.IsOpen) failures.Add("help");
        help.Close();
        ClearFocus();
        Click(toolbar.Fit);
        Check("C2", "free-" + view, failures.Count == 0 && _lockMachine.Mutations == 0,
            failures.Count == 0 ? steps.Count + 3 + " work" : "dead: " + string.Join(",", failures));
    }

    private string CameraView() => _boot.CurrentStage3D is { } stage3D
        ? stage3D.Camera.CurrentPose + "/" + stage3D.Camera.Target
        : _boot.CurrentStage2D is { } stage ? stage.View + "/" + stage.ViewScale + "/" + stage.Pan : "none";

    private void CheckBanner(string view)
    {
        var chrome = Node<Chrome>("Chrome");
        var banner = chrome.Banner;
        var rect = banner.GetGlobalRect();
        var clear = !rect.Intersects(chrome.Toolbar.GetGlobalRect()) && rect.Size.X > 0 &&
            rect.End.X <= GetViewport().GetVisibleRect().Size.X &&
            (_boot.CurrentStage2D is not { } stage || stage.GetGlobalRect().Position.Y >= rect.End.Y);
        banner.WaitingText = "waiting for test-route · request 2 · 14 s";
        var text = banner.Visible && banner.Title.Text == Banner.Headline &&
            banner.Waiting.Text == "waiting for test-route · request 2 · 14 s";
        banner.WaitingText = "";
        // The banner's buttons follow the dock's rules: this lock is no chat session, so both are off and inert.
        var stops = _bannerStops;
        var ends = _bannerEnds;
        Click(banner.Stop);
        Click(banner.EndSession);
        Activate(banner.Stop);
        Activate(banner.EndSession);
        var buttons = _bannerStops == stops && _bannerEnds == ends && banner.Stop.Disabled && banner.EndSession.Disabled &&
            !_boot.CurrentChat.Model.CanStop && !_boot.CurrentChat.Model.CanEnd &&
            banner.Stop.FocusMode == Control.FocusModeEnum.All && banner.EndSession.FocusMode == Control.FocusModeEnum.All &&
            banner.Stop.TooltipText.Length > 0 && banner.EndSession.TooltipText.Length > 0 &&
            banner.Waiting.Text.Length == 0;
        ClearFocus();
        Check("C2", "banner-" + view, clear && text && buttons && _lockMachine.Mutations == 0,
            $"clear={(clear ? 1 : 0)} text={(text ? 1 : 0)} buttons={(buttons ? 1 : 0)}");
    }

    // ---------------------------------------------------------------- C6: end to end against the real pane server
    // docs/plans/godot-chat-pane.md, C6. `npm run godot-pane-e2e` (test/pane/godot-e2e.godot.ts) starts
    // tools/hands-pane/server.ts with a scripted fake model and launches this suite with the link the server
    // printed (--pane-link). The socket is the real one. `pane-e2e`: the model wires checklist item B1, then
    // End session; `pane-quit`: the app quits with the session live. The Node side checks the run folder.
    // Waits are bounded by the wall clock, not frames: a headless run's frame rate is not fixed.

    private const string E2EPrompt = "Plug a cord from 1+ to 1A and another from 1B to 1-, then turn the power on.";
    private const string E2EFinalText = "Lamp 1 is on.";
    private int _e2eWatch; // 0 before the first adopt, 1 from it until End session is pressed, 2 after
    private int _e2eLockedFrames;
    private int _e2eLockBreaks;
    private string _e2eFirstBreak = "";

    private void RunPaneE2E(bool quit)
    {
        var link = PaneLink.FromArgs(OS.GetCmdlineUserArgs());
        if (string.IsNullOrEmpty(link))
        {
            HarnessFailure("no " + PaneLink.Flag + " <link> after --");
            return;
        }
        // As Boot.Start connects a link given at launch.
        ChatChrome.SelectColumn(chat: true, focus: false);
        Dock.ConnectLink(link);
        E2EWait("the pane server's ready", () => Dock.Model.Connection.State != PaneLinkState.Connecting, 20, () =>
        {
            var ready = Dock.Model.Ready && Dock.Status.Text == "connected" && Dock.Model.Connection.Routes.FirstOrDefault() == "model-a" &&
                !_boot.Adopted && !_session.Locked && !_session.Frozen;
            Check("C6", "connected", ready,
                $"status={Dock.Status.Text} problem={Dock.Model.LinkProblem} routes={string.Join(",", Dock.Model.Connection.Routes)}");
            if (!ready)
            {
                Finish();
                return;
            }
            Dock.Message.Text = E2EPrompt;
            E2EAfterFrames(1, () =>
            {
                // The dock's own send path: its Send button, enabled by the text in the box.
                var enabled = !Dock.Send.Disabled;
                Click(Dock.Send);
                var sent = Dock.Model.Busy && Dock.Message.Text.Length == 0 && Dock.Model.Entries.Any(entry => entry.Kind == ChatEntryKind.User && entry.Text == E2EPrompt);
                Check("C6", "send", enabled && sent, $"enabled={(enabled ? 1 : 0)} busy={(Dock.Model.Busy ? 1 : 0)}");
                E2EWait("the model's turn to end (done)", () => !Dock.Model.Busy, 30, () => E2ESessionChecks(quit));
            });
        });
    }

    // From the first adopt until End session is pressed, every frame: the engine's machine, frozen and locked.
    private void E2EWatchLock()
    {
        if (_e2eWatch == 0 && _boot.Adopted) _e2eWatch = 1;
        if (_e2eWatch != 1) return;
        var chrome = ChatChrome;
        var locked = _boot.Adopted && _session.Locked && _session.Frozen && Node<Controls>("Controls").Locked && Node<Cords>("Cords").Locked &&
            chrome.Banner.Visible && chrome.Toolbar.Library.Disabled && chrome.Toolbar.Reset.Disabled &&
            ReferenceEquals(_session.CurrentMachine, Dock.Model.EngineMachine) && Dock.Model.Run is not null;
        if (locked)
        {
            _e2eLockedFrames++;
            return;
        }
        if (_e2eLockBreaks++ == 0)
        {
            _e2eFirstBreak = $"frame {_e2eLockedFrames}: adopted={(_boot.Adopted ? 1 : 0)} locked={(_session.Locked ? 1 : 0)} frozen={(_session.Frozen ? 1 : 0)} " +
                $"banner={(chrome.Banner.Visible ? 1 : 0)} run={Dock.Model.Run}";
        }
    }

    private void E2ESessionChecks(bool quit)
    {
        var model = Dock.Model;
        var run = model.Run;
        var entries = model.Entries;
        var replies = entries.Where(entry => entry.Kind == ChatEntryKind.Model).ToList();
        var calls = replies.SelectMany(entry => entry.Calls).ToList();
        var transcript = run is not null && Dock.Status.Text == "session " + run &&
            entries.Count(entry => entry.Kind == ChatEntryKind.Problem) == 0 &&
            replies.Count == 3 && replies[^1].Text == E2EFinalText &&
            replies.All(entry => entry.Badge == "served by http://primary.test/v1") &&
            calls.Select(call => call.Head).SequenceEqual(["minivac-control new pane.json", "minivac-control pane.json connect 1+/1A + connect 1B/1- + power on"]) &&
            calls.All(call => call.Open) && calls[^1].Output.Contains("ok  connect 1+/1A  -> cord 0 (1+#1 1A#1)\nok  connect 1B/1-  -> cord 1 (1B#1 1-#1)", StringComparison.Ordinal);
        Check("C6", "transcript", transcript,
            $"run={run} replies={replies.Count} calls={string.Join(" | ", calls.Select(call => call.Head))} problems={entries.Count(entry => entry.Kind == ChatEntryKind.Problem)}");

        var lockHeld = _e2eWatch == 1 && _e2eLockBreaks == 0 && _e2eLockedFrames > 0;
        Check("C6", "adopted-frozen-locked-from-create", lockHeld,
            $"locked-frames={_e2eLockedFrames} breaks={_e2eLockBreaks} {_e2eFirstBreak}");

        var state = _session.CurrentMachine!.Snapshot();
        var cords = Node<Cords>("Cords");
        var lamps = Node<Lamps>("Lamps");
        var power = FindButton(Node<Controls>("Controls"), "power", null);
        var views = state.power && state.outLamps[0].cls == LampClass.@on && state.cords.Length == 2 &&
            cords.CordsState.Count == 2 && Node<CordList>("CordList").RowCount == 2 && power.ButtonPressed &&
            lamps.Levels[0] == state.outLamps[0].milli / 1000.0 && lamps.Levels[0] > 0 && lamps.JewelLit;
        Check("C6", "views-cords-and-lamp-" + _boot.CurrentViewMode, views,
            $"power={(state.power ? 1 : 0)} lamp1={state.outLamps[0].cls}/{lamps.Levels[0]:0.000} cords={state.cords.Length}/{cords.CordsState.Count}");
        var shown = ShownMarks(out var sound, out var detail);
        Check("C6", "marks-on-last-call-cords-" + _boot.CurrentViewMode,
            sound && model.MarkedCords.Order().SequenceEqual([0, 1]) && shown.SequenceEqual([0, 1]), detail);

        if (quit)
        {
            // The plan's "quitting is the web's reload": the app goes with the session live; Node checks the run.
            Check("C6", "session-live-at-quit", run is not null && _boot.Adopted && model.Ready, "run=" + run);
            GD.Print("acceptance: quitting mid-session, run " + run);
            Finish();
            return;
        }

        // A panel input while the model has the machine reaches nothing.
        var machine = _session.CurrentMachine;
        var tick = state.tick;
        var refused = _session.RefusedWhileLocked;
        RoutePanelGui(power, MouseButtonEvent(true));
        RoutePanelGui(power, MouseButtonEvent(false));
        var clicked = Time.GetTicksMsec();
        E2EWait("250 ms after the locked click", () => Time.GetTicksMsec() >= clicked + 250, 5, () =>
        {
            var after = _session.CurrentMachine!.Snapshot();
            var inert = ReferenceEquals(_session.CurrentMachine, machine) && after.power && after.cords.Length == 2 &&
                after.outLamps[0].cls == LampClass.@on && _session.RefusedWhileLocked == refused;
            Check("C6", "locked-input-changes-nothing", inert, $"power={(after.power ? 1 : 0)} cords={after.cords.Length} refused={_session.RefusedWhileLocked - refused}");
            Check("C6", "frozen-between-calls", after.tick == tick, $"tick {tick}->{after.tick} over 250 ms");
            _boot.ToggleViewMode();
            E2EAfterFrames(3, () =>
            {
                var meshes = _boot.CurrentStage3D?.CordMeshes.GetChildren().Count(node => node.Name.ToString().StartsWith("Cord_", StringComparison.Ordinal));
                var marks3D = ShownMarks(out var sound3D, out var detail3D);
                Check("C6", "views-and-marks-3d", _boot.CurrentViewMode == "3d" && meshes == 2 && sound3D && marks3D.SequenceEqual([0, 1]) &&
                    _session.Locked && _boot.Adopted, $"meshes={meshes} {detail3D}");
                _boot.ToggleViewMode();
                E2EAfterFrames(3, () => E2EEndSession(machine!));
            });
        });
    }

    private void E2EEndSession(Machine machine)
    {
        _e2eWatch = 2;
        var enabled = !Dock.EndSession.Disabled;
        Click(Dock.EndSession);
        E2EWait("the server's ended after End session", () => !_boot.Adopted && Dock.Model.Run is null && !Dock.Model.Ending, 15, () =>
        {
            var chrome = ChatChrome;
            var state = _session.CurrentMachine!.Snapshot();
            var last = Dock.Model.Entries[^1];
            var handedBack = enabled && last.Kind == ChatEntryKind.Note && last.Text == "Session ended: the machine is live and unlocked." &&
                Dock.Status.Text == "connected";
            var live = !_session.Locked && !_session.Frozen && !Node<Controls>("Controls").Locked && !Node<Cords>("Cords").Locked &&
                !chrome.Banner.Visible && !chrome.Toolbar.Library.Disabled && !chrome.Toolbar.Reset.Disabled;
            var same = ReferenceEquals(_session.CurrentMachine, machine) && state.cords.Length == 2 && state.power &&
                Node<Cords>("Cords").CordsState.Count == 2 && Dock.Model.MarkedCords.Count == 0 && ShownMarks(out _, out _).Length == 0;
            Check("C6", "end-session-live-unlocked", handedBack && live, $"enabled={(enabled ? 1 : 0)} note={last.Text} status={Dock.Status.Text}");
            Check("C6", "same-machine-circuit-plugged-in", same, $"cords={state.cords.Length} power={(state.power ? 1 : 0)} marks={Dock.Model.MarkedCords.Count}");
            var tick = state.tick;
            E2EWait("simulated time to run after End session", () => _session.CurrentMachine!.Snapshot().tick > tick, 5, () =>
            {
                Check("C6", "time-runs-after-end", true, $"tick {tick}->{_session.CurrentMachine!.Snapshot().tick}");
                // The same panel input now reaches the machine: Power goes off.
                var power = FindButton(Node<Controls>("Controls"), "power", null);
                RoutePanelGui(power, MouseButtonEvent(true));
                RoutePanelGui(power, MouseButtonEvent(false));
                E2EWait("the power to go off after the panel click", () => !_session.CurrentMachine!.Snapshot().power, 5, () =>
                {
                    var after = _session.CurrentMachine!.Snapshot();
                    Check("C6", "live-input-reaches-machine", !after.power && after.cords.Length == 2 && ReferenceEquals(_session.CurrentMachine, machine),
                        $"power={(after.power ? 1 : 0)} cords={after.cords.Length}");
                    Finish();
                });
            });
        });
    }

    /// <summary>Runs <paramref name="then"/> once <paramref name="until"/> holds; fails the suite after <paramref name="seconds"/> of wall time.</summary>
    private void E2EWait(string what, Func<bool> until, double seconds, Action then)
    {
        var deadline = Time.GetTicksMsec() + (ulong)(seconds * 1000);
        ArmFramed("C6", () =>
        {
            // Bounded by the clock below, not the harness's frame count.
            _framedFrames = 0;
            E2EWatchLock();
            if (!until())
            {
                if (Time.GetTicksMsec() < deadline) return;
                _framedStep = null;
                Check("C6", "timeout", false, $"waited {seconds} s for {what}; status={Dock.Status.Text}");
                Finish();
                return;
            }
            _framedStep = null;
            then();
        });
    }

    private void E2EAfterFrames(int frames, Action then)
    {
        var left = frames;
        E2EWait(frames + " frames", () => --left < 0, 10, then);
    }

    // ---------------------------------------------------------------- C4: the chat dock
    // docs/plans/godot-chat-pane.md, "The dock's states", "Focus" and "Layout", on the scripted transport
    // with injected input. `--shots <dir>` saves the screenshots the orchestrator reviews.

    private sealed record ChatStep(Action Act, int Wait, Func<bool>? Until, int MaxFrames);

    private const string ChatLink = "http://127.0.0.1:5173/dev.html#t=c4-test-token&port=9123";
    private const string ChatReady = "{\"type\":\"ready\",\"routes\":[\"model-a\",\"model-b\"],\"maxUserChars\":8000}";
    private const string ChatRunFrame =
        "{\"type\":\"request\",\"id\":2,\"op\":\"run\",\"calls\":[{\"name\":\"connect\",\"args\":{\"a\":\"1+\",\"b\":\"1A\"}}," +
        "{\"name\":\"power\",\"args\":{\"on\":true}}],\"settleMs\":500}";
    private const string ChatTurnFrame =
        "{\"type\":\"turn\",\"turn\":1,\"status\":200,\"servedBy\":\"host-a\",\"fallbacks\":0,\"costUsd\":0.00125,\"offPrimary\":false," +
        "\"content\":\"I wired terminal 1+ to 1A and switched the power on.\",\"calls\":[" +
        "{\"name\":\"minivac_control\",\"args\":\"{\\\"args\\\":\\\"pane.json connect 1+/1A + power on\\\"}\"," +
        "\"output\":\"ok  connect 1+/1A\\nok  power on\\nsettled after 500 ms\"}," +
        "{\"name\":\"read_file\",\"args\":\"{\\\"path\\\":\\\"pane.json\\\"}\",\"output\":\"{ \\\"schema\\\": \\\"minivac.session/1\\\" }\"}]}";

    private readonly List<ChatStep> _chatSteps = [];
    private FakePaneTransport? _chatFake;
    private string? _shotDir;
    private int _chatFrames;
    private int _chatAt;
    private int _chatWait;
    private Func<bool>? _chatUntil;
    private int _chatUntilFrames;
    private int _chatUntilMax;
    private string _chatCreate = "";
    private string _chatExpectedRun = "";
    private string _chatView = "";
    private bool _chatTyped;
    private string _chatWaitingBefore = "";
    private double _chatWorstFrame;
    private ulong _chatFrameUs;
    private int _chatFramesAfter;
    private int _chatSentAtNew;
    private string _chatSoundText = "";

    private void PrepareChat()
    {
        _chatFake = new FakePaneTransport();
        GetWindow().Size = new Vector2I(1152, 640);
        var args = OS.GetCmdlineUserArgs();
        var at = Array.IndexOf(args, "--shots");
        if (at >= 0 && at + 1 < args.Length) _shotDir = args[at + 1];
    }

    private void RunChat()
    {
        _chatView = _boot.CurrentViewMode;
        var netlist = Netlist.LoadNetlist(_source.ReadAllBytes("data/netlist.json"));
        using var refADocument = JsonDocument.Parse(_source.ReadAllBytes("data/profiles/MV601-REF-A.json"));
        using var idealDocument = JsonDocument.Parse(_source.ReadAllBytes("data/profiles/MV601-IDEAL.json"));
        var refA = Profile.LoadProfile(refADocument.RootElement);
        var ideal = Profile.LoadProfile(idealDocument.RootElement);
        _chatCreate = "{\"type\":\"request\",\"id\":1,\"op\":\"create\",\"session\":" + HandsJson.Session(Table.newSession(netlist, refA)) + "}";
        var twin = new PaneEngine(netlist, [refA, ideal]);
        PaneJson.Answer(twin, _chatCreate);
        _chatExpectedRun = PaneJson.Answer(twin, ChatRunFrame) ?? "";

        // The dock's clocks run only when the suite ticks them (the waiting line, connect and End session limits).
        Dock.FrameSeconds = _ => 0;
        ChatLayoutAndSetup();
        ChatLinkRows();
        ChatReadyRows();
        ChatSessionFlow();
        ChatMarkdownReply();
        ChatWheel();
        ChatEngineError();
        ChatMarks();
        ChatLost();
        ChatTimeouts();

        _chatAt = 0;
        _chatWait = 0;
        ArmFramed("C4", () =>
        {
            if (_chatWait > 0)
            {
                _chatWait--;
                return;
            }
            if (_chatUntil is { } until)
            {
                if (!until() && ++_chatUntilFrames < _chatUntilMax) return;
                _chatUntil = null;
            }
            if (_chatAt >= _chatSteps.Count)
            {
                _framedStep = null;
                Finish();
                return;
            }
            var step = _chatSteps[_chatAt++];
            step.Act();
            _chatWait = step.Wait;
            _chatUntil = step.Until;
            _chatUntilFrames = 0;
            _chatUntilMax = step.MaxFrames;
        });
    }

    private void Then(Action act, int wait = 2) => _chatSteps.Add(new ChatStep(act, wait, null, 0));

    private void ThenUntil(Action act, Func<bool> until, int maxFrames) => _chatSteps.Add(new ChatStep(act, 1, until, maxFrames));

    private ChatDock Dock => _boot.CurrentChat;

    private Chrome ChatChrome => Node<Chrome>("Chrome");

    private List<string> Sent => _chatFake!.Sent;

    private void ChatCheck(string check, bool passed, string detail) => Check("C4", check + "-" + _chatView, passed, detail);

    /// <summary>The banner's Stop and End session mirror the dock's.</summary>
    private bool BannerMirrors() =>
        ChatChrome.Banner.Stop.Disabled == Dock.Stop.Disabled && ChatChrome.Banner.EndSession.Disabled == Dock.EndSession.Disabled;

    private string ChatEnables()
    {
        var dock = Dock;
        static char On(BaseButton button) => button.Disabled ? '0' : '1';
        return "send=" + On(dock.Send) + " route=" + On(dock.Route) + " stop=" + On(dock.Stop) + " new=" + On(dock.NewSession) +
            " end=" + On(dock.EndSession) + " connect=" + On(dock.ConnectButton);
    }

    private List<string> ChatKinds() =>
        Dock.Entries.GetChildren().OfType<Control>().Where(child => child.Visible && child.HasMeta("kind"))
            .Select(child => child.GetMeta("kind").AsString()).ToList();

    private Control? ChatLastEntry() =>
        Dock.Entries.GetChildren().OfType<Control>().LastOrDefault(child => child.HasMeta("kind") && !child.IsQueuedForDeletion());

    private static string EntryText(Control? entry) => entry?.FindChild("Text", true, false) switch
    {
        Label label => label.Text,
        RichTextLabel rich => rich.GetParsedText(),
        _ => "",
    };

    private string FocusName() => GetViewport().GuiGetFocusOwner()?.Name.ToString() ?? "none";

    private void ChatKey(Key key, bool shift = false, char text = '\0')
    {
        foreach (var pressed in new[] { true, false })
        {
            GetViewport().PushInput(new InputEventKey
            {
                Keycode = key,
                PhysicalKeycode = key,
                Unicode = text,
                ShiftPressed = shift,
                Pressed = pressed,
            });
        }
    }

    private void TypeText(string text)
    {
        foreach (var character in text)
        {
            var key = character switch
            {
                '/' => Key.Slash,
                >= 'a' and <= 'z' => Key.A + (character - 'a'),
                >= '0' and <= '9' => Key.Key0 + (character - '0'),
                ' ' => Key.Space,
                _ => Key.None,
            };
            ChatKey(key, text: character);
        }
    }

    private void Shot(string name)
    {
        if (_shotDir is null) return;
        DirAccess.MakeDirRecursiveAbsolute(_shotDir);
        using var image = GetViewport().GetTexture().GetImage();
        var path = _shotDir.TrimEnd('/') + "/" + name + ".png";
        var saved = image.SavePng(path);
        GD.Print("acceptance: shot " + path + " " + saved + " " + image.GetWidth() + "x" + image.GetHeight());
    }

    // The column, the insets and the 3D framing, Cords then Chat; then the No link row.
    private void ChatLayoutAndSetup()
    {
        Then(() =>
        {
            var chrome = ChatChrome;
            var width = GetViewport().GetVisibleRect().Size.X;
            var cordsColumn = !chrome.ChatSelected && chrome.CordList.Visible && !Dock.Visible &&
                chrome.CordList.Size.X == 248 && chrome.CordList.Position.X == width - 260 &&
                chrome.ChatTab.Visible && chrome.ChatTab.Text == "Chat" && chrome.ChatTab.TooltipText.Length > 0 &&
                chrome.CordsTab.ButtonPressed && !chrome.ChatTab.ButtonPressed;
            var framed = ChatStageFrame(0, out var detail);
            ChatCheck("column-cords", cordsColumn && framed, "list=248 " + detail);
            ChatCheck("toolbar-labels-fit", ToolbarFits(out var toolbarDetail), toolbarDetail);
            _chatSoundText = chrome.Toolbar.Sound.Text;
            chrome.Toolbar.SetSoundMuted(true);
        });
        Then(() =>
        {
            var chrome = ChatChrome;
            var fits = ToolbarFits(out var toolbarDetail);
            ChatCheck("toolbar-labels-fit-muted", fits && chrome.Toolbar.Sound.Text == "Sound muted", toolbarDetail);
            Shot("toolbar-sound-muted-" + _chatView);
            chrome.Toolbar.SetSoundMuted(_chatSoundText == "Sound muted");
            ClearFocus();
            Click(chrome.ChatTab);
        });
        Then(() =>
        {
            var chrome = ChatChrome;
            var size = GetViewport().GetVisibleRect().Size;
            var dock = Dock;
            var chatColumn = chrome.ChatSelected && !chrome.CordList.Visible && dock.Visible && dock.Size.X == 360 &&
                dock.Position.X == size.X - 372 && dock.Position.Y == 100 && dock.Size.Y == size.Y - 112 &&
                chrome.ChatTab.ButtonPressed && !chrome.CordsTab.ButtonPressed &&
                dock.MouseFilter == Control.MouseFilterEnum.Stop && !dock.MouseForcePassScrollEvents;
            var framed = ChatStageFrame(384, out var detail);
            ChatCheck("column-chat", chatColumn && framed,
                $"dock={dock.Position.X}+{dock.Size.X}x{dock.Size.Y} " + detail);
            var row = dock.Status.Text == "not connected" && dock.SetupCard.Visible &&
                dock.SetupText.Text.Contains("tools/hands-pane/README.md", StringComparison.Ordinal) &&
                dock.SetupText.Text.Contains("model of your own", StringComparison.Ordinal) && dock.LinkField.Visible &&
                ChatEnables() == "send=0 route=0 stop=0 new=1 end=0 connect=1" && ChatKinds().Count == 0 &&
                dock.LinkField.HasFocus();
            ChatCheck("row-no-link", row, $"status={dock.Status.Text} {ChatEnables()} focus={FocusName()}");
            var tooltips = new Control[]
            {
                dock.LinkField, dock.ConnectButton, dock.Transcript, dock.Message, dock.Route, dock.Send, dock.Stop,
                dock.NewSession, dock.EndSession, chrome.CordsTab, chrome.ChatTab,
            };
            var focusable = tooltips.All(control => control.TooltipText.Length > 0 && control.FocusMode == Control.FocusModeEnum.All);
            var focusStyles = tooltips.All(control => control.HasThemeStylebox("focus")) && dock.Transcript.DrawFocusBorder;
            ChatCheck("tooltips-focus", focusable && focusStyles, $"{tooltips.Length} controls");
        }, 3);
        Then(() => Shot("1-setup-card-" + _chatView), 1);
    }

    /// <summary>
    /// Every toolbar label, Sound's in both its texts, fits inside its own button; the buttons do not overlap
    /// and the row fits the toolbar.
    /// </summary>
    private bool ToolbarFits(out string detail)
    {
        var toolbar = ChatChrome.Toolbar;
        var problems = new List<string>();
        var widths = new List<string>();
        var end = float.NegativeInfinity;
        foreach (var button in toolbar.GetChildren().OfType<Button>())
        {
            var font = button.GetThemeFont("font");
            var size = button.GetThemeFontSize("font_size");
            var margins = button.GetThemeStylebox("normal").GetMinimumSize().X;
            var texts = ReferenceEquals(button, toolbar.Sound) ? new[] { "Sound on", "Sound muted" } : [button.Text];
            foreach (var text in texts)
            {
                var need = font.GetStringSize(text, HorizontalAlignment.Left, -1, size).X + margins;
                if (need > button.Size.X + 0.5f) problems.Add($"{text}:{need:0}>{button.Size.X:0}");
            }
            if (button.Position.X < end + 4 - 0.5f) problems.Add($"{button.Name}-overlaps");
            end = button.Position.X + button.Size.X;
            widths.Add($"{button.Name}={button.Size.X:0}");
        }
        if (end > toolbar.Size.X + 0.5f) problems.Add($"row={end:0}>{toolbar.Size.X:0}");
        detail = $"row={end:0}/{toolbar.Size.X:0} " + (problems.Count == 0 ? string.Join(",", widths) : string.Join(" ", problems));
        return problems.Count == 0;
    }

    // Flat: the stage's right edge. 3D: the panel quad's projection inside the area left of the inset.
    private bool ChatStageFrame(float inset, out string detail)
    {
        var size = GetViewport().GetVisibleRect().Size;
        if (_boot.CurrentStage2D is { } stage)
        {
            var rect = stage.GetGlobalRect();
            var panel = _boot.CurrentPanel.GetGlobalRect();
            var right = inset == 0 ? 272 : inset;
            detail = $"stage={rect.Position.X:0}..{rect.End.X:0}x{rect.Position.Y:0}..{rect.End.Y:0} console={panel.Size.X:0}x{panel.Size.Y:0}";
            return Math.Abs(rect.End.X - (size.X - right)) < 0.5f && panel.End.X <= size.X - right + 0.5f;
        }
        var stage3D = _boot.CurrentStage3D!;
        var camera = stage3D.Camera;
        var mesh = (QuadMesh)stage3D.PanelQuad.Mesh;
        var corners = new[] { new Vector3(-0.5f, -0.5f, 0), new Vector3(0.5f, -0.5f, 0), new Vector3(0.5f, 0.5f, 0), new Vector3(-0.5f, 0.5f, 0) }
            .Select(corner => camera.UnprojectPosition(stage3D.PanelQuad.GlobalTransform * new Vector3(corner.X * mesh.Size.X, corner.Y * mesh.Size.Y, 0)))
            .ToArray();
        var left = corners.Min(point => point.X);
        var right3D = corners.Max(point => point.X);
        var top = corners.Min(point => point.Y);
        var bottom = corners.Max(point => point.Y);
        var axis = camera.UnprojectPosition(camera.Target);
        var area = size.X - inset;
        detail = $"inset={camera.RightInset:0} axis={axis.X:0.0} console={left:0}..{right3D:0}x{top:0}..{bottom:0}";
        return camera.RightInset == inset && Math.Abs(axis.X - area / 2) < 1 && left >= 0 && right3D <= area && top >= 0 && bottom <= size.Y;
    }

    // Connecting, could not connect, token refused, other build: each shows the setup card and its status.
    private void ChatLinkRows()
    {
        Then(() =>
        {
            TypeText(ChatLink.ToLowerInvariant());
            ChatKey(Key.Enter);
        });
        Then(() =>
        {
            var dock = Dock;
            var row = dock.Status.Text == "connecting…" && dock.SetupCard.Visible && dock.LinkField.Text.Length == 0 &&
                _chatFake!.Link?.Token == "c4-test-token" && _chatFake.Link.Port == 9123 &&
                ChatEnables() == "send=0 route=0 stop=0 new=1 end=0 connect=0";
            ChatCheck("row-connecting", row, $"status={dock.Status.Text} field={dock.LinkField.Text.Length} {ChatEnables()}");
            _chatFake!.Refuse();
        });
        foreach (var (name, code, status) in new[]
        {
            ("row-could-not-connect", 0, "disconnected: could not connect to 127.0.0.1:9123: the pane server is not running"),
            ("row-refused-token", 4001, "disconnected: " + PaneConnection.BadTokenReason),
            ("row-refused-build", 4002, "disconnected: " + PaneConnection.BadProtocolReason),
        })
        {
            Then(() =>
            {
                var dock = Dock;
                var row = dock.Status.Text.StartsWith(status, StringComparison.Ordinal) && dock.SetupCard.Visible &&
                    ChatEnables() == "send=0 route=0 stop=0 new=1 end=0 connect=1" && ChatKinds().Count == 0;
                ChatCheck(name, row, $"status={dock.Status.Text} {ChatEnables()}");
                if (code == 0) LinkFieldForgets(dock);
                if (code == 4002) return;
                // Connect again by the mouse: paste into the field, then the Connect button.
                dock.LinkField.Text = ChatLink;
                Click(dock.ConnectButton);
                _chatFake!.Open();
                _chatFake.CloseFromServer(code == 0 ? 4001 : 4002);
            });
        }
    }

    // After Connect read the link and the field is editable again, nothing brings the token back.
    private void LinkFieldForgets(ChatDock dock)
    {
        // The token is gone from the field: Undo and Redo by key and by the context menu's actions bring back nothing.
        var clipboard = DisplayServer.ClipboardGet();
        var field = dock.LinkField;
        field.GrabFocus();
        var tries = new List<string>();
        // Undo and Redo by key, as macOS (Command) and the other desktops (Ctrl) bind them; then by the menu's actions.
        foreach (var (name, redo) in new[] { ("undo", false), ("undo", false), ("redo", true), ("undo", false), ("undo", false) })
        {
            foreach (var command in new[] { true, false })
            {
                foreach (var pressed in new[] { true, false })
                {
                    GetViewport().PushInput(new InputEventKey
                    {
                        Keycode = Key.Z, PhysicalKeycode = Key.Z, MetaPressed = command, CtrlPressed = !command, ShiftPressed = redo, Pressed = pressed,
                    });
                }
                tries.Add((command ? "cmd-" : "ctrl-") + name + "=" + field.Text.Length);
            }
        }
        foreach (var item in new[] { LineEdit.MenuItems.Undo, LineEdit.MenuItems.Undo, LineEdit.MenuItems.Redo, LineEdit.MenuItems.Undo })
        {
            field.MenuOption((int)item);
            tries.Add(item + "=" + field.Text.Length);
        }
        var gone = tries.Count == 14 && tries.All(text => text.EndsWith("=0", StringComparison.Ordinal)) && field.Text.Length == 0 && !field.Text.Contains("c4-test-token", StringComparison.Ordinal) &&
            DisplayServer.ClipboardGet() == clipboard && field.HasFocus();
        ChatCheck("link-field-forgets-token", gone, string.Join(" ", tries));
        ClearFocus();
    }

    // Ready with no session; the tab order; the 8,000-character cap; the focus rules.
    private void ChatReadyRows()
    {
        Then(() =>
        {
            Dock.LinkField.GrabFocus();
            TypeText(ChatLink.ToLowerInvariant());
            ChatKey(Key.Enter);
            _chatFake!.Open();
            _chatFake.Receive(ChatReady);
        });
        Then(() =>
        {
            var dock = Dock;
            var hello = Sent.Count > 0 && Sent[^1] == "{\"type\":\"hello\",\"protocol\":3,\"token\":\"c4-test-token\"}";
            var row = dock.Status.Text == "connected" && !dock.SetupCard.Visible && ChatKinds().SequenceEqual(["Note"]) &&
                EntryText(ChatLastEntry()) == ChatModel.ReadyNote && dock.Route.ItemCount == 2 &&
                dock.Route.GetItemText(dock.Route.Selected) == "model-a" &&
                ChatEnables() == "send=0 route=1 stop=0 new=1 end=0 connect=0" && dock.Message.HasFocus();
            ChatCheck("row-ready", hello && row, $"hello={(hello ? 1 : 0)} status={dock.Status.Text} kinds={string.Join(",", ChatKinds())} {ChatEnables()} focus={FocusName()}");
            TypeText("x");
        });
        Then(() =>
        {
            ChatCheck("send-follows-box", ChatEnables() == "send=1 route=1 stop=0 new=1 end=0 connect=0", ChatEnables());
            Shot("2-ready-" + _chatView);
            // Tab order: toolbar, column tabs, transcript, message box, route, Send, Stop, New session, End session.
            ChatChrome.Toolbar.PanDown.GrabFocus();
            var path = new List<string>();
            for (var step = 0; step < 9; step++)
            {
                ChatKey(Key.Tab);
                path.Add(FocusName());
            }
            string[] expected = ["CordsTab", "ChatTab", "Transcript", "Message", "Route", "Send", "Stop", "NewSession", "EndSession"];
            // Disabled Stop and End session may or may not take focus; every other control must, in order.
            var prefix = path.TakeWhile(expected.Contains).ToList();
            var ordered = prefix.SequenceEqual(expected.Where(prefix.Contains)) &&
                expected.Where(name => name is not ("Stop" or "EndSession")).All(prefix.Contains);
            ChatCheck("tab-order", ordered, string.Join(">", path));
        }, 1);
        Then(() =>
        {
            // The cap: 7,998 characters in the box, five typed, 8,000 kept.
            var message = Dock.Message;
            message.GrabFocus();
            message.Text = new string('a', 7998);
            message.SetCaretColumn(7998);
            TypeText("bcdef");
        });
        Then(() =>
        {
            // The box caps what it is given once its text has changed (TextEdit reports a change after the frame).
            var message = Dock.Message;
            _chatTyped = message.Text.Length == 8000 && message.Text.EndsWith("bc", StringComparison.Ordinal);
            message.InsertTextAtCaret("pasted text");
        });
        Then(() =>
        {
            var message = Dock.Message;
            ChatCheck("cap-8000", _chatTyped && message.Text.Length == 8000,
                "typed=" + (_chatTyped ? 1 : 0) + " pasted=" + message.Text.Length.ToString(System.Globalization.CultureInfo.InvariantCulture));
            message.Text = "";
            // A focused box keeps the stage and camera shortcuts quiet; "/" types a slash.
            message.GrabFocus();
            var viewBefore = CameraView();
            var modeBefore = _boot.CurrentViewMode;
            TypeText("/fwr");
            ChatKey(Key.Key0, text: '0');
            ChatKey(Key.Left);
            ChatKey(Key.Up);
            var quiet = CameraView() == viewBefore && _boot.CurrentViewMode == modeBefore && message.Text == "/fwr0" &&
                message.HasFocus() && ChatChrome.ChatSelected;
            ChatCheck("box-keeps-keys", quiet, $"text={message.Text} mode={_boot.CurrentViewMode} focus={FocusName()}");
            var sent = Sent.Count;
            ChatKey(Key.Escape);
            var left = GetViewport().GuiGetFocusOwner() is null && Sent.Count == sent;
            ChatKey(Key.W, text: 'w');
            var live = CameraView() != viewBefore;
            ChatCheck("escape-leaves-box", left && live, $"focus={FocusName()} shortcuts-after={(live ? 1 : 0)}");
            message.Text = "";
            Click(ChatChrome.Toolbar.Fit);
            Click(ChatChrome.CordsTab);
            ClearFocus();
        });
        Then(() =>
        {
            // "/" from the console selects Chat and focuses the box; not while a text field has focus.
            var cordsFirst = !ChatChrome.ChatSelected;
            ChatKey(Key.Slash, text: '/');
            var selected = ChatChrome.ChatSelected && Dock.Message.HasFocus();
            ChatCheck("slash-selects-chat", cordsFirst && selected, $"selected={(ChatChrome.ChatSelected ? 1 : 0)} focus={FocusName()}");
            Click(ChatChrome.CordsTab);
            var picker = Node<Picker>("Picker");
            var shown = Node<Cords>("Cords").CordsState;
            if (shown.Count > 0) picker.Open(new EndpointRef(shown[0].id, CordSide.A));
            else Click(Node<CordList>("CordList").AddButton);
            ChatKey(Key.Slash, text: '/');
            var typed = !ChatChrome.ChatSelected && picker.Search.Text.EndsWith('/');
            ChatCheck("slash-in-text-field", typed && picker.Search.HasFocus(), $"selected={(ChatChrome.ChatSelected ? 1 : 0)} search={picker.Search.Text} focus={FocusName()}");
            picker.Close();
            ClearFocus();
            Click(ChatChrome.ChatTab);
            ChatCheck("chat-tab-focuses-box", ChatChrome.ChatSelected && Dock.Message.HasFocus(), "focus=" + FocusName());
            ClearFocus();
        });
    }

    // The scripted session, by keyboard only: message, started, create, waiting, served, run, turn, done, end, ended.
    private void ChatSessionFlow()
    {
        Then(() =>
        {
            ChatKey(Key.Slash, text: '/');
            TypeText("wire pushbutton 1 to lamp 1");
            ChatKey(Key.Enter, shift: true);
            TypeText("then press it");
            ChatKey(Key.Enter);
        });
        Then(() =>
        {
            var dock = Dock;
            var user = Sent.Count > 0 && Sent[^1] == "{\"type\":\"user\",\"text\":\"wire pushbutton 1 to lamp 1\\nthen press it\",\"route\":\"model-a\"}";
            var row = dock.Message.Text.Length == 0 && ChatKinds().Last() == "User" &&
                ChatEnables() == "send=0 route=0 stop=1 new=1 end=0 connect=0";
            ChatCheck("send-by-enter", user && row, $"sent={Sent[^1]} {ChatEnables()}");
            _chatFake!.Receive("{\"type\":\"started\",\"run\":\"2026-11-12-pane-1\"}");
            _chatFake.Receive(_chatCreate);
        });
        Then(() =>
        {
            var reply = Sent[^1] == "{\"type\":\"reply\",\"id\":1,\"reply\":\"created\"}";
            var locked = _boot.Adopted && _session.Locked && _session.Frozen && ChatChrome.Banner.Visible &&
                ChatChrome.Toolbar.Library.Disabled && Node<Controls>("Controls").Locked;
            var row = Dock.Status.Text == "session 2026-11-12-pane-1" && ChatChrome.ChatTab.Text == "Chat ●" &&
                EntryText(ChatLastEntry()) == "Session 2026-11-12-pane-1 started; the model must create pane.json." &&
                ChatEnables() == "send=0 route=0 stop=1 new=1 end=1 connect=0";
            ChatCheck("create-adopts-and-locks", reply && locked && row, $"reply={(reply ? 1 : 0)} locked={(locked ? 1 : 0)} status={Dock.Status.Text} tab={ChatChrome.ChatTab.Text}");
            if (_boot.CurrentStage2D is { } stage)
            {
                // Banner plus dock at 1152 x 640: the console still fits the stage, holes at the fit view.
                var rect = stage.GetGlobalRect();
                var console = _boot.CurrentPanel.GetGlobalRect();
                var hole = console.Size.X * PanelTheme.HoleDiameter;
                var fits = rect.Position.Y == 128 && rect.End.X == 768 && rect.Encloses(console) && console.Size.X >= 700;
                ChatCheck("console-with-banner", fits,
                    $"stage={rect.Position.X:0}..{rect.End.X:0}x{rect.Position.Y:0}..{rect.End.Y:0} console={console.Size.X:0}x{console.Size.Y:0} hole={hole:0.0}px");
            }
            _chatFake!.Receive("{\"type\":\"requesting\",\"turn\":1,\"route\":\"model-a\"}");
        }, 3);
        Then(() =>
        {
            var dock = Dock;
            var waiting = dock.WaitingLine.Visible && dock.WaitingLine.Text == "waiting for model-a · request 1 · 0 s" &&
                ChatChrome.Banner.WaitingText == dock.WaitingLine.Text && dock.Entries.GetChild(-1) == dock.WaitingLine;
            ChatCheck("row-request-out", waiting && ChatEnables() == "send=0 route=0 stop=1 new=1 end=1 connect=0" && BannerMirrors(),
                $"waiting={dock.WaitingLine.Text} banner={ChatChrome.Banner.WaitingText} {ChatEnables()} mirrors={(BannerMirrors() ? 1 : 0)}");
            Shot("3-request-out-" + _chatView);
            // Stop by keyboard from the box, and by the banner; Escape in the box never stops.
            dock.Message.GrabFocus();
            var sent = Sent.Count;
            ChatKey(Key.Escape);
            var escaped = Sent.Count == sent && GetViewport().GuiGetFocusOwner() is null;
            dock.Message.GrabFocus();
            var path = new List<string>();
            for (var step = 0; step < 4 && !dock.Stop.HasFocus(); step++)
            {
                ChatKey(Key.Tab);
                path.Add(FocusName());
            }
            ChatKey(Key.Enter);
            var stopped = Sent.Count == sent + 1 && Sent[^1] == "{\"type\":\"stop\"}";
            Click(ChatChrome.Banner.Stop);
            var bannerStop = Sent.Count == sent + 2 && Sent[^1] == "{\"type\":\"stop\"}";
            ChatCheck("stop-keyboard-and-banner", escaped && stopped && bannerStop,
                $"escape={(escaped ? 1 : 0)} path={string.Join(">", path)} stop={(stopped ? 1 : 0)} banner={(bannerStop ? 1 : 0)}");
            ClearFocus();
        });
        Then(() =>
        {
            _chatWaitingBefore = Dock.WaitingLine.Text;
            Dock.Model.Tick(0.75);
        });
        Then(() =>
        {
            _chatWaitingBefore += " > " + Dock.WaitingLine.Text;
            Dock.Model.Tick(0.25);
        });
        Then(() =>
        {
            var live = _chatWaitingBefore.EndsWith("· 0 s > waiting for model-a · request 1 · 0 s", StringComparison.Ordinal) &&
                Dock.WaitingLine.Text == "waiting for model-a · request 1 · 1 s" && ChatChrome.Banner.WaitingText == Dock.WaitingLine.Text;
            ChatCheck("waiting-clock", live, _chatWaitingBefore + " > " + Dock.WaitingLine.Text);
            _chatFake!.Receive("{\"type\":\"served\",\"turn\":1,\"status\":200,\"servedBy\":\"host-a\",\"fallbacks\":0,\"costUsd\":0.00125,\"offPrimary\":false}");
            _chatFake.Receive(ChatRunFrame);
        });
        Then(() =>
        {
            var reply = Sent[^1] == "{\"type\":\"reply\",\"id\":2,\"reply\":" + _chatExpectedRun + "}" && _chatExpectedRun.StartsWith("{\"ok\":true", StringComparison.Ordinal);
            var badge = ChatLastEntry()?.FindChild("Badge", true, false) as Label;
            var served = !Dock.WaitingLine.Visible && ChatChrome.Banner.WaitingText.Length == 0 && ChatKinds().Last() == "Model" &&
                badge?.Text == "served by host-a · $0.0013" && Dock.Model.LastRunReply == _chatExpectedRun;
            var cords = Node<Cords>("Cords");
            var power = FindButton(Node<Controls>("Controls"), "power", null);
            var views = cords.CordsState.Count == 1 && Node<CordList>("CordList").RowCount == 1 && power.ButtonPressed &&
                ReferenceEquals(_session.CurrentMachine, Dock.Model.EngineMachine) && _session.Locked &&
                (_boot.CurrentStage3D is not { } stage3D ||
                    stage3D.CordMeshes.GetChildren().Count(node => node.Name.ToString().StartsWith("Cord_", StringComparison.Ordinal)) == 1);
            ChatCheck("run-reply-and-views", reply && served && views,
                $"reply={(reply ? 1 : 0)} badge={badge?.Text} cords={cords.CordsState.Count} power={(power.ButtonPressed ? 1 : 0)}");
            _chatFake!.Receive(ChatTurnFrame);
        }, 3);
        Then(() =>
        {
            var entry = ChatLastEntry()!;
            var fold0 = entry.FindChild("Fold_0", true, false) as Button;
            var fold1 = entry.FindChild("Fold_1", true, false) as Button;
            var out0 = entry.FindChild("Output_0", true, false) as Label;
            var out1 = entry.FindChild("Output_1", true, false) as Label;
            var shown = EntryText(entry) == "I wired terminal 1+ to 1A and switched the power on." &&
                fold0?.Text == "▾ minivac-control pane.json connect 1+/1A + power on" && out0 is { Visible: true } &&
                out0.Text.StartsWith("ok  connect 1+/1A", StringComparison.Ordinal) &&
                fold1?.Text == "▸ read_file {\"path\":\"pane.json\"}" && out1 is { Visible: false };
            ChatCheck("row-reply-landed", shown, $"fold0={fold0?.Text} open0={out0?.Visible} fold1={fold1?.Text} open1={out1?.Visible}");
            // Tool output and its fold break lines between words, not inside them.
            var wrap = new Control?[] { fold0, fold1, out0, out1 }.Select(control => control switch
            {
                Label label => label.AutowrapMode,
                Button button => button.AutowrapMode,
                _ => (TextServer.AutowrapMode)(-1),
            }).ToArray();
            ChatCheck("output-word-wrap", wrap.All(mode => mode == TextServer.AutowrapMode.WordSmart), string.Join(",", wrap));
            Shot("4-reply-tool-call-" + _chatView);
            if (fold0 is null || fold1 is null || out0 is null || out1 is null) return;
            Click(fold1);
            fold0.GrabFocus();
            ChatKey(Key.Enter);
            var folded = out1.Visible && !out0.Visible && fold1.Text.StartsWith('▾') && fold0.Text.StartsWith('▸');
            Click(fold0);
            Click(fold1);
            folded &= out0.Visible && !out1.Visible;
            ChatCheck("fold-buttons", folded, $"open0={out0.Visible} open1={out1.Visible}");
            ClearFocus();
            _chatFake!.Receive("{\"type\":\"done\",\"stop\":\"done\",\"text\":\"I wired terminal 1+ to 1A.\"}");
        });
        Then(() =>
        {
            var sentBefore = Sent.Count;
            Click(ChatChrome.Banner.Stop);
            Dock.Model.Stop();
            var stopInert = Sent.Count == sentBefore && ChatChrome.Banner.Stop.Disabled;
            ChatCheck("done-enables", ChatEnables() == "send=0 route=1 stop=0 new=1 end=1 connect=0" && !Dock.Model.Busy && BannerMirrors() && stopInert,
                $"{ChatEnables()} mirrors={(BannerMirrors() ? 1 : 0)} stop-inert={(stopInert ? 1 : 0)}");
            // End session from the box by keyboard: Tab to it, Enter.
            Dock.Message.GrabFocus();
            var path = new List<string>();
            for (var step = 0; step < 6 && !Dock.EndSession.HasFocus(); step++)
            {
                ChatKey(Key.Tab);
                path.Add(FocusName());
            }
            ChatKey(Key.Enter);
            var ended = Sent[^1] == "{\"type\":\"end\"}" && ChatEnables() == "send=0 route=1 stop=0 new=0 end=0 connect=0";
            // While ending, the banner's End session is off too, and no press sends a second end.
            var sent = Sent.Count;
            Click(ChatChrome.Banner.EndSession);
            Dock.Model.EndSession();
            Dock.Model.NewSession();
            var once = Sent.Count == sent && BannerMirrors() && ChatChrome.Banner.EndSession.Disabled;
            ChatCheck("end-by-keyboard", ended && once, $"path={string.Join(">", path)} {ChatEnables()} once={(once ? 1 : 0)}");
            _chatFake!.Receive("{\"type\":\"ended\",\"run\":\"2026-11-12-pane-1\"}");
        });
        Then(() =>
        {
            var chrome = ChatChrome;
            var released = !_boot.Adopted && !_session.Locked && !_session.Frozen && !chrome.Banner.Visible &&
                !chrome.Toolbar.Library.Disabled && !Node<Controls>("Controls").Locked && !Node<Cords>("Cords").Locked &&
                Node<Cords>("Cords").CordsState.Count == 1 && Dock.Model.LastRunReply is null;
            var row = Dock.Status.Text == "connected" && chrome.ChatTab.Text == "Chat" &&
                EntryText(ChatLastEntry()) == "Session ended: the machine is live and unlocked." &&
                ChatEnables() == "send=0 route=1 stop=0 new=1 end=0 connect=0" && BannerMirrors();
            ChatCheck("row-ended-released", released && row, $"adopted={(_boot.Adopted ? 1 : 0)} locked={(_session.Locked ? 1 : 0)} status={Dock.Status.Text} {ChatEnables()}");
        }, 3);
        Then(() => Shot("7-ended-" + _chatView), 1);
    }

    // The final reply of run 2026-11-12-pane-1 ("wire up tic-tac-toe") and part of one call's output from it.
    private const string ChatRealReply =
        "\n\nTic-Tac-Toe (Book VI, printed pp. 55–56, program `VI-TICTACTOE`) is fully wired and powered on.\n\n" +
        "**What I did:**\n" +
        "- Consulted the manuals: found the Tic-Tac-Toe reference table in `docs/research/programs.md` §1 and its fixture " +
        "`test/conformance/fixtures/C2/VI-TICTACTOE.fixture.json`, and used its corrected wire list (errata applied — including " +
        "keeping the printed `4G/5N`, which is correct as printed and must not be \"fixed\").\n" +
        "- Plugged all 72 cords myself with `connect` in one batch:\n" +
        "  - The 70 jack-to-jack wires of the printed table (relay chains, dial contacts D1–D9, motor block `2L/D18`, `2N/D19`, " +
        "`M-/D17`, wiper `2E/D16`, matrix top/bottom contacts for squares 1–8, `M9b/M11`, `6com/D9`, etc.).\n" +
        "  - The two footnoted free-ended \"play\" wires: cord 70 on `M10` (machine's play wire) and cord 71 on `M11` " +
        "(player's play wire), each left free exactly as printed.\n" +
        "- Switched power on.\n\n" +
        "**Verification:** `state` shows all 72 cords exactly where the table specifies, `power on`, `breaker ok` (no + to – short " +
        "anywhere), and the machine rests cleanly — all relays released, all lamps off, dial at c0. It's ready to play: per the " +
        "printed procedure, the machine's free play wire end would go in `6com`, then hold pushbutton 6 while pressing pushbutton 1 " +
        "for the machine's opening move to the centre (matrix square 9).";

    private const string ChatRealOutput =
        "RIGHT COLUMN\n" +
        "  M+, M-          more + and - taps (printed as plain + and - on the panel)   [Errata]\n" +
        "  M1t..M9t, M1b..M9b  free 2-hole junctions; a cell's t and b are NOT joined  [Book I p.25]\n" +
        "  M10, M11        free 6-hole junctions, not joined to each other             [Errata]\n" +
        "  D16             rotary dial wiper ARM. It touches D0..D15, one at a time: the\n" +
        "                  pad at the dial's position (observable dial c0..c15; gap = between pads). [Book I p.20]";

    // The model's reply renders its markdown; its text stays raw in the model; the wheel over it scrolls the transcript.
    private void ChatMarkdownReply()
    {
        Then(() =>
        {
            ClearFocus();
            _chatFake!.Receive("{\"type\":\"turn\",\"turn\":5,\"status\":200,\"servedBy\":\"host-a\",\"fallbacks\":0,\"costUsd\":0,\"offPrimary\":false," +
                "\"content\":" + PaneProtocol.Quote(ChatRealReply) + ",\"calls\":[{\"name\":\"minivac_control\",\"args\":" +
                PaneProtocol.Quote("{\"args\": \"help terminals\"}") + ",\"output\":" + PaneProtocol.Quote(ChatRealOutput) + "}]}");
        }, 4);
        Then(() =>
        {
            var entry = ChatLastEntry()!;
            var raw = Dock.Model.Entries[^1].Text;
            var text = entry.FindChild("Text", true, false) as RichTextLabel;
            var parsed = text?.GetParsedText() ?? "";
            var label = text is { BbcodeEnabled: true, FitContent: true, ScrollActive: false, MouseFilter: Control.MouseFilterEnum.Pass,
                AutowrapMode: TextServer.AutowrapMode.WordSmart } &&
                text.Text == ChatMarkdown.ToBBCode(raw) && raw.Contains("**What I did:**", StringComparison.Ordinal);
            var rendered = parsed.Contains("What I did:", StringComparison.Ordinal) && parsed.Contains("program VI-TICTACTOE)", StringComparison.Ordinal) &&
                !parsed.Contains("**", StringComparison.Ordinal) && !parsed.Contains('`');
            // The dock's own overrides, not the theme's defaults: an emboldened normal font and the dock's monospace font.
            var fonts = text is not null && text.HasThemeFontOverride("bold_font") && text.HasThemeFontOverride("mono_font") &&
                text.GetThemeFont("bold_font") is FontVariation { VariationEmbolden: > 0 } bold && bold.BaseFont == text.GetThemeFont("normal_font") &&
                text.GetThemeFont("mono_font") is SystemFont mono && mono.FontNames.Contains("Menlo");
            var user = Dock.Entries.GetChildren().OfType<Control>().LastOrDefault(child => child.HasMeta("kind") && child.GetMeta("kind").AsString() == "User");
            var plain = user?.FindChild("Text", true, false) is Label && entry.FindChild("Output_0", true, false) is Label &&
                entry.FindChild("Badge", true, false) is Label;
            ChatCheck("markdown-reply", label && rendered && fonts && plain,
                $"label={(label ? 1 : 0)} rendered={(rendered ? 1 : 0)} fonts={(fonts ? 1 : 0)} plain={(plain ? 1 : 0)} parsed={parsed.Length}");
            Dock.Transcript.ScrollVertical = (int)entry.Position.Y;
        });
        Then(() =>
        {
            Shot("markdown-reply-" + _chatView);
            var entry = ChatLastEntry()!;
            Dock.Transcript.ScrollVertical = (int)(entry.Position.Y + entry.Size.Y) - (int)Dock.Transcript.Size.Y;
        });
        Then(() =>
        {
            Shot("tool-output-" + _chatView);
            var dock = Dock;
            var text = (Control)ChatLastEntry()!.FindChild("Text", true, false)!;
            dock.Transcript.ScrollVertical = (int)(ChatLastEntry()!.Position.Y + text.Position.Y);
        });
        Then(() =>
        {
            // The wheel over the rendered reply itself: the transcript scrolls, the 3D camera does not move.
            var dock = Dock;
            var text = (Control)ChatLastEntry()!.FindChild("Text", true, false)!;
            var area = text.GetGlobalRect().Intersection(dock.Transcript.GetGlobalRect());
            var point = area.GetCenter();
            var view = CameraView();
            var before = dock.Transcript.ScrollVertical;
            RouteGuiAt(text, MouseButtonEvent(true, buttonIndex: MouseButton.WheelDown), point);
            RouteGuiAt(text, MouseButtonEvent(false, buttonIndex: MouseButton.WheelDown), point);
            var down = dock.Transcript.ScrollVertical;
            RouteGuiAt(text, MouseButtonEvent(true, buttonIndex: MouseButton.WheelUp), point);
            RouteGuiAt(text, MouseButtonEvent(false, buttonIndex: MouseButton.WheelUp), point);
            var up = dock.Transcript.ScrollVertical;
            var scrolled = area.Size.Y > 0 && down > before && up < down;
            ChatCheck("wheel-over-reply-scrolls-not-zooms", scrolled && CameraView() == view,
                $"scroll={before}>{down}>{up} area={area.Size.Y:0} camera={(CameraView() == view ? "still" : "moved")}");
            ClearFocus();
            _chatFake!.Receive("{\"type\":\"turn\",\"turn\":6,\"status\":200,\"servedBy\":\"host-a\",\"fallbacks\":0,\"costUsd\":0,\"offPrimary\":false," +
                "\"content\":" + PaneProtocol.Quote(ChatBracketReply) + ",\"calls\":[]}");
        });
        Then(() =>
        {
            // BBCode the model typed shows as typed through the live label; the pairs it renders are balanced, so the
            // text after them is not swallowed into a tag (the label exposes no per-character font to read).
            var text = ChatLastEntry()!.FindChild("Text", true, false) as RichTextLabel;
            var parsed = text?.GetParsedText() ?? "";
            var shown = parsed == "[url=http://x]y[/url] [img]res://icon.svg[/img] a[0] both after" &&
                text!.Text == "[lb]url=http://x]y[lb]/url] [lb]img]res://icon.svg[lb]/img] [code]a[lb]0][/code] [b][i]both[/i][/b] after";
            ChatCheck("markdown-brackets-inert", shown, $"parsed={parsed} bbcode={text?.Text}");
            Dock.Transcript.ScrollVertical = (int)Dock.Transcript.GetVScrollBar().MaxValue;
        });
        Then(() => Shot("markdown-brackets-" + _chatView));
    }

    private const string ChatBracketReply = "[url=http://x]y[/url] [img]res://icon.svg[/img] `a[0]` ***both*** after";

    // The wheel over the dock scrolls the transcript and never zooms; Tom's 3D ruling.
    private void ChatWheel()
    {
        // No wait before the first sample: the frame that lays the entry out is the one measured.
        _chatSteps.Add(new ChatStep(Act: () =>
        {
            _chatWorstFrame = 0;
            _chatFramesAfter = 0;
            _chatFrameUs = Time.GetTicksUsec();
            var words = string.Concat(Enumerable.Repeat("word ", (1 << 20) / 5));
            _chatFake!.Receive("{\"type\":\"turn\",\"turn\":9,\"status\":200,\"servedBy\":\"host-a\",\"fallbacks\":0,\"costUsd\":0," +
                "\"offPrimary\":false,\"content\":" + PaneProtocol.Quote("\u001b[1mbold\u001b[0m " + words) + ",\"calls\":[]}");
        }, Wait: 0, Until: () =>
        {
            var now = Time.GetTicksUsec();
            _chatWorstFrame = Math.Max(_chatWorstFrame, (now - _chatFrameUs) / 1e6);
            _chatFrameUs = now;
            return ++_chatFramesAfter >= 6;
        }, MaxFrames: 12));
        Then(() =>
        {
            var entry = ChatLastEntry();
            var text = EntryText(entry);
            var cut = entry?.FindChild("Cut", true, false) as Label;
            var shown = text.StartsWith("[1mbold[0m word ", StringComparison.Ordinal) && text.EndsWith('…') &&
                text.Length == ChatModel.DisplayCap + 1 && !text.Contains('\u001b') &&
                cut is not null && cut.Text.EndsWith("the run folder's transcript.jsonl has all of it]", StringComparison.Ordinal);
            ChatCheck("big-turn-cut-and-quick", shown && _chatWorstFrame < 0.25,
                $"shown={text.Length} cut={cut?.Text} worst-frame={_chatWorstFrame * 1000:0} ms");
        }, 1);
        Then(() =>
        {
            for (var line = 1; line <= 8; line++) _chatFake!.Receive("{\"type\":\"error\",\"message\":\"filler line " + line + " for the wheel check\"}");
        }, 4);
        Then(() =>
        {
            var dock = Dock;
            var bar = dock.Transcript.GetVScrollBar();
            var view = CameraView();
            var before = dock.Transcript.ScrollVertical;
            void Wheel(Control over, MouseButton button)
            {
                var point = over.GetGlobalRect().GetCenter();
                RouteGuiAt(over, MouseButtonEvent(true, buttonIndex: button), point);
                RouteGuiAt(over, MouseButtonEvent(false, buttonIndex: button), point);
            }
            Wheel(dock.Transcript, MouseButton.WheelUp);
            var scrolled = dock.Transcript.ScrollVertical < before && bar.MaxValue > dock.Transcript.Size.Y;
            var after = dock.Transcript.ScrollVertical;
            Wheel(dock.Transcript, MouseButton.WheelDown);
            scrolled &= dock.Transcript.ScrollVertical > after;
            // One notch at a time: an up and a down in a row would cancel out in the camera's pose.
            var leaks = new List<string>();
            if (CameraView() != view) leaks.Add("transcript");
            foreach (var over in new Control[] { dock.Send, dock.Status, dock.Message, dock.NewSession, dock.Route, ChatChrome.ChatTab })
            {
                foreach (var button in new[] { MouseButton.WheelUp, MouseButton.WheelDown })
                {
                    Wheel(over, button);
                    if (CameraView() == view) continue;
                    leaks.Add(over.Name + ":" + button);
                    view = CameraView();
                }
            }
            ChatCheck("wheel-scrolls-not-zooms", scrolled && leaks.Count == 0,
                $"scroll={before}>{after}>{dock.Transcript.ScrollVertical} max={bar.MaxValue:0} leaks={(leaks.Count == 0 ? "none" : string.Join(",", leaks))}");
            // New session by the mouse: end, then a clear transcript with one note. The banner's End session
            // pressed while it ends sends nothing and does not turn the pending clear into a plain end.
            Click(dock.NewSession);
            _chatSentAtNew = Sent.Count;
            Dock.Model.EndSession();
        });
        Then(() =>
        {
            var sent = Sent[^1] == "{\"type\":\"end\"}" && Sent.Count == _chatSentAtNew;
            _chatFake!.Receive("{\"type\":\"ended\",\"run\":null}");
            ChatCheck("new-session-sends-end", sent, Sent[^1]);
        });
        Then(() =>
        {
            var cleared = ChatKinds().SequenceEqual(["Note"]) && EntryText(ChatLastEntry()) == "New session: the next message starts from nothing.";
            ChatCheck("new-session-clears", cleared, string.Join(",", ChatKinds()));
        });
    }

    // An engine error ends the session: the error entry, the machine still locked, End session on.
    private void ChatEngineError()
    {
        Then(() =>
        {
            Dock.Message.GrabFocus();
            TypeText("try again");
            ChatKey(Key.Enter);
            _chatFake!.Receive("{\"type\":\"started\",\"run\":\"2026-11-12-pane-2\"}");
            _chatFake.Receive(_chatCreate);
            _chatFake.Receive("{\"type\":\"request\",\"id\":2,\"op\":\"run\",\"calls\":null,\"settleMs\":500}");
        });
        Then(() =>
        {
            var reply = Sent[^1].StartsWith("{\"type\":\"reply\",\"id\":2,\"reply\":{\"error\":", StringComparison.Ordinal);
            ChatCheck("engine-error-reply", reply && _boot.Adopted, Sent[^1].Length > 90 ? Sent[^1][..90] : Sent[^1]);
            _chatFake!.Receive("{\"type\":\"done\",\"stop\":\"error\",\"text\":\"the page engine failed: the page could not check this batch\"}");
            _chatFake.Receive("{\"type\":\"ended\",\"run\":\"2026-11-12-pane-2\",\"error\":\"the page engine failed: the page could not check this batch\"}");
        });
        Then(() =>
        {
            var kinds = ChatKinds();
            var row = kinds.TakeLast(2).SequenceEqual(["Problem", "Problem"]) &&
                EntryText(ChatLastEntry()) == "The session ended: the page engine failed: the page could not check this batch. End session unlocks the panel." &&
                _boot.Adopted && _session.Locked && ChatChrome.Banner.Visible && Dock.Status.Text == "connected" &&
                ChatEnables() == "send=0 route=1 stop=0 new=1 end=1 connect=0";
            ChatCheck("row-error", row, $"kinds={string.Join(",", kinds)} status={Dock.Status.Text} {ChatEnables()}");
        }, 3);
        Then(() =>
        {
            Shot("6-error-" + _chatView);
            Click(ChatChrome.Banner.EndSession);
            var sent = Sent[^1] == "{\"type\":\"end\"}";
            _chatFake!.Receive("{\"type\":\"ended\",\"run\":null}");
            ChatCheck("banner-end-session", sent, Sent[^1]);
        }, 1);
        Then(() => ChatCheck("error-then-released", !_boot.Adopted && !_session.Locked && !ChatChrome.Banner.Visible, $"adopted={(_boot.Adopted ? 1 : 0)}"));
    }

    // Connection lost mid-session: the run is marked invalid; End session releases locally; Connect is back.
    private void ChatLost()
    {
        Then(() =>
        {
            Dock.Message.GrabFocus();
            TypeText("once more");
            ChatKey(Key.Enter);
            _chatFake!.Receive("{\"type\":\"started\",\"run\":\"2026-11-12-pane-3\"}");
            _chatFake.Receive(_chatCreate);
            _chatFake.Receive(MarkRun(MarkConnect("2+", "2A")));
            _chatFake.Receive("{\"type\":\"requesting\",\"turn\":1,\"route\":\"model-a\"}");
        });
        Then(() =>
        {
            ChatCheck("lost-precondition", _boot.Adopted && Dock.WaitingLine.Visible, $"adopted={(_boot.Adopted ? 1 : 0)}");
            _chatFake!.CloseFromServer(-1);
        });
        Then(() =>
        {
            var dock = Dock;
            var row = dock.Status.Text.StartsWith("disconnected: the pane server connection closed (no close frame)", StringComparison.Ordinal) &&
                EntryText(ChatLastEntry()) == "The pane server connection closed; run 2026-11-12-pane-3 is marked invalid." &&
                !dock.WaitingLine.Visible && ChatChrome.Banner.WaitingText.Length == 0 && dock.SetupCard.Visible &&
                _boot.Adopted && _session.Locked && ChatEnables() == "send=0 route=0 stop=0 new=1 end=1 connect=1" &&
                !Dock.Model.Busy && BannerMirrors();
            ChatCheck("row-connection-lost", row, $"status={dock.Status.Text} {ChatEnables()} busy={(Dock.Model.Busy ? 1 : 0)}");
            // A fresh engine: every cord on the console is one that run added.
            MarksCheck("lost-keeps-marks", AddedSince([]), 1);
            var sent = Sent.Count;
            Click(dock.EndSession);
            var released = !_boot.Adopted && !_session.Locked && Sent.Count == sent && !Dock.Model.CanEnd && Dock.Model.CanConnect &&
                EntryText(ChatLastEntry()) == "Session ended: the machine is live and unlocked.";
            ChatCheck("lost-end-releases-locally", released, $"adopted={(_boot.Adopted ? 1 : 0)} sent={Sent.Count - sent}");
            NoMarksCheck("lost-end-clears");
        }, 3);
    }

    // The clocks, driven by the suite: End session with no ended drops the link after 15 s and the panel comes back;
    // a link that never says ready falls to could not connect after 10 s.
    private void ChatTimeouts()
    {
        Then(() =>
        {
            Dock.LinkField.GrabFocus();
            TypeText(ChatLink.ToLowerInvariant());
            ChatKey(Key.Enter);
            _chatFake!.Open();
            _chatFake.Receive(ChatReady);
        });
        Then(() =>
        {
            Dock.Message.GrabFocus();
            TypeText("hang");
            ChatKey(Key.Enter);
            _chatFake!.Receive("{\"type\":\"started\",\"run\":\"2026-11-12-pane-t\"}");
            _chatFake.Receive(_chatCreate);
            _chatFake.Receive("{\"type\":\"done\",\"stop\":\"done\",\"text\":\"\"}");
        });
        Then(() =>
        {
            ClearFocus();
            Click(ChatChrome.Banner.EndSession);
            Dock.Model.Tick(14.75);
        });
        Then(() =>
        {
            var waiting = Sent[^1] == "{\"type\":\"end\"}" && Dock.Model.Ending && Dock.Model.Ready && _boot.Adopted && !_chatFake!.ClosedByClient;
            ChatCheck("end-waits-fifteen-seconds", waiting, $"ending={(Dock.Model.Ending ? 1 : 0)} status={Dock.Status.Text}");
            Dock.Model.Tick(0.25);
        });
        Then(() =>
        {
            var kinds = Dock.Model.Entries.TakeLast(2).Select(entry => entry.Text).ToList();
            var dropped = Dock.Status.Text == "disconnected: " + ChatModel.EndTimeoutReason && _chatFake!.ClosedByClient &&
                kinds.SequenceEqual(["The pane server connection closed; run 2026-11-12-pane-t is marked invalid.", "Session ended: the machine is live and unlocked."]) &&
                !_boot.Adopted && !_session.Locked && !ChatChrome.Banner.Visible && !Dock.Model.Busy &&
                ChatEnables() == "send=0 route=0 stop=0 new=1 end=0 connect=1" && BannerMirrors();
            ChatCheck("end-timeout-releases", dropped, $"status={Dock.Status.Text} adopted={(_boot.Adopted ? 1 : 0)} {ChatEnables()}");
            Dock.LinkField.GrabFocus();
            TypeText(ChatLink.ToLowerInvariant());
            ChatKey(Key.Enter);
            Dock.Model.Tick(9.75);
        });
        Then(() =>
        {
            var connecting = Dock.Status.Text == "connecting…";
            Dock.Model.Tick(0.25);
            var row = connecting && Dock.Model.StatusText == "disconnected: " + PaneConnection.NoAnswerReason && Dock.Model.CanConnect;
            ChatCheck("connect-timeout", row, $"connecting={(connecting ? 1 : 0)} status={Dock.Model.StatusText}");
            ClearFocus();
        });
    }

    // ---------------------------------------------------------------- C5: the cord marks
    // docs/plans/godot-chat-pane.md, "Cord marks": after each run reply the cords it added carry a mark in
    // the view under test, until the next run reply, New session or End session. The expected cords come
    // from the console's own cord state before and after each run, not from the parser under test.

    private IReadOnlyList<State.Cord> _marksBefore = [];

    private static string MarkRun(params string[] calls) =>
        "{\"type\":\"request\",\"id\":7,\"op\":\"run\",\"calls\":[" + string.Join(",", calls) + "],\"settleMs\":200}";

    /// <summary>A run, then the session and state reads the real server sends after every successful call.</summary>
    private void ReceiveRun(params string[] calls)
    {
        _chatFake!.Receive(MarkRun(calls));
        _chatFake.Receive("{\"type\":\"request\",\"id\":8,\"op\":\"session\"}");
        _chatFake.Receive("{\"type\":\"request\",\"id\":9,\"op\":\"state\"}");
    }

    private static string MarkConnect(string a, string b) => "{\"name\":\"connect\",\"args\":{\"a\":\"" + a + "\",\"b\":\"" + b + "\"}}";

    private static string[] MarkPairs(params string[] pairs) =>
        pairs.Select(pair => MarkConnect(pair.Split('/')[0], pair.Split('/')[1])).ToArray();

    private const string MarkPower = "{\"name\":\"power\",\"args\":{\"on\":true}}";

    private static string EndKey(CordEnd end) => end switch
    {
        CordEnd.Hole hole => hole.hole,
        CordEnd.Touch touch => "touch:" + touch.term,
        _ => "free",
    };

    private static string CordKey(State.Cord cord) => cord.id + ":" + EndKey(cord.a) + "/" + EndKey(cord.b);

    /// <summary>The cords on the console now that were not there, with the same ends, before the run.</summary>
    private int[] AddedSince(IReadOnlyList<State.Cord> before)
    {
        var old = before.Select(CordKey).ToHashSet(StringComparer.Ordinal);
        return Node<Cords>("Cords").CordsState.Where(cord => !old.Contains(CordKey(cord))).Select(cord => cord.id).Order().ToArray();
    }

    /// <summary>
    /// The cords that carry a drawn mark in the view on screen, from the nodes themselves. Each mark must be
    /// visible, in the one token, and sit on its own cord's midpoint; the other view's marks must not show.
    /// </summary>
    private int[] ShownMarks(out bool sound, out string detail)
    {
        static int Id(Node node) => int.Parse(node.Name.ToString()["CordMark_".Length..], System.Globalization.CultureInfo.InvariantCulture);
        var cords = Node<Cords>("Cords");
        var flat = cords.GetChildren().OfType<Cords.CordMark>().ToList();
        var token = TactileTheme.CordMarkColour.Value;
        var problems = new List<string>();
        int[] ids;
        if (_boot.CurrentStage3D is { } stage)
        {
            if (flat.Any(mark => mark.Visible)) problems.Add("flat-mark-visible-in-3d");
            var marks = stage.CordMeshes.GetChildren().OfType<MeshInstance3D>()
                .Where(node => node.Name.ToString().StartsWith("CordMark_", StringComparison.Ordinal) && !node.IsQueuedForDeletion()).ToList();
            ids = marks.Select(Id).Order().ToArray();
            foreach (var mark in marks)
            {
                var id = Id(mark);
                var material = mark.Mesh?.GetSurfaceCount() == 2 ? mark.Mesh.SurfaceGetMaterial(1) as StandardMaterial3D : null;
                var cord = stage.CordMeshes.GetNodeOrNull<MeshInstance3D>("Cord_" + id);
                if (!mark.IsVisibleInTree() || material is null || material.AlbedoColor != token || !material.NoDepthTest ||
                    material.BillboardMode != BaseMaterial3D.BillboardModeEnum.Enabled || cord is null)
                {
                    problems.Add("mark-" + id);
                    continue;
                }
                var particles = stage.CordMeshes.Lay.Particles(id);
                var middle = (particles[particles.Count / 2 - 1] + particles[particles.Count / 2]) / 2;
                if (mark.Position.DistanceTo(middle) > 1e-5f) problems.Add("off-cord-" + id);
            }
        }
        else
        {
            ids = flat.Select(mark => mark.Cord).Order().ToArray();
            var hole = (float)(PanelTheme.HoleDiameter * cords.Size.X);
            foreach (var mark in flat)
            {
                var id = mark.Cord;
                var line = cords.LineOf(id);
                if (!mark.IsVisibleInTree() || mark.Colour != token || mark.MouseFilter != Control.MouseFilterEnum.Ignore ||
                    line is null || !line.Visible || mark.Radius < hole * 0.9f)
                {
                    problems.Add("mark-" + id);
                    continue;
                }
                var middle = (line.Points[0] + line.Points[^1]) / 2;
                if ((mark.Position + mark.Size / 2).DistanceTo(middle) > 0.5f) problems.Add("off-cord-" + id);
            }
        }
        sound = problems.Count == 0;
        detail = "shown=[" + string.Join(",", ids) + "]" + (sound ? "" : " problems=" + string.Join(",", problems));
        return ids;
    }

    private void MarksCheck(string check, int[] expected, int count)
    {
        var shown = ShownMarks(out var sound, out var detail);
        Check("C5", check + "-" + _chatView, sound && expected.Length == count && shown.SequenceEqual(expected),
            $"view={_boot.CurrentViewMode} expected=[{string.Join(",", expected)}] {detail}");
    }

    /// <summary>No mark node anywhere in the tree, in either view's subtree.</summary>
    private void NoMarksCheck(string check)
    {
        var nodes = Descendants(GetTree().Root).Count(node => node is Cords.CordMark || node.Name.ToString().StartsWith("CordMark_", StringComparison.Ordinal));
        Check("C5", check + "-" + _chatView, nodes == 0 && !_boot.Adopted, $"mark-nodes={nodes} adopted={(_boot.Adopted ? 1 : 0)}");
    }

    private void ChatMarks()
    {
        int[] marked = [];
        Then(() =>
        {
            NoMarksCheck("no-marks-before-session");
            Dock.Message.GrabFocus();
            TypeText("mark the cords");
            ChatKey(Key.Enter);
            _chatFake!.Receive("{\"type\":\"started\",\"run\":\"2026-11-12-pane-m\"}");
            _chatFake.Receive(_chatCreate);
        });
        Then(() =>
        {
            ClearFocus();
            _marksBefore = Node<Cords>("Cords").CordsState;
            ReceiveRun(MarkConnect("1+", "1A"), MarkConnect("2+", "2A"), MarkConnect("3+", "3A"));
        });
        Then(() =>
        {
            MarksCheck("run-marks-three", AddedSince(_marksBefore), 3);
            _marksBefore = Node<Cords>("Cords").CordsState;
            ReceiveRun(MarkConnect("4G", "5K"), MarkPower, MarkConnect("4R", "5T"));
        }, 3);
        Then(() =>
        {
            marked = AddedSince(_marksBefore);
            MarksCheck("run-marks-two-of-five", Node<Cords>("Cords").CordsState.Count == 5 ? marked : [], 2);
            Click(ChatChrome.Toolbar.Fit);
            ClearFocus();
        }, 3);
        Then(() =>
        {
            Shot("c5-fit-two-of-five-" + _chatView);
            Click(ChatChrome.Toolbar.Wire);
            ClearFocus();
        }, 3);
        Then(() =>
        {
            Shot("c5-wire-two-of-five-" + _chatView);
            MarksCheck("wire-view-keeps-marks", marked, 2);
            Click(ChatChrome.Toolbar.Fit);
            ClearFocus();
            _boot.ToggleViewMode();
        }, 3);
        Then(() =>
        {
            MarksCheck("toggle-keeps-marks", marked, 2);
            Shot("c5-fit-two-of-five-toggled-to-" + _boot.CurrentViewMode);
            _boot.ToggleViewMode();
        }, 8);
        Then(() =>
        {
            MarksCheck("toggle-back-keeps-marks", marked, 2);
            _marksBefore = Node<Cords>("Cords").CordsState;
            ReceiveRun("{\"name\":\"wait\",\"args\":{\"ms\":10}}");
        }, 8);
        Then(() =>
        {
            MarksCheck("run-adding-none-clears", AddedSince(_marksBefore), 0);
            _marksBefore = Node<Cords>("Cords").CordsState;
            ReceiveRun(MarkConnect("5+", "5A"));
        }, 3);
        Then(() =>
        {
            MarksCheck("run-marks-only-one", AddedSince(_marksBefore), 1);
            _marksBefore = Node<Cords>("Cords").CordsState;
            _chatFake!.Receive(MarkRun(MarkConnect("6+", "6A"), MarkConnect("ZZ", "1A")));
        }, 3);
        Then(() =>
        {
            var refused = Sent[^1].StartsWith("{\"type\":\"reply\",\"id\":7,\"reply\":{\"ok\":false", StringComparison.Ordinal);
            MarksCheck("refused-batch-clears", refused ? AddedSince(_marksBefore) : [-1], 0);
            _marksBefore = Node<Cords>("Cords").CordsState;
            ReceiveRun(MarkConnect("5-", "5B"), MarkConnect("6+", "6A"));
        }, 3);
        Then(() =>
        {
            MarksCheck("run-marks-before-end", AddedSince(_marksBefore), 2);
            _chatFake!.Receive("{\"type\":\"done\",\"stop\":\"done\",\"text\":\"\"}");
            Click(Dock.EndSession);
            _chatFake.Receive("{\"type\":\"ended\",\"run\":\"2026-11-12-pane-m\"}");
        }, 3);
        Then(() =>
        {
            NoMarksCheck("end-session-clears");
            Dock.Message.GrabFocus();
            TypeText("new wiring");
            ChatKey(Key.Enter);
            _chatFake!.Receive("{\"type\":\"started\",\"run\":\"2026-11-12-pane-n\"}");
            _chatFake.Receive(_chatCreate);
        }, 3);
        Then(() =>
        {
            ClearFocus();
            _marksBefore = Node<Cords>("Cords").CordsState;
            ReceiveRun(MarkConnect("1+", "1A"), MarkConnect("2+", "2A"));
        });
        Then(() =>
        {
            MarksCheck("run-marks-before-new", AddedSince(_marksBefore), 2);
            // Tom, 2026-11-12: a run that adds more than 12 cords marks none.
            _marksBefore = Node<Cords>("Cords").CordsState;
            ReceiveRun(MarkPairs("3C/4C", "3F/4F", "3G/4G", "3H/4H", "3J/4J", "5C/6C", "5F/6F", "5G/6G", "5H/6H", "5J/6J", "3L/4L", "5L/6L", "3X/4X"));
        }, 3);
        Then(() =>
        {
            var added = AddedSince(_marksBefore);
            MarksCheck("run-adding-thirteen-marks-none", added.Length == 13 ? [] : [-1], 0);
            Click(ChatChrome.Toolbar.Fit);
            ClearFocus();
        }, 3);
        Then(() =>
        {
            Shot("c5-thirteen-no-marks-" + _chatView);
            _marksBefore = Node<Cords>("Cords").CordsState;
            ReceiveRun(MarkPairs("3A/4A", "5A/6A"));
        }, 3);
        Then(() =>
        {
            MarksCheck("run-marks-two-after-thirteen", AddedSince(_marksBefore), 2);
            Shot("c5-two-marks-after-thirteen-" + _chatView);
            _chatFake!.Receive("{\"type\":\"done\",\"stop\":\"done\",\"text\":\"\"}");
            Click(Dock.NewSession);
            _chatFake.Receive("{\"type\":\"ended\",\"run\":\"2026-11-12-pane-n\"}");
        }, 3);
        Then(() => NoMarksCheck("new-session-clears"), 3);
    }

    private static void OwnerApply(Machine owner, Command command)
    {
        if (!owner.Apply(command).ok) throw new InvalidOperationException("acceptance: owner command rejected " + command.k);
    }

    private static void OwnerTicks(Machine owner, int ticks)
    {
        for (var index = 0; index < ticks; index++)
        {
            owner.Advance(1);
            owner.DrainEvents();
        }
    }

    private string[] FreeHoles(IReadOnlyList<State.Cord> cords)
    {
        var occupied = new HashSet<string>(StringComparer.Ordinal);
        foreach (var cord in cords)
        {
            if (cord.a is CordEnd.Hole a) occupied.Add(a.hole);
            if (cord.b is CordEnd.Hole b) occupied.Add(b.hole);
        }
        // From the middle of the panel, clear of the chrome in the flat view.
        return _layout.Holes.Skip(_layout.Holes.Count / 3).Select(hole => hole.Id).Where(id => !occupied.Contains(id)).ToArray();
    }

    private static void Click(Control control)
    {
        RouteGui(control, MouseButtonEvent(true));
        RouteGui(control, MouseButtonEvent(false));
    }

    private void ClearFocus()
    {
        GetViewport().GuiGetFocusOwner()?.ReleaseFocus();
        _boot.CurrentStage3D?.PanelViewport.GuiGetFocusOwner()?.ReleaseFocus();
    }

    private void PushKey(Key key)
    {
        ClearFocus();
        GetViewport().PushInput(KeyEvent(key, true));
        GetViewport().PushInput(KeyEvent(key, false));
    }

    // A key reaches a panel control the way a person's does: in flat through the focused control,
    // in 3D through the camera, which forwards it into the panel's viewport.
    private void RoutePanelKey(Control control, InputEventKey key)
    {
        var focus = GetViewport().GuiGetFocusOwner();
        if (focus is not null && !ReferenceEquals(focus, control)) focus.ReleaseFocus();
        if (!control.HasFocus() && control.FocusMode != Control.FocusModeEnum.None) control.GrabFocus();
        GetViewport().PushInput(key);
    }

    private void RoutePanelMotionAt(Vector2 pixel)
    {
        var motion = new InputEventMouseMotion { Position = pixel, GlobalPosition = pixel, ButtonMask = MouseButtonMask.Left };
        if (_boot.CurrentStage3D is not { } stage)
        {
            GetViewport().PushInput(motion, inLocalCoords: true);
            return;
        }
        stage.InputSurface.Forward(motion, PanelWorldPoint(stage, pixel));
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

    // By name and type: a demo entry's "Controls" row label shares the panel controls' name.
    private T Node<T>(string name) where T : Node =>
        GetTree().Root.FindChildren(name, "", true, false).OfType<T>().FirstOrDefault() ??
        throw new InvalidOperationException("acceptance: missing node " + name);

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
        control.GetViewport().PushInput(input, inLocalCoords: true);
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
        control.GetViewport().PushInput(input, inLocalCoords: true);
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
