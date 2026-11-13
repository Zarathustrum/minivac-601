using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Minivac.Core;
using Minivac.Hands;
using Xunit;

namespace Minivac.Godot.Tests;

// C5: the cord marks (docs/plans/godot-chat-pane.md, "Cord marks"): which cords the last run reply added,
// read from the engine's own reply JSON, and when the dock's model clears them.
public sealed class C5CordMarksTests
{
    private const string ReadyFrame = "{\"type\":\"ready\",\"routes\":[\"model-a\"],\"maxUserChars\":8000}";
    private const string LinkText = "http://127.0.0.1:5173/dev.html#t=tok-1&port=9123";
    private static readonly LoadedNetlist Net = Netlist.LoadNetlist(File.ReadAllBytes(Path.Combine(Root(), "data", "netlist.json")));
    private static readonly Profile RefA = LoadProfile("MV601-REF-A");
    private static readonly Profile Ideal = LoadProfile("MV601-IDEAL");

    private readonly FakePaneTransport _fake = new();
    private readonly ChatModel _chat;
    private readonly List<Machine> _adopted = [];

    public C5CordMarksTests() =>
        _chat = new ChatModel(new PaneConnection(_fake), () => new PaneEngine(Net, [RefA, Ideal]), _adopted.Add, () => { });

    private static string CreateFrame() =>
        "{\"type\":\"request\",\"id\":1,\"op\":\"create\",\"session\":" + HandsJson.Session(Table.newSession(Net, RefA)) + "}";

    private static string Run(params string[] calls) =>
        "{\"type\":\"request\",\"id\":2,\"op\":\"run\",\"calls\":[" + string.Join(",", calls) + "],\"settleMs\":200}";

    private static string Connect(string a, string b) => "{\"name\":\"connect\",\"args\":{\"a\":\"" + a + "\",\"b\":\"" + b + "\"}}";

    private static string Unplug(int cord) => "{\"name\":\"disconnect\",\"args\":{\"cord\":" + cord + "}}";

    private const string PowerOn = "{\"name\":\"power\",\"args\":{\"on\":true}}";

    /// <summary>A fresh engine with a live session; each frame's reply, in order.</summary>
    private static List<string> Replies(params string[] frames)
    {
        var engine = new PaneEngine(Net, [RefA, Ideal]);
        Assert.Equal("\"created\"", PaneJson.Answer(engine, CreateFrame()));
        return frames.Select(frame => PaneJson.Answer(engine, frame)!).ToList();
    }

    /// <summary>The cord ids in an accepted reply's view.</summary>
    private static int[] LiveIds(string reply)
    {
        using var document = JsonDocument.Parse(reply);
        return document.RootElement.GetProperty("view").GetProperty("cords").EnumerateArray()
            .Select(cord => cord.GetProperty("id").GetInt32()).ToArray();
    }

    private void Started()
    {
        Assert.True(_chat.ConnectText(LinkText));
        _fake.Open();
        _fake.Receive(ReadyFrame);
        _chat.Poll();
        Assert.True(_chat.Submit("wire it", "model-a"));
        Server("{\"type\":\"started\",\"run\":\"2026-11-12-pane-1\"}");
        Server(CreateFrame());
    }

    private void Server(string frame)
    {
        _fake.Receive(frame);
        _chat.Poll();
    }

    [Fact]
    public void A_run_that_adds_two_cords_marks_exactly_those_two()
    {
        var replies = Replies(Run(Connect("1+", "1A"), Connect("2+", "2A"), Connect("3+", "3A")), Run(Connect("4+", "4A"), PowerOn, Connect("5+", "5A")));
        var first = LiveIds(replies[0]);
        var second = LiveIds(replies[1]).Except(first).ToArray();
        Assert.Equal(3, first.Length);
        Assert.Equal(2, second.Length);
        Assert.Equal(first.Order(), ChatModel.AddedCords(replies[0]).Order());
        Assert.Equal(second.Order(), ChatModel.AddedCords(replies[1]).Order());
    }

