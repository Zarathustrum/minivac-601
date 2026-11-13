using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Minivac.Godot;

/// <summary>
/// The Chat tab of the right-hand column (docs/plans/godot-chat-pane.md, "Layout" and "The dock's states"):
/// the status line, the setup card, the transcript, the message box, the route select, Send, Stop, New
/// session and End session. It draws <see cref="ChatModel"/> and sends it the user's actions; the rules
/// live there. It polls the link once a frame and always processes, so the link and the waiting clock run
/// whichever tab is selected.
/// </summary>
public partial class ChatDock : Control
{
    public const float ColumnWidth = 360;
    public const string Placeholder = "Ask the model to wire or operate the panel";

    private readonly List<(ChatEntry Entry, int Revision, Control View)> _views = [];
    private readonly List<string> _routes = [];
    private ChatModel _model = null!;
    private Action _selectChat = () => { };
    private Func<string>? _readLink;
    private bool _couldConnect;
    private int _cap;
    private string _filled = "";
    private SystemFont _mono = null!;
    private FontVariation? _bold;
    private int _renderedVersion = -1;
    private string? _waitingShown;
    private bool _liveShown;
    private bool _stopShown;
    private bool _endShown;
    private int _scrollFrames;

    public ChatModel Model => _model;
    public Label Status { get; private set; } = null!;
    public Control SetupCard { get; private set; } = null!;
    public Label SetupText { get; private set; } = null!;
    public LineEdit LinkField { get; private set; } = null!;
    public Button ConnectButton { get; private set; } = null!;
    public Label LinkProblem { get; private set; } = null!;
    public ScrollContainer Transcript { get; private set; } = null!;
    public VBoxContainer Entries { get; private set; } = null!;
    public Label WaitingLine { get; private set; } = null!;
    public TextEdit Message { get; private set; } = null!;
    public OptionButton Route { get; private set; } = null!;
    public Button Send { get; private set; } = null!;
    public Button Stop { get; private set; } = null!;
    public Button NewSession { get; private set; } = null!;
    public Button EndSession { get; private set; } = null!;

    /// <summary>The waiting line, or "" when no request is out: the banner repeats it.</summary>
    public event Action<string>? WaitingTextChanged;
    /// <summary>A pane session is live (from <c>started</c> to <c>ended</c>): the Chat tab shows a marker.</summary>
    public event Action<bool>? LiveChanged;
    /// <summary>Whether Stop and End session are on, each time either changes: the banner mirrors the dock's buttons.</summary>
    public event Action<bool, bool>? SessionButtonsChanged;

    /// <summary>The frame time the model's clocks advance by; acceptance replaces it to drive the clocks itself.</summary>
    internal Func<double, double> FrameSeconds { get; set; } = delta => delta;

    public void Initialize(ChatModel model)
    {
        _model = model ?? throw new ArgumentNullException(nameof(model));
        Name = "ChatDock";
        ProcessMode = ProcessModeEnum.Always;
        MouseFilter = MouseFilterEnum.Stop;
        // Tom's ruling (DECISIONS 2026-11-11): the wheel over any part of the dock never zooms the 3D camera.
        MouseForcePassScrollEvents = false;
        Theme = new Theme { DefaultFontSize = 13 };
        _mono = new SystemFont { FontNames = ["Menlo", "Monaco", "Consolas", "monospace"] };

        var background = new Panel { Name = "Background", MouseFilter = MouseFilterEnum.Ignore };
        background.AddThemeStyleboxOverride("panel", Box(WithAlpha(PanelTheme.ConsoleDark, 0.94f), PanelTheme.ConsoleTeal.Darkened(0.35f), 4));
        AddChild(background);
        background.SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);

        var body = new VBoxContainer { Name = "Body", MouseFilter = MouseFilterEnum.Ignore };
        body.AddThemeConstantOverride("separation", 6);
        AddChild(body);
        body.SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        body.OffsetLeft = 8;
        body.OffsetTop = 6;
        body.OffsetRight = -8;
        body.OffsetBottom = -8;

