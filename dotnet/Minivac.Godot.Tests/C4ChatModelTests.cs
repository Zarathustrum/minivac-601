using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Minivac.Core;
using Minivac.Hands;
using Xunit;

namespace Minivac.Godot.Tests;

// C4: the dock's rules (docs/plans/godot-chat-pane.md, "The dock's states"), the C# of src/pane/ui.ts,
// over the scripted transport with a real engine.
public sealed class C4ChatModelTests
{
    private const string ReadyFrame = "{\"type\":\"ready\",\"routes\":[\"model-a\",\"model-b\"],\"maxUserChars\":8000}";
    private const string LinkText = "http://127.0.0.1:5173/dev.html#t=tok-1&port=9123";
    private static readonly LoadedNetlist Net = Netlist.LoadNetlist(File.ReadAllBytes(Path.Combine(Root(), "data", "netlist.json")));
    private static readonly Profile RefA = LoadProfile("MV601-REF-A");
    private static readonly Profile Ideal = LoadProfile("MV601-IDEAL");

    private readonly FakePaneTransport _fake = new();
    private readonly List<Machine> _adopted = [];
    private readonly ChatModel _chat;
    private int _releases;
    private Exception? _releaseFailure;
    private int _engines;

    public C4ChatModelTests() =>
        _chat = new ChatModel(new PaneConnection(_fake), () =>
        {
            _engines++;
            return new PaneEngine(Net, [RefA, Ideal]);
        }, _adopted.Add, () =>
        {
            _releases++;
            if (_releaseFailure is { } failure)
            {
                _releaseFailure = null;
                throw failure;
            }
        });

    // The fresh session the server sends with `create`; another profile id makes the engine refuse it.
    private static string CreateFrame(long id, string? profile = null)
    {
        var session = HandsJson.Session(Table.newSession(Net, RefA));
        if (profile is not null) session = session.Replace("\"MV601-REF-A\"", "\"" + profile + "\"", StringComparison.Ordinal);
        return "{\"type\":\"request\",\"id\":" + id + ",\"op\":\"create\",\"session\":" + session + "}";
    }

    private const string RunFrame =
        "{\"type\":\"request\",\"id\":2,\"op\":\"run\",\"calls\":[{\"name\":\"connect\",\"args\":{\"a\":\"1+\",\"b\":\"1A\"}}," +
        "{\"name\":\"power\",\"args\":{\"on\":true}}],\"settleMs\":500}";

    private void Ready()
    {
        Assert.True(_chat.ConnectText(LinkText));
        _fake.Open();
        _fake.Receive(ReadyFrame);
        _chat.Poll();
        Assert.True(_chat.Ready);
        _fake.Sent.Clear();
    }

    private void Server(string frame)
    {
        _fake.Receive(frame);
        _chat.Poll();
    }

    private void Started()
    {
        Ready();
        Assert.True(_chat.Submit("  light lamp 1  ", "model-b"));
        Server("{\"type\":\"started\",\"run\":\"2026-11-12-pane-1\"}");
        Server(CreateFrame(1));
        _fake.Sent.Clear();
    }

    private (bool Send, bool Route, bool Stop, bool New, bool End, bool Connect) Enables(string box = "x") =>
        (_chat.CanSend(box), _chat.CanPickRoute, _chat.CanStop, _chat.CanNew, _chat.CanEnd, _chat.CanConnect);

    [Fact]
    public void No_link_shows_the_setup_and_only_connect_and_new_session_are_on()
    {
        Assert.Equal("not connected", _chat.StatusText);
        Assert.True(_chat.ShowSetup);
        Assert.Empty(_chat.Entries);
        Assert.Equal((false, false, false, true, false, true), Enables());
        Assert.Equal(1, _engines);
    }

    [Fact]
    public void A_bad_link_is_not_read_and_says_why()
    {
        Assert.False(_chat.ConnectText("nope"));
        Assert.Contains("not a link", _chat.LinkProblem, StringComparison.Ordinal);
        Assert.Equal(0, _fake.Connects);
        Assert.True(_chat.ConnectText(LinkText));
        Assert.Equal("", _chat.LinkProblem);
        Assert.Equal(new PaneLink("tok-1", 9123, "http://127.0.0.1:5173"), _fake.Link);
    }

    [Fact]
    public void Connecting_turns_everything_off_but_new_session()
    {
        _chat.ConnectText(LinkText);
        Assert.Equal("connecting…", _chat.StatusText);
        Assert.True(_chat.ShowSetup);
        Assert.Equal((false, false, false, true, false, false), Enables());
        Assert.False(_chat.ConnectText(LinkText));
        Assert.Equal(1, _fake.Connects);
    }

