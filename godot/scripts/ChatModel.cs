using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using Minivac.Core;
using Minivac.Hands;

namespace Minivac.Godot;

public enum ChatEntryKind { User, Model, Note, Problem }

/// <summary>One tool call in a model entry: the command line, its output, and whether the output shows.</summary>
public sealed class ChatCall(string head, string output, bool open)
{
    public string Head { get; } = head;
    public string Output { get; } = output;
    public bool Open { get; set; } = open;
}

/// <summary>
/// One transcript entry. A model entry is made by <c>served</c> and filled by its <c>turn</c>; every change
/// bumps <see cref="Revision"/> so the dock redraws only what changed.
/// </summary>
public sealed class ChatEntry(ChatEntryKind kind, string text = "")
{
    public ChatEntryKind Kind { get; } = kind;
    public string Text { get; internal set; } = text;
    public int Turn { get; internal set; }
    public string Badge { get; internal set; } = "";
    public bool BadgeFallback { get; internal set; }
    public bool BadgeFailed { get; internal set; }
    public string? Reason { get; internal set; }
    public List<ChatCall> Calls { get; } = [];
    /// <summary>The entry's last line when it shows less than it was sent (<see cref="ChatModel.DisplayCap"/>); null otherwise.</summary>
    public string? Cut { get; internal set; }
    public int Revision { get; internal set; }
}

/// <summary>
/// The chat dock's state and rules, with no Godot types: the C# of the web pane's <c>mountPane</c>
/// (src/pane/ui.ts), message for message, over <see cref="PaneConnection"/>. It answers the server's
/// requests from a <see cref="PaneEngine"/> on the caller's thread (the plan's instant calls), adopts the
/// engine's machine after each <c>create</c> and <c>run</c>, and releases it when the session is handed
/// back. The dock draws what this holds and sends the user's actions here.
/// </summary>
public sealed class ChatModel
{
    public const string SetupText =
        "Chat lets a model of your own wire and operate this console. It needs a model of your own: you start the " +
        "pane server (tools/hands-pane/server.ts) with your model endpoint's settings, and the server, not this " +
        "app, holds the key. The guide is tools/hands-pane/README.md. Paste the link the server prints, then " +
        "press Connect.";
    public const string ReadyNote =
        "Connected. When you send a message the model takes over the panel: you can look and move the camera, " +
        "not touch, until End session. Try: \"Wire pushbutton 1 so it lights lamp 1, then press it.\"";
    /// <summary>
    /// The most UTF-16 units one displayed field shows, each in its own label. An autowrapped label costs more
    /// than linearly in its length: 64 KiB froze the app for 5.6 s (the C2-C5 review). Measured windowed on this
    /// Mac, 2026-11-12: a frame that adds one 4 KiB label takes about 25 ms more than one of a few characters.
    /// </summary>
    public const int DisplayCap = 4 * 1024;
    /// <summary>
    /// The most UTF-16 units a model entry shows across all its fields, spent in the order the dock draws them.
    /// Measured as above: a frame that adds a full entry (four 4 KiB fields) takes about 115 ms.
    /// </summary>
    public const int EntryCap = 16 * 1024;
    /// <summary>The most calls one model entry shows: each is a fold button and a label (5,000 cost 1.1 s).</summary>
    public const int MaxCallsShown = 50;
    /// <summary>A run that adds more cords than this marks none: rings on every cord pick nothing out (Tom, 2026-11-12).</summary>
    public const int MaxMarkedCords = 12;
    /// <summary>After End session or New session, how long the server has to send <c>ended</c>.</summary>
    public const double EndSeconds = 15;
    public const string EndTimeoutReason =
        "the pane server did not answer End session within 15 s, so this app closed the connection; press Connect to connect again";

    private enum EndKind { None, End, New }