        Status = new Label
        {
            Name = "Status",
            TextOverrunBehavior = TextServer.OverrunBehavior.TrimEllipsis,
            MouseFilter = MouseFilterEnum.Pass,
        };
        Status.AddThemeColorOverride("font_color", PanelTheme.ConsoleCream.Darkened(0.2f));
        body.AddChild(Status);

        BuildSetupCard(body);

        Transcript = new ScrollContainer
        {
            Name = "Transcript",
            HorizontalScrollMode = ScrollContainer.ScrollMode.Disabled,
            SizeFlagsVertical = SizeFlags.ExpandFill,
            FocusMode = FocusModeEnum.All,
            DrawFocusBorder = true,
            TooltipText = "Transcript: the arrow keys, Page Up, Page Down, Home and End scroll it",
        };
        Transcript.GuiInput += OnTranscriptInput;
        body.AddChild(Transcript);
        Entries = new VBoxContainer { Name = "Entries", SizeFlagsHorizontal = SizeFlags.ExpandFill, MouseFilter = MouseFilterEnum.Pass };
        Entries.AddThemeConstantOverride("separation", 6);
        Transcript.AddChild(Entries);
        WaitingLine = new Label { Name = "Waiting", Visible = false, AutowrapMode = TextServer.AutowrapMode.WordSmart };
        WaitingLine.AddThemeStyleboxOverride("normal", Box(Colors.Transparent, WithAlpha(PanelTheme.ConsoleCream, 0.35f), 6));
        WaitingLine.AddThemeColorOverride("font_color", PanelTheme.ConsoleCream.Darkened(0.25f));
        Entries.AddChild(WaitingLine);

        Message = new TextEdit
        {
            Name = "Message",
            PlaceholderText = Placeholder,
            WrapMode = TextEdit.LineWrappingMode.Boundary,
            CustomMinimumSize = new Vector2(0, 68),
            TooltipText = "Message: Enter sends, Shift+Enter starts a new line, Escape leaves the box",
        };
        Message.GuiInput += OnMessageInput;
        Message.TextChanged += ApplyCap;
        body.AddChild(Message);

        var routeRow = new HBoxContainer { Name = "RouteRow", MouseFilter = MouseFilterEnum.Ignore };
        body.AddChild(routeRow);
        Route = new OptionButton
        {
            Name = "Route",
            SizeFlagsHorizontal = SizeFlags.ExpandFill,
            FocusMode = FocusModeEnum.All,
            TooltipText = "Route: the model the pane server sends the next message to",
            ClipText = true,
        };
        routeRow.AddChild(Route);
        Send = AddButton(routeRow, "Send", "Send", "Send the message to the model (Enter in the message box)", OnSend);
        Stop = AddButton(routeRow, "Stop", "Stop", "Stop the model's request; a call already running finishes", () => Act(_model.Stop));

        var sessionRow = new HBoxContainer { Name = "SessionRow", MouseFilter = MouseFilterEnum.Ignore };
        body.AddChild(sessionRow);
        NewSession = AddButton(sessionRow, "NewSession", "New session", "End the session and clear the transcript", () => Act(_model.NewSession));
        EndSession = AddButton(sessionRow, "EndSession", "End session", "End the chat session and hand the machine back to you", () => Act(_model.EndSession));
        NewSession.SizeFlagsHorizontal = SizeFlags.ExpandFill;
        EndSession.SizeFlagsHorizontal = SizeFlags.ExpandFill;