    [Theory]
    [InlineData(4001, "disconnected: the server refused the token: paste the link the pane server printed last")]
    [InlineData(4002, "disconnected: this build and the pane server are different versions: rebuild this app or restart the pane server")]
    public void A_refusal_shows_its_reason_and_connect_comes_back(int code, string status)
    {
        _chat.ConnectText(LinkText);
        _fake.Open();
        _fake.CloseFromServer(code);
        _chat.Poll();
        Assert.Equal(status, _chat.StatusText);
        Assert.True(_chat.ShowSetup);
        Assert.Equal((false, false, false, true, false, true), Enables());
        Assert.Empty(_chat.Entries);
    }

    [Fact]
    public void Ready_is_connected_with_one_note_and_send_follows_the_box()
    {
        Ready();
        Assert.Equal("connected", _chat.StatusText);
        Assert.False(_chat.ShowSetup);
        var note = Assert.Single(_chat.Entries);
        Assert.Equal(ChatEntryKind.Note, note.Kind);
        Assert.Equal(ChatModel.ReadyNote, note.Text);
        Assert.Equal((true, true, false, true, false, false), Enables());
        Assert.False(_chat.CanSend(" \n "));
        Assert.False(_chat.Submit("   ", "model-a"));
        Assert.Empty(_fake.Sent);
    }

    [Fact]
    public void A_full_session_sends_the_page_frames_and_adopts_then_releases_the_engines_machine()
    {
        Ready();
        Assert.True(_chat.Submit("  light lamp 1  ", "model-b"));
        Assert.Equal(["{\"type\":\"user\",\"text\":\"light lamp 1\",\"route\":\"model-b\"}"], _fake.Sent);
        Assert.Equal(ChatEntryKind.User, _chat.Entries[^1].Kind);
        Assert.Equal("light lamp 1", _chat.Entries[^1].Text);
        Assert.Equal((false, false, true, true, false, false), Enables());
        Assert.False(_chat.Submit("again", "model-a"));

        Server("{\"type\":\"started\",\"run\":\"2026-11-12-pane-1\"}");
        Assert.Equal("session 2026-11-12-pane-1", _chat.StatusText);
        Assert.Equal("Session 2026-11-12-pane-1 started; the model must create pane.json.", _chat.Entries[^1].Text);
        Assert.Equal(2, _engines);
        Assert.True(_chat.CanEnd);

        _fake.Sent.Clear();
        Server(CreateFrame(1));
        Assert.Equal(["{\"type\":\"reply\",\"id\":1,\"reply\":\"created\"}"], _fake.Sent);
        var machine = Assert.Single(_adopted);
        Assert.True(_chat.Adopted);
        Assert.Null(_chat.LastRunReply);

        Server("{\"type\":\"requesting\",\"turn\":1,\"route\":\"model-b\"}");
        Assert.Equal("waiting for model-b · request 1 · 0 s", _chat.WaitingText);
        _chat.Tick(0.6);
        _chat.Tick(0.6);
        Assert.Equal("waiting for model-b · request 1 · 1 s", _chat.WaitingText);
        Server("{\"type\":\"served\",\"turn\":1,\"status\":200,\"servedBy\":\"host-a\",\"fallbacks\":0,\"costUsd\":0.00125,\"offPrimary\":false}");
        Assert.Null(_chat.WaitingText);
        var reply = _chat.Entries[^1];
        Assert.Equal(ChatEntryKind.Model, reply.Kind);
        Assert.Equal("served by host-a · $0.0013", reply.Badge);
        Assert.False(reply.BadgeFallback);

        _fake.Sent.Clear();
        Server(RunFrame);
        var twin = new PaneEngine(Net, [RefA, Ideal]);
        PaneJson.Answer(twin, CreateFrame(1));
        var expected = PaneJson.Answer(twin, RunFrame)!;
        Assert.Equal(["{\"type\":\"reply\",\"id\":2,\"reply\":" + expected + "}"], _fake.Sent);
        Assert.StartsWith("{\"ok\":true", expected, StringComparison.Ordinal);
        Assert.Equal(expected, _chat.LastRunReply);
        Assert.Equal(2, _adopted.Count);
        Assert.Same(machine, _adopted[1]);
        Assert.Single(machine.Snapshot().cords);
        Assert.True(machine.Snapshot().power);

        Server("{\"type\":\"turn\",\"turn\":1,\"status\":200,\"servedBy\":\"host-a\",\"fallbacks\":0,\"costUsd\":0.00125," +
            "\"offPrimary\":false,\"content\":\"Wired.\",\"calls\":[" +
            "{\"name\":\"minivac_control\",\"args\":\"{\\\"args\\\":\\\"pane.json connect 1+/1A\\\"}\",\"output\":\"ok  connect 1+/1A\"}," +
            "{\"name\":\"read_file\",\"args\":\"{\\\"path\\\":\\\"x\\\"}\",\"output\":\"text\"}]}");
        Assert.Same(reply, _chat.Entries[^1]);
        Assert.Equal("Wired.", reply.Text);
        Assert.Equal(["minivac-control pane.json connect 1+/1A", "read_file {\"path\":\"x\"}"], reply.Calls.Select(call => call.Head));
        Assert.Equal([true, false], reply.Calls.Select(call => call.Open));
        Assert.Equal("ok  connect 1+/1A", reply.Calls[0].Output);

        Server("{\"type\":\"done\",\"stop\":\"done\",\"text\":\"Wired.\"}");
        Assert.False(_chat.Busy);
        Assert.Equal((true, true, false, true, true, false), Enables());

        _fake.Sent.Clear();
        _chat.EndSession();
        Assert.Equal(["{\"type\":\"end\"}"], _fake.Sent);
        Assert.Equal((false, true, false, false, false, false), Enables());
        Server("{\"type\":\"ended\",\"run\":\"2026-11-12-pane-1\"}");
        Assert.Equal(1, _releases);
        Assert.False(_chat.Adopted);
        Assert.Null(_chat.Run);
        Assert.Null(_chat.LastRunReply);
        Assert.Equal("connected", _chat.StatusText);
        Assert.Equal("Session ended: the machine is live and unlocked.", _chat.Entries[^1].Text);
        Assert.Equal((true, true, false, true, false, false), Enables());
    }