    [Fact]
    public void A_run_that_adds_none_marks_nothing()
    {
        var replies = Replies(Run(Connect("1+", "1A")), Run(PowerOn), Run("{\"name\":\"state\",\"args\":{}}"));
        Assert.Single(ChatModel.AddedCords(replies[0]));
        Assert.Empty(ChatModel.AddedCords(replies[1]));
        Assert.Empty(ChatModel.AddedCords(replies[2]));
    }

    [Fact]
    public void A_load_program_marks_every_cord_it_plugged()
    {
        var replies = Replies(Run("{\"name\":\"loadProgram\",\"args\":{\"program\":\"T1\",\"wires\":[\"1+/1A\",\"2+/2A\"]}}"));
        Assert.StartsWith("{\"ok\":true", replies[0], StringComparison.Ordinal);
        Assert.Equal(LiveIds(replies[0]).Order(), ChatModel.AddedCords(replies[0]).Order());
        Assert.Equal(2, ChatModel.AddedCords(replies[0]).Count);
    }

    [Fact]
    public void A_cord_added_then_unplugged_in_the_same_batch_gets_no_mark()
    {
        // Cord 0 from the first batch; the second plugs 1 and 2 and unplugs 2; the third plugs 2 and unplugs it.
        var replies = Replies(Run(Connect("1+", "1A")), Run(Connect("2+", "2A"), Connect("3+", "3A"), Unplug(2)),
            Run(Connect("4+", "4A"), Unplug(2)));
        Assert.Equal([0, 1], LiveIds(replies[1]).Order());
        Assert.Equal([1], ChatModel.AddedCords(replies[1]));
        Assert.Equal([0, 1], LiveIds(replies[2]).Order());
        Assert.Empty(ChatModel.AddedCords(replies[2]));
    }