        Render();
    }

    /// <summary>Set by the chrome: selects the Chat tab and focuses the dock.</summary>
    internal void BindSelect(Action selectChat) => _selectChat = selectChat ?? throw new ArgumentNullException(nameof(selectChat));

    /// <summary>Set by the app: reads the link a running pane server published, or "". Unset, nothing is filled in.</summary>
    internal void BindLinkSource(Func<string> read)
    {
        _readLink = read ?? throw new ArgumentNullException(nameof(read));
        FillLink();
    }

    /// <summary>Puts the server's published link in the link field; Connect is still the user's press.</summary>
    private void FillLink()
    {
        // Text the user typed or pasted is left alone; a link this filled in is replaced, since a restarted
        // server has a new one and a stopped server has none.
        if (_readLink is null || !_model.ShowSetup || !_model.CanConnect || (LinkField.Text.Length != 0 && LinkField.Text != _filled)) return;
        _filled = _readLink();
        if (LinkField.Text != _filled) LinkField.Text = _filled;
    }

    // Coming back from the terminal the server was started in is when a new link appears.
    public override void _Notification(int what)
    {
        if (what == NotificationApplicationFocusIn && LinkField is not null) FillLink();
    }

    /// <summary>Selecting Chat focuses the message box, or the link field while there is no link.</summary>
    public void FocusInput()
    {
        FillLink();
        if (_model.ShowSetup && _model.CanConnect) LinkField.GrabFocus();
        else Message.GrabFocus();
    }

    /// <summary>Connects with a link given at launch (<c>--pane-link</c>), as if it were pasted.</summary>
    public void ConnectLink(string text)
    {
        _model.ConnectText(text);
        Render();
    }

    public override void _Process(double delta)
    {
        _model.Poll();
        _model.Tick(FrameSeconds(delta));
        Render();
        if (_scrollFrames > 0)
        {
            _scrollFrames--;
            Transcript.ScrollVertical = (int)Transcript.GetVScrollBar().MaxValue;
        }
    }

    public override void _UnhandledKeyInput(InputEvent input)
    {
        if (input is not InputEventKey { Pressed: true, Echo: false } key || !key.IsActionPressed("chat_focus", exactMatch: true)) return;
        // Typing "/" in a text field types a slash: those fields take the key before it is unhandled.
        if (GetViewport().GuiGetFocusOwner() is TextEdit or LineEdit) return;
        GetViewport().SetInputAsHandled();
        _selectChat();
    }

    private void BuildSetupCard(VBoxContainer body)
    {
        var card = new PanelContainer { Name = "SetupCard", MouseFilter = MouseFilterEnum.Pass };
        card.AddThemeStyleboxOverride("panel", Box(PanelTheme.ConsoleDark.Lightened(0.06f), PanelTheme.ConsoleTeal, 8));
        SetupCard = card;
        body.AddChild(card);
        var column = new VBoxContainer { Name = "SetupColumn", MouseFilter = MouseFilterEnum.Ignore };
        card.AddChild(column);
        SetupText = new Label
        {
            Name = "SetupText",
            Text = ChatModel.SetupText,
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
            MouseFilter = MouseFilterEnum.Pass,
        };
        column.AddChild(SetupText);
        LinkField = NewLinkField();
        column.AddChild(LinkField);
        var row = new HBoxContainer { Name = "ConnectRow", MouseFilter = MouseFilterEnum.Ignore };
        column.AddChild(row);
        ConnectButton = AddButton(row, "Connect", "Connect", "Connect to the pane server with the link above", OnConnect);
        LinkProblem = new Label
        {
            Name = "LinkProblem",
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
            SizeFlagsHorizontal = SizeFlags.ExpandFill,
            MouseFilter = MouseFilterEnum.Pass,
        };
        LinkProblem.AddThemeColorOverride("font_color", PanelTheme.ConsoleRedLit);
        row.AddChild(LinkProblem);
    }

    private LineEdit NewLinkField()
    {
        var field = new LineEdit
        {
            Name = "LinkField",
            PlaceholderText = "http://127.0.0.1:5173/dev.html#t=…&port=…",
            TooltipText = "The link the pane server printed when it started; a running server's link is filled in for you",
            ContextMenuEnabled = true,
        };
        field.TextSubmitted += _ => OnConnect();
        return field;
    }

    private Button AddButton(Container row, string name, string text, string tooltip, Action pressed)
    {
        var button = new Button { Name = name, Text = text, TooltipText = tooltip, FocusMode = FocusModeEnum.All };
        button.Pressed += pressed;
        row.AddChild(button);
        return button;
    }

    private void OnConnect()
    {
        if (!_model.CanConnect) return;
        var text = LinkField.Text;
        // The link carries the launch token. Clearing a LineEdit keeps the text in its undo history (Undo and
        // the context menu bring it back), so the field that held it is replaced by a fresh one.
        var old = LinkField;
        var focused = old.HasFocus();
        LinkField = NewLinkField();
        old.AddSibling(LinkField);
        old.GetParent().RemoveChild(old);
        old.QueueFree();
        if (focused) LinkField.GrabFocus();
        if (_model.ConnectText(text)) Message.GrabFocus();
        Render();
    }

    private void OnSend()
    {
        var route = Route.Selected >= 0 ? Route.GetItemText(Route.Selected) : "";
        if (_model.Submit(Message.Text, route)) Message.Clear();
        Render();
    }

    internal void Act(Action action)
    {
        action();
        Render();
    }

    private void OnMessageInput(InputEvent input)
    {
        if (input is not InputEventKey { Pressed: true } key || key.CtrlPressed || key.MetaPressed || key.AltPressed) return;
        if (key.Keycode is Key.Enter or Key.KpEnter)
        {
            Message.AcceptEvent();
            if (key.ShiftPressed) Message.InsertTextAtCaret("\n");
            else OnSend();
        }
        else if (key.Keycode == Key.Escape)
        {
            // Escape leaves the box; it never stops the model (Stop is a button).
            Message.AcceptEvent();
            Message.ReleaseFocus();
        }
        else if (key.Keycode == Key.Tab)
        {
            Message.AcceptEvent();
            (key.ShiftPressed ? Message.FindPrevValidFocus() : Message.FindNextValidFocus())?.GrabFocus();
        }
    }

    private void OnTranscriptInput(InputEvent input)
    {
        if (input is not InputEventKey { Pressed: true } key) return;
        var bar = Transcript.GetVScrollBar();
        var page = Math.Max(24, Transcript.Size.Y - 24);
        double? to = key.Keycode switch
        {
            Key.Up => bar.Value - 40,
            Key.Down => bar.Value + 40,
            Key.Pageup => bar.Value - page,
            Key.Pagedown => bar.Value + page,
            Key.Home => 0,
            Key.End => bar.MaxValue,
            _ => null,
        };
        if (to is not { } value) return;
        Transcript.AcceptEvent();
        Transcript.ScrollVertical = (int)Math.Clamp(value, 0, bar.MaxValue);
    }

    // The web box's maxlength, from the server's ready: the text cannot grow past it.
    private void ApplyCap()
    {
        var capped = ChatModel.Cap(Message.Text, _model.Connection.MaxUserChars);
        if (capped.Length == Message.Text.Length) return;
        Message.Text = capped;
        Message.SetCaretLine(Message.GetLineCount() - 1);
        Message.SetCaretColumn(Message.GetLine(Message.GetLineCount() - 1).Length);
    }

    private void Render()
    {
        Status.Text = _model.StatusText;
        Status.TooltipText = _model.StatusText;
        SetupCard.Visible = _model.ShowSetup;
        ConnectButton.Disabled = !_model.CanConnect;
        // A connection that ended (refused, lost, never made) leaves the field empty: offer the server's link again.
        if (_model.CanConnect && !_couldConnect) FillLink();
        _couldConnect = _model.CanConnect;
        // A draft written before ready (no cap yet) is held to the cap ready brings.
        if (_model.Connection.MaxUserChars != _cap)
        {
            _cap = _model.Connection.MaxUserChars;
            ApplyCap();
        }
        LinkField.Editable = _model.CanConnect;
        LinkProblem.Text = _model.LinkProblem;

        var routes = _model.Connection.Routes;
        if (!_routes.SequenceEqual(routes))
        {
            _routes.Clear();
            _routes.AddRange(routes);
            Route.Clear();
            foreach (var route in routes) Route.AddItem(route);
            if (routes.Count > 0) Route.Select(0);
        }

        Send.Disabled = !_model.CanSend(Message.Text);
        Route.Disabled = !_model.CanPickRoute;
        Stop.Disabled = !_model.CanStop;
        NewSession.Disabled = !_model.CanNew;
        EndSession.Disabled = !_model.CanEnd;
        if (_model.CanStop != _stopShown || _model.CanEnd != _endShown)
        {
            _stopShown = _model.CanStop;
            _endShown = _model.CanEnd;
            SessionButtonsChanged?.Invoke(_stopShown, _endShown);
        }

        if (_renderedVersion != _model.Version)
        {
            _renderedVersion = _model.Version;
            SyncEntries();
        }

        var waiting = _model.WaitingText;
        if (waiting != _waitingShown)
        {
            if (waiting is not null && _waitingShown is null) _scrollFrames = 2;
            _waitingShown = waiting;
            WaitingLine.Visible = waiting is not null;
            WaitingLine.Text = waiting ?? "";
            WaitingTextChanged?.Invoke(waiting ?? "");
        }

        var live = _model.Run is not null;
        if (live != _liveShown)
        {
            _liveShown = live;
            LiveChanged?.Invoke(live);
        }
    }

    // Entries only grow, or are cleared by New session; a model entry is redrawn when its turn lands.
    private void SyncEntries()
    {
        var entries = _model.Entries;
        var changed = false;
        var kept = 0;
        while (kept < _views.Count && kept < entries.Count && ReferenceEquals(_views[kept].Entry, entries[kept])) kept++;
        for (var index = _views.Count - 1; index >= kept; index--)
        {
            Drop(_views[index].View);
            _views.RemoveAt(index);
            changed = true;
        }
        for (var index = 0; index < kept; index++)
        {
            var (entry, revision, view) = _views[index];
            if (entry.Revision == revision) continue;
            var fresh = BuildEntry(entry, index);
            Entries.AddChild(fresh);
            Entries.MoveChild(fresh, view.GetIndex());
            Drop(view);
            _views[index] = (entry, entry.Revision, fresh);
            changed = true;
        }
        for (var index = kept; index < entries.Count; index++)
        {
            var view = BuildEntry(entries[index], index);
            Entries.AddChild(view);
            _views.Add((entries[index], entries[index].Revision, view));
            changed = true;
        }
        Entries.MoveChild(WaitingLine, Entries.GetChildCount() - 1);
        if (changed) _scrollFrames = 2;
    }

    private void Drop(Control view)
    {
        Entries.RemoveChild(view);
        view.QueueFree();
    }

    private Control BuildEntry(ChatEntry entry, int index)
    {
        var panel = new PanelContainer { Name = "Entry_" + index, MouseFilter = MouseFilterEnum.Pass };
        panel.SetMeta("kind", entry.Kind.ToString());
        panel.AddThemeStyleboxOverride("panel", entry.Kind switch
        {
            ChatEntryKind.User => Box(PanelTheme.ConsoleTeal.Darkened(0.55f), PanelTheme.ConsoleTeal, 6),
            ChatEntryKind.Note => Box(Colors.Transparent, WithAlpha(PanelTheme.ConsoleCream, 0.35f), 6),
            ChatEntryKind.Problem => Box(PanelTheme.ConsoleRed.Darkened(0.55f), PanelTheme.ConsoleRed, 6),
            _ => Box(PanelTheme.ConsoleDark.Lightened(0.08f), PanelTheme.ConsoleTeal.Darkened(0.35f), 6),
        });
        var column = new VBoxContainer { Name = "Column", MouseFilter = MouseFilterEnum.Pass };
        column.AddThemeConstantOverride("separation", 4);
        panel.AddChild(column);

        if (entry.Kind != ChatEntryKind.Model)
        {
            var text = AddText(column, "Text", entry.Text);
            if (entry.Kind == ChatEntryKind.Note) text.AddThemeColorOverride("font_color", PanelTheme.ConsoleCream.Darkened(0.25f));
            if (entry.Kind == ChatEntryKind.Problem) text.AddThemeColorOverride("font_color", PanelTheme.ConsoleCream);
            return panel;
        }

        if (entry.Badge.Length > 0)
        {
            var badge = new Label
            {
                Name = "Badge",
                Text = entry.Badge,
                AutowrapMode = TextServer.AutowrapMode.WordSmart,
                MouseFilter = MouseFilterEnum.Pass,
                TooltipText = entry.BadgeFallback ? "This reply did not come from the route's first choice" : "Who served this reply",
            };
            var (fill, ink) = entry.BadgeFailed
                ? (PanelTheme.ConsoleRed.Darkened(0.3f), PanelTheme.ConsoleCream)
                : entry.BadgeFallback
                    ? (PanelTheme.ConsoleCream, PanelTheme.ConsoleDark)
                    : (PanelTheme.ConsoleDark.Lightened(0.18f), PanelTheme.ConsoleCream.Darkened(0.15f));
            badge.AddThemeStyleboxOverride("normal", Box(fill, fill.Lightened(0.2f), 3));
            badge.AddThemeColorOverride("font_color", ink);
            badge.SetMeta("fallback", entry.BadgeFallback);
            badge.SetMeta("failed", entry.BadgeFailed);
            column.AddChild(badge);
        }
        if (entry.Reason is not null) AddOutput(column, "Reason", entry.Reason);
        if (entry.Text.Length > 0) AddReply(column, entry.Text);
        for (var at = 0; at < entry.Calls.Count; at++)
        {
            var call = entry.Calls[at];
            var fold = new Button
            {
                Name = "Fold_" + at,
                FocusMode = FocusModeEnum.All,
                Alignment = HorizontalAlignment.Left,
                AutowrapMode = TextServer.AutowrapMode.WordSmart,
                TooltipText = "Show or hide this call's output",
            };
            fold.AddThemeFontOverride("font", _mono);
            column.AddChild(fold);
            var output = AddOutput(column, "Output_" + at, call.Output);
            void Paint()
            {
                fold.Text = (call.Open ? "▾ " : "▸ ") + call.Head;
                output.Visible = call.Open;
            }
            fold.Pressed += () =>
            {
                call.Open = !call.Open;
                Paint();
            };
            Paint();
        }
        if (entry.Cut is not null) AddText(column, "Cut", entry.Cut).AddThemeColorOverride("font_color", PanelTheme.ConsoleCream.Darkened(0.25f));
        return panel;
    }

    private static Label AddText(Container column, string name, string text)
    {
        var label = new Label
        {
            Name = name,
            Text = text,
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
            MouseFilter = MouseFilterEnum.Pass,
        };
        column.AddChild(label);
        return label;
    }

    // The model's reply renders its markdown (ChatMarkdown, which escapes every bracket the model typed). It never
    // scrolls on its own and passes the wheel up, so the transcript scrolls and, in 3D, the camera does not move.
    private void AddReply(Container column, string text)
    {
        var reply = new RichTextLabel
        {
            Name = "Text",
            BbcodeEnabled = true,
            FitContent = true,
            ScrollActive = false,
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
            MouseFilter = MouseFilterEnum.Pass,
        };
        _bold ??= new FontVariation { BaseFont = GetThemeDefaultFont(), VariationEmbolden = 0.8f };
        reply.AddThemeFontOverride("bold_font", _bold);
        reply.AddThemeFontOverride("mono_font", _mono);
        column.AddChild(reply);
        // Sized near the column before it gets its text: laid out at width 0, a 4 KiB reply put every word on its own
        // line: the chat suite's big-turn check measured a 450 ms frame, against 80 ms this way.
        reply.Size = new Vector2(Entries.Size.X, 0);
        reply.Text = ChatMarkdown.ToBBCode(text);
    }

    private Label AddOutput(Container column, string name, string text)
    {
        var label = AddText(column, name, text);
        // Lines break between words, inside one only when that word alone is wider than the block.
        label.AutowrapMode = TextServer.AutowrapMode.WordSmart;
        label.AddThemeFontOverride("font", _mono);
        label.AddThemeFontSizeOverride("font_size", 12);
        label.AddThemeStyleboxOverride("normal", Box(PanelTheme.ConsoleDark.Darkened(0.45f), PanelTheme.ConsoleDark.Darkened(0.45f), 5));
        return label;
    }

    private static StyleBoxFlat Box(Color fill, Color border, int padding)
    {
        var box = new StyleBoxFlat { BgColor = fill, BorderColor = border };
        box.SetBorderWidthAll(1);
        box.SetCornerRadiusAll(3);
        box.SetContentMarginAll(padding);
        return box;
    }

    private static Color WithAlpha(Color colour, float alpha) => new(colour.R, colour.G, colour.B, alpha);
}