    [Fact]
    public void Stop_sends_stop_and_new_session_ends_then_clears_the_transcript()
    {
        Started();
        _chat.Stop();
        Assert.Equal(["{\"type\":\"stop\"}"], _fake.Sent);
        Server("{\"type\":\"done\",\"stop\":\"aborted\",\"text\":\"\"}");
        Assert.Equal("The turn stopped: aborted.", _chat.Entries[^1].Text);

        _fake.Sent.Clear();
        _chat.NewSession();
        Assert.Equal(["{\"type\":\"end\"}"], _fake.Sent);
        Server("{\"type\":\"ended\",\"run\":\"2026-11-12-pane-1\"}");
        var note = Assert.Single(_chat.Entries);
        Assert.Equal("New session: the next message starts from nothing.", note.Text);
        Assert.Equal(1, _releases);
    }

    [Fact]
    public void An_engine_error_ends_the_session_and_leaves_the_machine_locked_until_end_session()
    {
        Started();
        Server("{\"type\":\"request\",\"id\":2,\"op\":\"run\",\"calls\":null,\"settleMs\":500}");
        var reply = Assert.Single(_fake.Sent);
        Assert.StartsWith("{\"type\":\"reply\",\"id\":2,\"reply\":{\"error\":", reply, StringComparison.Ordinal);
        Server("{\"type\":\"done\",\"stop\":\"error\",\"text\":\"the page engine failed: x\"}");
        Server("{\"type\":\"ended\",\"run\":\"2026-11-12-pane-1\",\"error\":\"the page engine failed: x\"}");
        Assert.Equal(ChatEntryKind.Problem, _chat.Entries[^2].Kind);
        Assert.Equal("the page engine failed: x", _chat.Entries[^2].Text);
        Assert.Equal("The session ended: the page engine failed: x. End session unlocks the panel.", _chat.Entries[^1].Text);
        Assert.True(_chat.Adopted);
        Assert.Equal(0, _releases);
        Assert.Equal("connected", _chat.StatusText);
        Assert.Equal((true, true, false, true, true, false), Enables());

        _fake.Sent.Clear();
        _chat.EndSession();
        Server("{\"type\":\"ended\",\"run\":null}");
        Assert.Equal(["{\"type\":\"end\"}"], _fake.Sent);
        Assert.Equal(1, _releases);
        Assert.False(_chat.CanEnd);
    }

    [Fact]
    public void A_lost_connection_marks_the_run_invalid_and_end_session_releases_locally()
    {
        Started();
        Server("{\"type\":\"requesting\",\"turn\":1,\"route\":\"model-b\"}");
        _fake.CloseFromServer(-1);
        _chat.Poll();
        Assert.StartsWith("disconnected: the pane server connection closed (no close frame)", _chat.StatusText, StringComparison.Ordinal);
        Assert.Equal("The pane server connection closed; run 2026-11-12-pane-1 is marked invalid.", _chat.Entries[^1].Text);
        Assert.Equal(ChatEntryKind.Problem, _chat.Entries[^1].Kind);
        Assert.Null(_chat.WaitingText);
        Assert.True(_chat.ShowSetup);
        Assert.Equal((false, false, false, true, true, true), Enables());

        _fake.Sent.Clear();
        _chat.EndSession();
        Assert.Empty(_fake.Sent);
        Assert.Equal(1, _releases);
        Assert.False(_chat.Adopted);
        Assert.Equal("Session ended: the machine is live and unlocked.", _chat.Entries[^1].Text);
        Assert.False(_chat.CanEnd);
    }