    private readonly Func<PaneEngine> _newEngine;
    private readonly Action<Machine> _adopt;
    private readonly Action _release;
    private readonly List<ChatEntry> _entries = [];
    private PaneEngine _engine;
    private EndKind _ending;
    /// <summary>The reply whose badge is up and whose calls are running: its <c>turn</c> fills the same entry.</summary>
    private ChatEntry? _replying;
    private string? _waitingRoute;
    private int _waitingTurn;
    private double _waitingSeconds;
    private double _endingSeconds;
    private bool _live;

    public ChatModel(PaneConnection connection, Func<PaneEngine> newEngine, Action<Machine> adopt, Action release)
    {
        Connection = connection ?? throw new ArgumentNullException(nameof(connection));
        _newEngine = newEngine ?? throw new ArgumentNullException(nameof(newEngine));
        _adopt = adopt ?? throw new ArgumentNullException(nameof(adopt));
        _release = release ?? throw new ArgumentNullException(nameof(release));
        _engine = newEngine();
    }

    public PaneConnection Connection { get; }
    public IReadOnlyList<ChatEntry> Entries => _entries;
    /// <summary>Bumped on every change the dock draws, except the waiting line's clock.</summary>
    public int Version { get; private set; }
    public bool Ready => Connection.IsReady;
    /// <summary>A user message is out and its <c>done</c> has not come back.</summary>
    public bool Busy { get; private set; }
    /// <summary>The server's pane session for this link, from <c>started</c> to <c>ended</c>.</summary>
    public string? Run { get; private set; }
    /// <summary>The console shows the engine's machine, frozen and locked.</summary>
    public bool Adopted { get; private set; }
    public bool Ending => _ending != EndKind.None;
    /// <summary>The last <c>run</c> reply's JSON, as sent (C5 marks the cords it added).</summary>
    public string? LastRunReply { get; private set; }
    /// <summary>
    /// The cords the last <c>run</c> reply added (<see cref="AddedCords"/>), none when it added more than
    /// <see cref="MaxMarkedCords"/>; empty after a session hands back.
    /// </summary>
    public IReadOnlySet<int> MarkedCords { get; private set; } = NoCords;
    /// <summary>Why the last pasted link was not read; empty otherwise.</summary>
    public string LinkProblem { get; private set; } = "";

    /// <summary>The live engine's machine, or null with no live pane session.</summary>
    public Machine? EngineMachine => _engine.Machine();

    public string StatusText => Run is not null ? "session " + Run : Connection.StatusText;
    public bool ShowSetup => !Connection.IsReady;

    /// <summary>The web pane's <c>update</c>, plus Connect.</summary>
    public bool CanSend(string boxText) => Ready && !Busy && !Ending && boxText.Trim().Length > 0;
    public bool CanPickRoute => Ready && !Busy;
    public bool CanStop => Ready && Busy;
    public bool CanNew => !Ending;
    public bool CanEnd => !Ending && (Run is not null || Adopted);
    public bool CanConnect => Connection.CanConnect;

    /// <summary><c>waiting for &lt;route&gt; · request &lt;n&gt; · &lt;s&gt; s</c> while a request to the model is out; null otherwise.</summary>
    public string? WaitingText => _waitingRoute is null ? null : WaitingLine(_waitingRoute, _waitingTurn, _waitingSeconds);

    private static readonly IReadOnlySet<int> NoCords = new HashSet<int>();