    [Fact]
    public void An_id_freed_and_reused_marks_the_new_cord()
    {
        // Lowest unused id: the first batch's cords are 0 and 1; unplugging 0 and connecting again reuses 0.
        var replies = Replies(Run(Connect("1+", "1A"), Connect("2+", "2A")), Run(Unplug(0), Connect("3+", "3A")), Run(Unplug(1)));
        Assert.Equal([0, 1], LiveIds(replies[0]).Order());
        Assert.Equal([0, 1], LiveIds(replies[1]).Order());
        Assert.Equal([0], ChatModel.AddedCords(replies[1]));
        Assert.Empty(ChatModel.AddedCords(replies[2]));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("\"missing\"")]
    [InlineData("{\"error\":\"the page machine failed a validated batch: x\"}")]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("{\"ok\":true,\"results\":[{\"ok\":true,\"cord\":{\"id\":3}}]}")]
    public void Anything_but_an_accepted_reply_with_its_view_marks_nothing(string? reply) =>
        Assert.Empty(ChatModel.AddedCords(reply));

    [Fact]
    public void A_refused_batch_marks_nothing()
    {
        var replies = Replies(Run(Connect("1+", "1A"), Connect("ZZ", "1A")));
        Assert.StartsWith("{\"ok\":false", replies[0], StringComparison.Ordinal);
        Assert.Empty(ChatModel.AddedCords(replies[0]));
    }

    [Fact]
    public void The_model_marks_after_each_run_and_a_state_or_session_read_keeps_them()
    {
        Started();
        Assert.Empty(_chat.MarkedCords);
        Server(Run(Connect("1+", "1A"), Connect("2+", "2A")));
        Assert.Equal([0, 1], _chat.MarkedCords.Order());
        Server("{\"type\":\"request\",\"id\":3,\"op\":\"state\"}");
        Server("{\"type\":\"request\",\"id\":4,\"op\":\"session\"}");
        Assert.Equal([0, 1], _chat.MarkedCords.Order());
        Server(Run(Connect("3+", "3A")));
        Assert.Equal([2], _chat.MarkedCords);
        Server(Run(PowerOn));
        Assert.Empty(_chat.MarkedCords);
        Server(Run(Connect("4+", "4A")));
        Server(Run(Connect("ZZ", "1A")));
        Assert.Empty(_chat.MarkedCords);
    }

    // Tom, 2026-11-12: a run that adds 12 cords or fewer marks them; one that adds more marks none.
    private static readonly string[] Pairs =
    [
        "1A/1N", "1C/2C", "1F/M11", "1G/2A", "1H/5X", "1J/2F", "1L/1Z", "1X/2H",
        "3C/4C", "3F/4F", "3G/4G", "3H/4H", "3J/4J", "5C/6C", "5F/6F", "5G/6G", "5H/6H", "5J/6J",
        "3L/4L", "5L/6L", "3X/4X", "3N/4N", "3A/4A", "5A/6A", "3B/4B",
    ];

    private static string[] Connects(int from, int count) =>
        Pairs.Skip(from).Take(count).Select(pair => Connect(pair.Split('/')[0], pair.Split('/')[1])).ToArray();

    [Fact]
    public void A_run_that_adds_twelve_cords_marks_them_and_one_that_adds_thirteen_marks_none()
    {
        Started();
        Server(Run(Connects(0, 12)));
        Assert.Equal(12, ChatModel.AddedCords(_chat.LastRunReply).Count);
        Assert.Equal(Enumerable.Range(0, 12), _chat.MarkedCords.Order());
        Server(Run(Connects(12, 13)));
        Assert.Equal(13, ChatModel.AddedCords(_chat.LastRunReply).Count);
        Assert.Empty(_chat.MarkedCords);
    }

    [Fact]
    public void End_session_new_session_and_a_new_start_clear_the_marks()
    {
        Started();
        Server(Run(Connect("1+", "1A")));
        Assert.Single(_chat.MarkedCords);
        _chat.EndSession();
        Assert.Single(_chat.MarkedCords);
        Server("{\"type\":\"ended\",\"run\":\"2026-11-12-pane-1\"}");
        Assert.Empty(_chat.MarkedCords);
        Server("{\"type\":\"done\",\"stop\":\"done\",\"text\":\"\"}");

        Assert.True(_chat.Submit("again", "model-a"));
        Server("{\"type\":\"started\",\"run\":\"2026-11-12-pane-2\"}");
        Server(CreateFrame());
        Server(Run(Connect("1+", "1A")));
        Assert.Single(_chat.MarkedCords);
        _chat.NewSession();
        Server("{\"type\":\"ended\",\"run\":\"2026-11-12-pane-2\"}");
        Assert.Empty(_chat.MarkedCords);
        Server("{\"type\":\"done\",\"stop\":\"done\",\"text\":\"\"}");

        // A session the engine ended keeps the machine adopted; the next start clears what it showed.
        Assert.True(_chat.Submit("third", "model-a"));
        Server("{\"type\":\"started\",\"run\":\"2026-11-12-pane-3\"}");
        Server(CreateFrame());
        Server(Run(Connect("1+", "1A")));
        Assert.Single(_chat.MarkedCords);
        Server("{\"type\":\"request\",\"id\":5,\"op\":\"run\",\"calls\":null,\"settleMs\":500}");
        Assert.Empty(_chat.MarkedCords);
    }

    [Fact]
    public void A_lost_connection_then_end_session_clears_the_marks()
    {
        Started();
        Server(Run(Connect("1+", "1A")));
        _fake.CloseFromServer(-1);
        _chat.Poll();
        Assert.True(_chat.Adopted);
        _chat.EndSession();
        Assert.False(_chat.Adopted);
        Assert.Empty(_chat.MarkedCords);
    }

    [Fact]
    public void The_mark_colour_is_one_token_and_none_of_the_cord_lamp_panel_or_focus_colours()
    {
        var mark = TactileTheme.CordMarkColour;
        Assert.Contains(mark, TactileTheme.Tokens);
        Assert.Equal(mark.Value, PanelTheme.CordMark);
        Assert.DoesNotContain(mark.Value, new[]
        {
            TactileTheme.CordColour.Value, TactileTheme.LampColour.Value, TactileTheme.ConsoleRedLit.Value,
            TactileTheme.ConsoleRed.Value, TactileTheme.ConsoleCream.Value, TactileTheme.ConsoleTeal.Value,
            TactileTheme.ConsoleDark.Value, TactileTheme.TaperPinGrey.Value, PanelTheme.FocusBlue,
        });
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