    [Fact]
    public void A_failed_hand_back_keeps_end_session_on_and_a_second_end_releases()
    {
        Started();
        _fake.CloseFromServer(-1);
        _chat.Poll();
        _releaseFailure = new InvalidOperationException("remount failed");

        _chat.EndSession();
        Assert.Equal(1, _releases);
        Assert.True(_chat.Adopted);
        Assert.True(_chat.CanEnd);
        Assert.Equal(ChatEntryKind.Problem, _chat.Entries[^1].Kind);
        Assert.Equal("The console could not hand the machine back: remount failed", _chat.Entries[^1].Text);

        _chat.EndSession();
        Assert.Equal(2, _releases);
        Assert.False(_chat.Adopted);
        Assert.Equal("Session ended: the machine is live and unlocked.", _chat.Entries[^1].Text);
    }

    [Fact]
    public void A_lost_connection_while_ending_hands_the_machine_back()
    {
        Started();
        _chat.EndSession();
        _fake.CloseFromServer(1006);
        _chat.Poll();
        Assert.Equal(1, _releases);
        Assert.Equal("Session ended: the machine is live and unlocked.", _chat.Entries[^1].Text);
        Assert.True(_chat.CanNew);
    }

    [Fact]
    public void A_lost_connection_after_new_session_keeps_the_invalid_run_entry()
    {
        Started();
        _chat.NewSession();
        _fake.CloseFromServer(1006);
        _chat.Poll();
        Assert.Equal(1, _releases);
        Assert.Equal("New session: the next message starts from nothing.", _chat.Entries[0].Text);
        Assert.Equal("The pane server connection closed; run 2026-11-12-pane-1 is marked invalid.", _chat.Entries[^1].Text);
        Assert.Equal(2, _chat.Entries.Count);
    }

    [Fact]
    public void A_failed_session_with_no_machine_does_not_point_at_end_session()
    {
        Ready();
        _chat.Submit("hi", "model-a");
        Server("{\"type\":\"started\",\"run\":\"r\"}");
        Server(CreateFrame(1, "MV601-NOPE"));
        Server("{\"type\":\"ended\",\"run\":\"r\",\"error\":\"the page engine failed: x\"}");
        Assert.False(_chat.Adopted);
        Assert.False(_chat.CanEnd);
        Assert.Equal("The session ended: the page engine failed: x.", _chat.Entries[^1].Text);
    }

    [Fact]
    public void The_handed_back_machine_is_not_the_engines_any_more()
    {
        Started();
        var machine = Assert.Single(_adopted);
        Assert.Same(machine, _chat.EngineMachine);
        _chat.EndSession();
        Server("{\"type\":\"ended\",\"run\":\"2026-11-12-pane-1\"}");
        Assert.Null(_chat.EngineMachine);
    }

    [Fact]
    public void A_failed_send_reads_as_a_lost_connection()
    {
        Started();
        _fake.SendFailure = "OutOfMemory";
        _chat.Stop();
        Assert.Equal(PaneLinkState.Lost, _chat.Connection.State);
        Assert.Equal("The pane server connection closed; run 2026-11-12-pane-1 is marked invalid.", _chat.Entries[^1].Text);
        Assert.True(_chat.CanEnd);
    }

    [Fact]
    public void A_turn_with_no_served_event_makes_its_own_entry_with_the_failure_badge()
    {
        Ready();
        _chat.Submit("hi", "model-a");
        Server("{\"type\":\"turn\",\"turn\":1,\"status\":503,\"servedBy\":\"?\",\"fallbacks\":2,\"costUsd\":0,\"offPrimary\":true," +
            "\"stop\":\"http_503\",\"reason\":\"Service Unavailable; see transcript.jsonl\",\"content\":null,\"calls\":[]}");
        var entry = _chat.Entries[^1];
        Assert.Equal(ChatEntryKind.Model, entry.Kind);
        Assert.Equal("FALLBACK: not the route's primary · 2 fallbacks tried · request failed: http_503", entry.Badge);
        Assert.True(entry.BadgeFallback);
        Assert.True(entry.BadgeFailed);
        Assert.Equal("Service Unavailable; see transcript.jsonl", entry.Reason);
        Assert.Equal("", entry.Text);
        Server("{\"type\":\"done\",\"stop\":\"http_503\",\"text\":\"\"}");
        Assert.Equal("The turn stopped: http_503.", _chat.Entries[^1].Text);
        Server("{\"type\":\"done\",\"stop\":\"refused\",\"text\":\"the message is empty\"}");
        Assert.Equal(ChatEntryKind.Problem, _chat.Entries[^1].Kind);
        Server("{\"type\":\"error\",\"message\":\"a turn is already running\"}");
        Assert.Equal("a turn is already running", _chat.Entries[^1].Text);
    }