    /// <summary>
    /// The cord marks (docs/plans/godot-chat-pane.md, "Cord marks"): every cord id an accepted
    /// <c>run</c> reply names in a result's <c>cord</c> or <c>cords</c> (connect and loadProgram, as
    /// tools/hands/render.ts <c>describeOk</c> reads them) that is still in the reply's own <c>view</c>.
    /// A cord added and unplugged in the same batch is gone and gets none; an id the batch freed and
    /// reused (lowest unused id) names the new cord. A refused batch, <c>"missing"</c>, an error, or
    /// text that is not such a reply marks nothing.
    /// </summary>
    public static IReadOnlySet<int> AddedCords(string? runReply)
    {
        var added = new HashSet<int>();
        if (runReply is null) return added;
        try
        {
            using var document = JsonDocument.Parse(runReply);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("ok", out var ok) || ok.ValueKind != JsonValueKind.True ||
                !root.TryGetProperty("results", out var results) || results.ValueKind != JsonValueKind.Array ||
                !root.TryGetProperty("view", out var view) || view.ValueKind != JsonValueKind.Object ||
                !view.TryGetProperty("cords", out var live) || live.ValueKind != JsonValueKind.Array)
                return NoCords;
            foreach (var result in results.EnumerateArray())
            {
                if (result.ValueKind != JsonValueKind.Object ||
                    !result.TryGetProperty("ok", out var resultOk) || resultOk.ValueKind != JsonValueKind.True) continue;
                if (result.TryGetProperty("cord", out var cord)) AddId(added, cord);
                if (result.TryGetProperty("cords", out var cords) && cords.ValueKind == JsonValueKind.Array)
                    foreach (var each in cords.EnumerateArray()) AddId(added, each);
            }
            var present = new HashSet<int>();
            foreach (var each in live.EnumerateArray()) AddId(present, each);
            added.IntersectWith(present);
            return added;
        }
        catch (JsonException)
        {
            return NoCords;
        }
        catch (InvalidOperationException)
        {
            // Not valid UTF-16 (a refused word can echo a lone surrogate): no marks.
            return NoCords;
        }
    }

    private static void AddId(HashSet<int> into, JsonElement cord)
    {
        if (cord.ValueKind == JsonValueKind.Object && cord.TryGetProperty("id", out var id) &&
            id.ValueKind == JsonValueKind.Number && id.TryGetInt32(out var value)) into.Add(value);
    }

    public static string WaitingLine(string route, int turn, double seconds) =>
        "waiting for " + route + " · request " + turn.ToString(CultureInfo.InvariantCulture) + " · " +
        ((long)Math.Floor(seconds)).ToString(CultureInfo.InvariantCulture) + " s";

    /// <summary>The message box's text cut to <paramref name="max"/> UTF-16 units (the server's count), never inside a pair; no cap below 1.</summary>
    public static string Cap(string text, int max)
    {
        if (max < 1 || text.Length <= max) return text;
        var cut = char.IsHighSurrogate(text[max - 1]) ? max - 1 : max;
        return text[..cut];
    }

    /// <summary>How a call reads in the transcript: the command line the model typed (ui.ts <c>callLabel</c>).</summary>
    public static string CallLabel(string name, string args)
    {
        if (name == "minivac_control")
        {
            try
            {
                using var document = JsonDocument.Parse(args);
                if (document.RootElement.ValueKind == JsonValueKind.Object &&
                    document.RootElement.TryGetProperty("args", out var words) && words.ValueKind == JsonValueKind.String)
                    return "minivac-control " + PaneProtocol.Text(words);
            }
            catch (JsonException)
            {
                // Shown raw below.
            }
        }
        return name + " " + args;
    }

    /// <summary>
    /// Text as a one-field entry shows it (<see cref="Clean"/>), cut at <see cref="DisplayCap"/>, never inside a
    /// pair, with a last line that says how much is shown.
    /// </summary>
    public static string Display(string text)
    {
        var clean = Clean(text);
        if (clean.Length <= DisplayCap) return clean;
        var shown = Cap(clean, DisplayCap);
        return shown + "\n" + CutNote(shown.Length, clean.Length, 0, 0, recorded: false);
    }

    /// <summary>
    /// Text for display only, never for what is sent: C0 controls other than newline and tab, and DEL, are dropped
    /// (a model's ANSI escapes would show as raw glyphs).
    /// </summary>
    public static string Clean(string text)
    {
        foreach (var c in text)
        {
            if (c is not ('\n' or '\t') && (c < ' ' || c == '\u007f'))
                return string.Concat(text.Where(each => each is '\n' or '\t' || each >= ' ' && each != '\u007f'));
        }
        return text;
    }

    /// <summary>
    /// The last line of a cut entry. Only a model turn's content and calls are written whole to the run folder's
    /// transcript.jsonl (tools/hands-api/openai-loop.ts, <c>transcriptLine</c>; a failed turn records only the
    /// gateway's body), so only that entry names it.
    /// </summary>
    private static string CutNote(int shown, int total, int callsShown, int calls, bool recorded) =>
        "[showing " + shown.ToString("N0", CultureInfo.InvariantCulture) + " of " + total.ToString("N0", CultureInfo.InvariantCulture) +
        " characters" + (callsShown < calls
            ? " and " + callsShown.ToString("N0", CultureInfo.InvariantCulture) + " of " + calls.ToString("N0", CultureInfo.InvariantCulture) + " calls"
            : "") + (recorded ? "; the run folder's transcript.jsonl has all of it]" : "]");

    /// <summary>The badge's text; empty when the endpoint said nothing about who served the reply (ui.ts <c>servedText</c>).</summary>
    public static string ServedText(string servedBy, bool offPrimary, int fallbacks, double costUsd, string? stop)
    {
        var parts = new List<string>();
        if (servedBy != "?") parts.Add("served by " + servedBy);
        if (offPrimary) parts.Add("FALLBACK: not the route's primary");
        if (fallbacks > 0) parts.Add(fallbacks.ToString(CultureInfo.InvariantCulture) + (fallbacks == 1 ? " fallback" : " fallbacks") + " tried");
        if (costUsd > 0) parts.Add("$" + costUsd.ToString("F4", CultureInfo.InvariantCulture));
        if (stop is not null) parts.Add("request failed: " + stop);
        return string.Join(" · ", parts);
    }

    /// <summary>Reads a pasted link and connects; the caller clears its field whatever the outcome.</summary>
    public bool ConnectText(string text)
    {
        if (!Connection.CanConnect) return false;
        var link = PaneLink.Read(text, out var problem);
        LinkProblem = problem;
        Version++;
        if (link is null) return false;
        Connection.Connect(link);
        _live = true;
        return true;
    }

    /// <summary>Once a frame: every frame from the server, then the link's end if it ended.</summary>
    public void Poll()
    {
        foreach (var message in Connection.Poll()) OnServer(message);
        CheckClosed();
    }

    /// <summary>
    /// Advances the clocks by the caller's frame time (no wall clock here): the waiting line, the link's
    /// connect-to-ready limit, and the End session limit. No <c>ended</c> within <see cref="EndSeconds"/> of End
    /// session or New session closes the link from this side, and the lost-connection path hands the machine back.
    /// </summary>
    public void Tick(double seconds)
    {
        if (seconds <= 0) return;
        if (_waitingRoute is not null) _waitingSeconds += seconds;
        Connection.Tick(seconds);
        if (Ending && Ready)
        {
            _endingSeconds += seconds;
            if (_endingSeconds >= EndSeconds) Connection.Lose(EndTimeoutReason);
        }
        CheckClosed();
    }

    /// <summary>Send: false when the rules do not allow it, and then the box keeps its text.</summary>
    public bool Submit(string boxText, string route)
    {
        var text = boxText.Trim();
        if (!Ready || Busy || Ending || text.Length == 0) return false;
        Busy = true;
        Say(ChatEntryKind.User, text);
        Connection.Send(new PageMessage.User(text, route));
        CheckClosed();
        return true;
    }

    /// <summary>Stop, End session and New session keep the dock's enable rules whichever button sent them.</summary>
    public void Stop()
    {
        if (!CanStop) return;
        Connection.Send(new PageMessage.Stop());
        CheckClosed();
    }

    public void EndSession() => End(EndKind.End);

    public void NewSession() => End(EndKind.New);

    private void End(EndKind kind)
    {
        if (kind == EndKind.New ? !CanNew : !CanEnd) return;
        if (!Ready)
        {
            HandBack(kind);
            return;
        }
        _ending = kind;
        _endingSeconds = 0;
        Version++;
        Connection.Send(new PageMessage.End());
        CheckClosed();
    }

    private void OnServer(ServerMessage frame)
    {
        switch (frame)
        {
            case ServerMessage.Ready:
                Say(ChatEntryKind.Note, ReadyNote);
                break;
            case ServerMessage.Started started:
                _engine = _newEngine();
                Run = started.Run;
                LastRunReply = null;
                MarkedCords = NoCords;
                Say(ChatEntryKind.Note, "Session " + started.Run + " started; the model must create pane.json.");
                break;
            case ServerMessage.Request request:
                Answer(request);
                break;
            case ServerMessage.Requesting requesting:
                _waitingRoute = Display(requesting.Route);
                _waitingTurn = requesting.Turn;
                _waitingSeconds = 0;
                Version++;
                break;
            case ServerMessage.ServedEvent served:
                StopWaiting();
                ShowServed(served.Turn, served.ServedBy, served.OffPrimary, served.Fallbacks, served.CostUsd, null);
                break;
            case ServerMessage.TurnEvent turn:
                StopWaiting();
                ShowTurn(turn);
                break;
            case ServerMessage.Done done:
                StopWaiting();
                Busy = false;
                _replying = null;
                if (done.Stop is "refused" or "error") Say(ChatEntryKind.Problem, done.Text);
                else if (done.Stop != "done") Say(ChatEntryKind.Note, "The turn stopped: " + done.Stop + ".");
                Version++;
                break;
            case ServerMessage.Ended ended:
            {
                Run = null;
                var kind = _ending;
                _ending = EndKind.None;
                // New session wipes the transcript: an error that ended the session goes in after it.
                if (kind == EndKind.New) HandBack(kind);
                if (ended.Failure is not null)
                {
                    // The failure alone is cut, so the instruction after it always shows.
                    Add(new ChatEntry(ChatEntryKind.Problem, "The session ended: " + Display(ended.Failure) +
                        (kind == EndKind.None && Adopted ? ". End session unlocks the panel." : ".")));
                }
                if (kind == EndKind.End) HandBack(kind);
                Version++;
                break;
            }
            case ServerMessage.ServerError error:
                Say(ChatEntryKind.Problem, error.Message);
                break;
            // A frame this build cannot read is dropped, as the page drops one it cannot parse.
        }
    }

    private void Answer(ServerMessage.Request request)
    {
        string? reply;
        try
        {
            reply = PaneJson.Answer(_engine, request.FrameJson);
        }
        catch (Exception problem)
        {
            reply = "{\"error\":" + PaneProtocol.Quote("the page engine threw: " + problem.Message) + "}";
        }
        // An unknown op has no reply; nothing is sent for it.
        if (reply is not null) Connection.Send(new PageMessage.Reply(request.Id, reply));
        // Only a run changes the cords: state and session reads leave the marks as they are.
        if (request.Op == "run")
        {
            LastRunReply = reply;
            var added = AddedCords(reply);
            MarkedCords = added.Count > MaxMarkedCords ? NoCords : added;
        }
        if (request.Op is "create" or "run") ShowMachine();
        Version++;
    }

    private void ShowMachine()
    {
        var machine = _engine.Machine();
        if (machine is null) return;
        try
        {
            _adopt(machine);
            Adopted = true;
        }
        catch (Exception problem)
        {
            Say(ChatEntryKind.Problem, "The console could not show the machine: " + problem.Message);
        }
    }

    /// <summary>Hand the machine back live and unlocked; New session also clears the transcript.</summary>
    private void HandBack(EndKind kind)
    {
        if (Adopted)
        {
            try
            {
                _release();
            }
            catch (Exception problem)
            {
                // Adopted stays set, so End session stays on and tries the hand-back again.
                Say(ChatEntryKind.Problem, "The console could not hand the machine back: " + problem.Message);
                return;
            }
        }
        Adopted = false;
        // The handed-back machine is the user's now: no later request may reach it through the engine.
        _engine = _newEngine();
        LastRunReply = null;
        MarkedCords = NoCords;
        if (kind == EndKind.New)
        {
            StopWaiting();
            _entries.Clear();
            _replying = null;
        }
        Say(ChatEntryKind.Note, kind == EndKind.New
            ? "New session: the next message starts from nothing."
            : "Session ended: the machine is live and unlocked.");
    }

    private ChatEntry ShowServed(int turn, string servedBy, bool offPrimary, int fallbacks, double costUsd, string? stop)
    {
        var item = new ChatEntry(ChatEntryKind.Model) { Turn = turn };
        PaintBadge(item, servedBy, offPrimary, fallbacks, costUsd, stop);
        Add(item);
        _replying = item;
        return item;
    }

    private void ShowTurn(ServerMessage.TurnEvent turn)
    {
        var item = _replying is not null && _replying.Turn == turn.Turn
            ? _replying
            : ShowServed(turn.Turn, turn.ServedBy, turn.OffPrimary, turn.Fallbacks, turn.CostUsd, turn.Stop);
        _replying = null;
        PaintBadge(item, turn.ServedBy, turn.OffPrimary, turn.Fallbacks, turn.CostUsd, turn.Stop);
        // Each field is cut at DisplayCap, and the entry at EntryCap in the order the dock draws it; a cut field
        // ends in an ellipsis.
        var budget = EntryCap;
        var shown = 0;
        var total = 0;
        string Fit(string text)
        {
            var clean = Clean(text);
            total += clean.Length;
            var room = Math.Min(DisplayCap, budget);
            if (clean.Length <= room)
            {
                budget -= clean.Length;
                shown += clean.Length;
                return clean;
            }
            var part = room > 0 ? Cap(clean, room) : "";
            budget -= room;
            shown += part.Length;
            return part + "…";
        }
        item.Reason = turn.Reason is null ? null : Fit(turn.Reason);
        item.Text = turn.Content is not null && turn.Content.Trim().Length > 0 ? Fit(turn.Content) : "";
        foreach (var call in turn.Calls)
        {
            var head = CallLabel(call.Name, call.Args);
            if (item.Calls.Count == MaxCallsShown || budget == 0)
                total += Clean(head).Length + Clean(call.Output).Length;
            else
                item.Calls.Add(new ChatCall(Fit(head), Fit(call.Output), call.Name == "minivac_control"));
        }
        item.Cut = shown < total || item.Calls.Count < turn.Calls.Count
            ? CutNote(shown, total, item.Calls.Count, turn.Calls.Count, recorded: turn.Stop is null)
            : null;
        item.Revision++;
        Version++;
    }

    private static void PaintBadge(ChatEntry item, string servedBy, bool offPrimary, int fallbacks, double costUsd, string? stop)
    {
        item.Badge = Display(ServedText(servedBy, offPrimary, fallbacks, costUsd, stop));
        item.BadgeFallback = offPrimary || fallbacks > 0;
        item.BadgeFailed = stop is not null;
        item.Revision++;
    }

    private void StopWaiting()
    {
        if (_waitingRoute is null) return;
        _waitingRoute = null;
        _waitingSeconds = 0;
        Version++;
    }

    /// <summary>The web page's socket <c>close</c>: the link ended while connecting or connected.</summary>
    private void CheckClosed()
    {
        var live = Connection.State is PaneLinkState.Connecting or PaneLinkState.Ready;
        if (live || !_live)
        {
            _live = live;
            return;
        }
        _live = false;
        Busy = false;
        StopWaiting();
        var run = Run;
        Run = null;
        var kind = _ending;
        _ending = EndKind.None;
        // As on `ended`: New session wipes the transcript, so the invalid-run entry goes in after it.
        if (kind == EndKind.New) HandBack(kind);
        if (run is not null) Say(ChatEntryKind.Problem, "The pane server connection closed; run " + run + " is marked invalid.");
        if (kind == EndKind.End) HandBack(kind);
        Version++;
    }

    /// <summary>A plain entry, shown through <see cref="Display"/>.</summary>
    private void Say(ChatEntryKind kind, string text) => Add(new ChatEntry(kind, Display(text)));

    private void Add(ChatEntry entry)
    {
        _entries.Add(entry);
        Version++;
    }
}