    [Fact]
    public void An_unknown_op_gets_no_reply_and_frames_this_build_cannot_read_are_dropped()
    {
        Ready();
        var count = _chat.Entries.Count;
        Server("{\"type\":\"request\",\"id\":9,\"op\":\"dance\"}");
        Server("{\"type\":\"wobble\"}");
        Server("not json");
        Assert.Empty(_fake.Sent);
        Assert.Equal(count, _chat.Entries.Count);
        Assert.Empty(_adopted);
    }

    [Fact]
    public void A_create_that_fails_adopts_nothing()
    {
        Ready();
        _chat.Submit("hi", "model-a");
        Server("{\"type\":\"started\",\"run\":\"r\"}");
        Server(CreateFrame(1, "MV601-NOPE"));
        Assert.Contains("the page has no profile \\\"MV601-NOPE\\\"", Assert.Single(_fake.Sent.Skip(1)), StringComparison.Ordinal);
        Assert.Empty(_adopted);
        Assert.False(_chat.Adopted);
    }

    [Fact]
    public void An_adopt_that_throws_is_an_error_entry()
    {
        var chat = new ChatModel(new PaneConnection(_fake), () => new PaneEngine(Net, [RefA, Ideal]),
            _ => throw new InvalidOperationException("console: no"), () => { });
        chat.ConnectText(LinkText);
        _fake.Open();
        _fake.Receive(ReadyFrame);
        _fake.Receive(CreateFrame(1));
        chat.Poll();
        Assert.Equal("The console could not show the machine: console: no", chat.Entries[^1].Text);
        Assert.False(chat.Adopted);
    }

    [Fact]
    public void New_session_without_a_link_clears_locally()
    {
        _chat.NewSession();
        Assert.Equal("New session: the next message starts from nothing.", Assert.Single(_chat.Entries).Text);
        Assert.Empty(_fake.Sent);
    }

    [Fact]
    public void Version_moves_with_every_drawn_change_but_not_the_clock()
    {
        Started();
        Server("{\"type\":\"requesting\",\"turn\":2,\"route\":\"model-a\"}");
        var version = _chat.Version;
        _chat.Tick(3.2);
        Assert.Equal(version, _chat.Version);
        Assert.Equal("waiting for model-a · request 2 · 3 s", _chat.WaitingText);
        Server("{\"type\":\"done\",\"stop\":\"done\",\"text\":\"\"}");
        Assert.True(_chat.Version > version);
    }

    [Theory]
    [InlineData("abc", 0, "abc")]
    [InlineData("abc", 2, "ab")]
    [InlineData("abc", 3, "abc")]
    [InlineData("a\U0001F600b", 2, "a")]
    [InlineData("a\U0001F600b", 3, "a\U0001F600")]
    public void Cap_cuts_to_the_servers_count_and_never_inside_a_pair(string text, int max, string expected) =>
        Assert.Equal(expected, ChatModel.Cap(text, max));

    [Fact]
    public void Cap_holds_the_8000_character_box()
    {
        var capped = ChatModel.Cap(new string('a', 8005), 8000);
        Assert.Equal(8000, capped.Length);
    }

    [Theory]
    [InlineData("minivac_control", "{\"args\":\"pane.json state\"}", "minivac-control pane.json state")]
    [InlineData("minivac_control", "{\"args\":5}", "minivac_control {\"args\":5}")]
    [InlineData("minivac_control", "{nope", "minivac_control {nope")]
    [InlineData("minivac_control", "[]", "minivac_control []")]
    [InlineData("read_file", "{\"args\":\"x\"}", "read_file {\"args\":\"x\"}")]
    [InlineData("minivac_control", "{\"args\":\"pane.json connect \\ud83d/1A\"}", "minivac-control pane.json connect \uFFFD/1A")]
    public void Call_labels_read_as_the_web_panes(string name, string args, string label) =>
        Assert.Equal(label, ChatModel.CallLabel(name, args));

    // ---------------------------------------------------------------- repairs from the C2 to C5 review

    private const string Note = "the run folder's transcript.jsonl has all of it";

    [Fact]
    public void Display_keeps_text_up_to_the_cap_and_cuts_longer_text_with_a_line_that_says_so()
    {
        Assert.Equal(4 * 1024, ChatModel.DisplayCap);
        var atCap = new string('w', ChatModel.DisplayCap);
        Assert.Same(atCap, ChatModel.Display(atCap));

        var shown = ChatModel.Display(new string('w', ChatModel.DisplayCap + 1));
        Assert.StartsWith(atCap + "\n", shown, StringComparison.Ordinal);
        // Not recorded in transcript.jsonl whole: a one-text entry's line does not point there.
        Assert.Equal("[showing 4,096 of 4,097 characters]", shown[(ChatModel.DisplayCap + 1)..]);

        var big = ChatModel.Display(new string('x', ChatModel.DisplayCap - 1) + "\U0001F600" + new string('y', 1 << 20));
        Assert.Equal(new string('x', ChatModel.DisplayCap - 1) + "\n", big[..ChatModel.DisplayCap]);
        Assert.EndsWith("\n[showing 4,095 of 1,052,673 characters]", big, StringComparison.Ordinal);
    }

    [Fact]
    public void Display_drops_c0_controls_but_newline_and_tab_and_drops_del()
    {
        Assert.Equal("a[2Jb\n\tc\u0085\u202ed", ChatModel.Display("a\u001b[2Jb\r\n\tc\u0000\u0007\u007f\u0085\u202ed"));
        var clean = "plain text\nwith a tab\t";
        Assert.Same(clean, ChatModel.Display(clean));
    }

    [Fact]
    public void Every_entry_shows_capped_clean_text_and_what_is_sent_is_untouched()
    {
        Ready();
        Assert.True(_chat.Submit("ring\u0007 the bell", "model-a"));
        Assert.Equal(["{\"type\":\"user\",\"text\":\"ring\\u0007 the bell\",\"route\":\"model-a\"}"], _fake.Sent);
        Assert.Equal("ring the bell", _chat.Entries[^1].Text);

        var huge = string.Concat(Enumerable.Repeat("word ", (1 << 20) / 5));
        var escaped = PaneProtocol.Quote("\u001b[1m" + huge);
        Server("{\"type\":\"turn\",\"turn\":1,\"status\":200,\"servedBy\":\"h\\u001b\",\"fallbacks\":0,\"costUsd\":0,\"offPrimary\":false," +
            "\"reason\":" + escaped + ",\"content\":" + escaped + ",\"calls\":[{\"name\":\"minivac_control\",\"args\":" +
            PaneProtocol.Quote("{\"args\":" + PaneProtocol.Quote(huge) + "}") + ",\"output\":" + escaped + "}]}");
        var reply = _chat.Entries[^1];
        Assert.Equal("served by h", reply.Badge);
        // Each field is cut at 4 KiB on its own; together they fill the entry's 16 KiB.
        Assert.Equal(16 * 1024, ChatModel.EntryCap);
        var cut = string.Concat("[1m", huge)[..ChatModel.DisplayCap] + "…";
        Assert.Equal(cut, reply.Reason);
        Assert.Equal(cut, reply.Text);
        Assert.Equal(("minivac-control " + huge)[..ChatModel.DisplayCap] + "…", Assert.Single(reply.Calls).Head);
        Assert.Equal(cut, reply.Calls[0].Output);
        Assert.Equal("[showing 16,384 of 4,194,325 characters; " + Note + "]", reply.Cut);

        Server("{\"type\":\"done\",\"stop\":\"error\",\"text\":" + escaped + "}");
        Server("{\"type\":\"error\",\"message\":" + escaped + "}");
        Server("{\"type\":\"ended\",\"run\":\"r\",\"error\":" + escaped + "}");
        foreach (var entry in _chat.Entries.TakeLast(3))
        {
            Assert.Equal(ChatEntryKind.Problem, entry.Kind);
            Assert.True(entry.Text.Length < ChatModel.DisplayCap + 200, "length " + entry.Text.Length);
            Assert.DoesNotContain('\u001b', entry.Text);
            Assert.DoesNotContain("transcript.jsonl", entry.Text, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void A_model_entry_cuts_each_field_and_the_whole_entry_and_shows_at_most_fifty_calls()
    {
        Ready();
        _chat.Submit("go", "model-a");
        static string Call(int i, string output) => "{\"name\":\"minivac_control\",\"args\":" + PaneProtocol.Quote("{\"args\":\"pane.json state " + i + "\"}") +
            ",\"output\":" + PaneProtocol.Quote(output) + "}";
        static string Turn(string content, IEnumerable<string> calls) =>
            "{\"type\":\"turn\",\"turn\":1,\"status\":200,\"servedBy\":\"?\",\"fallbacks\":0,\"costUsd\":0,\"offPrimary\":false,\"content\":" +
            PaneProtocol.Quote(content) + ",\"calls\":[" + string.Join(",", calls) + "]}";

        Server(Turn("Wired.", Enumerable.Range(0, 3).Select(i => Call(i, "ok " + i))));
        Assert.Null(_chat.Entries[^1].Cut);
        Assert.Equal(["ok 0", "ok 1", "ok 2"], _chat.Entries[^1].Calls.Select(call => call.Output));

        Assert.Equal(50, ChatModel.MaxCallsShown);
        Server(Turn("many", Enumerable.Range(0, 5000).Select(i => Call(i, "ok"))));
        var many = _chat.Entries[^1];
        Assert.Equal(50, many.Calls.Count);
        Assert.Equal("minivac-control pane.json state 49", many.Calls[^1].Head);
        Assert.Matches(@"^\[showing [\d,]+ of [\d,]+ characters and 50 of 5,000 calls; " + Note + @"\]$", many.Cut);

        // A typical reply, three 2.5 KiB state dumps: nothing is cut.
        Server(Turn(new string('t', 300), Enumerable.Range(0, 3).Select(i => Call(i, new string('s', 2560)))));
        Assert.Null(_chat.Entries[^1].Cut);
        Assert.All(_chat.Entries[^1].Calls, call => Assert.Equal(2560, call.Output.Length));

        // One long output is cut at 4 KiB on its own; the others stand.
        Server(Turn("x", [Call(0, "ok"), Call(1, new string('l', 5000)), Call(2, "ok")]));
        var one = _chat.Entries[^1];
        Assert.Equal(["ok", new string('l', ChatModel.DisplayCap) + "…", "ok"], one.Calls.Select(call => call.Output));
        Assert.StartsWith("[showing ", one.Cut, StringComparison.Ordinal);
        Assert.DoesNotContain(" calls", one.Cut, StringComparison.Ordinal);

        // Six 4,000-character outputs: the fifth is cut where the entry's 16 KiB runs out, the sixth not shown.
        var text = new string('t', 10);
        Server(Turn(text, Enumerable.Range(0, 6).Select(i => Call(i, new string((char)('a' + i), 4000)))));
        var cut = _chat.Entries[^1];
        Assert.Equal(5, cut.Calls.Count);
        Assert.Equal(new string('a', 4000), cut.Calls[0].Output);
        var used = 10 + cut.Calls.Take(4).Sum(call => call.Head.Length + call.Output.Length) + cut.Calls[4].Head.Length;
        Assert.Equal(new string('e', ChatModel.EntryCap - used) + "…", cut.Calls[4].Output);
        Assert.StartsWith("[showing 16,384 of ", cut.Cut, StringComparison.Ordinal);
        Assert.EndsWith(" and 5 of 6 calls; " + Note + "]", cut.Cut, StringComparison.Ordinal);
    }

    [Fact]
    public void A_failed_turns_cut_line_does_not_point_at_the_transcript()
    {
        Ready();
        _chat.Submit("go", "model-a");
        Server("{\"type\":\"turn\",\"turn\":1,\"status\":503,\"servedBy\":\"?\",\"fallbacks\":0,\"costUsd\":0,\"offPrimary\":false," +
            "\"stop\":\"http_503\",\"reason\":" + PaneProtocol.Quote(new string('r', 5000)) + ",\"content\":null,\"calls\":[]}");
        Assert.Equal("[showing 4,096 of 5,000 characters]", _chat.Entries[^1].Cut);
    }

    [Fact]
    public void A_done_with_a_lone_surrogate_or_wobbly_fields_still_ends_the_turn()
    {
        Started();
        Server("{\"type\":\"done\",\"stop\":\"done\",\"text\":\"Half an emoji \\ud83d\"}");
        Assert.False(_chat.Busy);
        Assert.True(_chat.CanSend("x"));

        Assert.True(_chat.Submit("again", "model-a"));
        Server("{\"type\":\"done\",\"stop\":\"error\",\"text\":\"failed at \\ud83d\"}");
        Assert.False(_chat.Busy);
        Assert.Equal("failed at \uFFFD", _chat.Entries[^1].Text);

        Assert.True(_chat.Submit("once more", "model-a"));
        Server("{\"type\":\"done\",\"stop\":5}");
        Assert.False(_chat.Busy);
        Assert.Equal("The turn stopped: 5.", _chat.Entries[^1].Text);
    }

    [Fact]
    public void A_malformed_ended_still_ends_the_ending_state_and_hands_back()
    {
        Started();
        Server("{\"type\":\"done\",\"stop\":\"done\",\"text\":\"\"}");
        _chat.EndSession();
        Assert.True(_chat.Ending);
        Server("{\"type\":\"ended\",\"run\":5,\"error\":\"x \\ud800\"}");
        Assert.False(_chat.Ending);
        Assert.Equal(1, _releases);
        Assert.Equal("The session ended: x \uFFFD.", _chat.Entries[^2].Text);
    }

    [Fact]
    public void A_lost_connection_clears_busy()
    {
        Started();
        Assert.True(_chat.Busy);
        _fake.CloseFromServer(1006);
        _chat.Poll();
        Assert.False(_chat.Busy);
    }

    [Fact]
    public void Stop_end_and_new_follow_the_enable_rules_whoever_presses_them()
    {
        Ready();
        _chat.Stop();
        _chat.EndSession();
        Assert.Empty(_fake.Sent);
        Assert.Equal([ChatModel.ReadyNote], _chat.Entries.Select(entry => entry.Text));

        Assert.True(_chat.Submit("go", "model-a"));
        Server("{\"type\":\"started\",\"run\":\"r\"}");
        _fake.Sent.Clear();
        _chat.NewSession();
        _chat.EndSession();
        _chat.NewSession();
        Assert.Equal(["{\"type\":\"end\"}"], _fake.Sent);
        Server("{\"type\":\"ended\",\"run\":\"r\"}");
        // The pending New session was not overwritten: the transcript is cleared.
        Assert.Equal("New session: the next message starts from nothing.", Assert.Single(_chat.Entries).Text);
    }

    [Fact]
    public void No_ended_within_fifteen_seconds_of_end_session_drops_the_link_and_hands_the_machine_back()
    {
        Assert.Equal(15, ChatModel.EndSeconds);
        Started();
        Server("{\"type\":\"requesting\",\"turn\":1,\"route\":\"model-b\"}");
        _chat.EndSession();
        _chat.Tick(14.75);
        Assert.True(_chat.Ending);
        Assert.True(_chat.Ready);
        Assert.Equal("waiting for model-b · request 1 · 14 s", _chat.WaitingText);
        Assert.False(_fake.ClosedByClient);

        _chat.Tick(0.25);
        Assert.False(_chat.Ending);
        Assert.False(_chat.Busy);
        Assert.True(_fake.ClosedByClient);
        Assert.Equal(PaneLinkState.Lost, _chat.Connection.State);
        Assert.Equal("disconnected: " + ChatModel.EndTimeoutReason, _chat.StatusText);
        Assert.Equal("The pane server connection closed; run 2026-11-12-pane-1 is marked invalid.", _chat.Entries[^2].Text);
        Assert.Equal("Session ended: the machine is live and unlocked.", _chat.Entries[^1].Text);
        Assert.Equal(1, _releases);
        Assert.False(_chat.Adopted);
        Assert.True(_chat.CanConnect);
    }

    [Fact]
    public void An_ended_in_time_stops_the_end_clock()
    {
        Started();
        _chat.EndSession();
        _chat.Tick(14);
        Server("{\"type\":\"ended\",\"run\":\"2026-11-12-pane-1\"}");
        _chat.Tick(100);
        Assert.True(_chat.Ready);
        Assert.False(_fake.ClosedByClient);
    }

    [Fact]
    public void Connecting_with_no_answer_falls_to_could_not_connect_on_the_models_clock()
    {
        _chat.ConnectText(LinkText);
        _chat.Tick(9.75);
        Assert.Equal("connecting…", _chat.StatusText);
        _chat.Tick(0.25);
        Assert.Equal("disconnected: " + PaneConnection.NoAnswerReason, _chat.StatusText);
        Assert.True(_chat.CanConnect);
        Assert.True(_chat.ShowSetup);
    }

    [Theory]
    [InlineData("?", false, 0, 0.0, null, "")]
    [InlineData("h", false, 1, 0.0, null, "served by h · 1 fallback tried")]
    [InlineData("h", true, 0, 1.5, null, "served by h · FALLBACK: not the route's primary · $1.5000")]
    [InlineData("?", false, 0, 0.0, "wrong_api_base", "request failed: wrong_api_base")]
    public void Badge_text_reads_as_the_web_panes(string servedBy, bool off, int fallbacks, double cost, string? stop, string text) =>
        Assert.Equal(text, ChatModel.ServedText(servedBy, off, fallbacks, cost, stop));

    [Fact]
    public void The_waiting_line_floors_its_seconds()
    {
        Assert.Equal("waiting for r · request 3 · 0 s", ChatModel.WaitingLine("r", 3, 0.999));
        Assert.Equal("waiting for r · request 3 · 14 s", ChatModel.WaitingLine("r", 3, 14.2));
    }

    private static Profile LoadProfile(string id)
    {
        using var document = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(Root(), "data", "profiles", id + ".json")));
        return Profile.LoadProfile(document.RootElement);
    }

    private static string Root()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "data", "netlist.json")))
            directory = directory.Parent;
        return directory?.FullName ?? throw new InvalidOperationException("repository root not found");
    }
}
