using System;
using System.IO;
using System.Text.RegularExpressions;
using Xunit;

namespace Minivac.Godot.Tests;

public sealed class C3PaneProtocolTests
{
    // ---------------------------------------------------------------- the constants against the TypeScript

    [Fact]
    public void Constants_match_the_typescript_protocol()
    {
        var source = File.ReadAllText(Path.Combine(FindRepositoryRoot(), "src", "pane", "protocol.ts"));

        Assert.Equal(PaneProtocol.Version, Constant(source, "PANE_PROTOCOL"));
        Assert.Equal(PaneProtocol.DefaultPort, Constant(source, "DEFAULT_PANE_PORT"));
        Assert.Equal(PaneProtocol.CloseBadToken, Constant(source, "CLOSE_BAD_TOKEN"));
        Assert.Equal(PaneProtocol.CloseBadProtocol, Constant(source, "CLOSE_BAD_PROTOCOL"));
        Assert.Equal(PaneProtocol.CloseNoHello, Constant(source, "CLOSE_NO_HELLO"));
    }

    // The web's two refusals say what went wrong and what to do; the desktop build says the same thing in
    // its own words (C4): no page to reload, no URL to open.
    [Fact]
    public void Refusal_wording_keeps_the_web_panes_meaning_in_desktop_words()
    {
        var source = File.ReadAllText(Path.Combine(FindRepositoryRoot(), "src", "pane", "ui.ts"));
        var webToken = Reason(source, "CLOSE_BAD_TOKEN");
        var webBuild = Reason(source, "CLOSE_BAD_PROTOCOL");

        Assert.StartsWith("the server refused the token: ", webToken, StringComparison.Ordinal);
        Assert.Contains("another build than the server", webBuild, StringComparison.Ordinal);
        Assert.Equal("the server refused the token: paste the link the pane server printed last", PaneConnection.BadTokenReason);
        Assert.Equal(
            "this build and the pane server are different versions: rebuild this app or restart the pane server",
            PaneConnection.BadProtocolReason);
        foreach (var reason in new[] { PaneConnection.BadTokenReason, PaneConnection.BadProtocolReason })
        {
            Assert.DoesNotContain("page", reason, StringComparison.Ordinal);
            Assert.DoesNotContain("reload", reason, StringComparison.Ordinal);
            Assert.DoesNotContain("URL", reason, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Max_frame_matches_the_server_payload_cap()
    {
        var source = File.ReadAllText(Path.Combine(FindRepositoryRoot(), "tools", "hands-pane", "server.ts"));

        Assert.Matches(@"const MAX_PAYLOAD = 4 \* 1024 \* 1024;", source);
        Assert.Equal(4 * 1024 * 1024, PaneProtocol.MaxFrameBytes);
    }

    // ---------------------------------------------------------------- the link

    [Theory]
    [InlineData("http://127.0.0.1:5173/dev.html#t=abc&port=9000", "abc", 9000, "http://127.0.0.1:5173")]
    [InlineData("  http://127.0.0.1:5173/dev.html#t=abc&port=9000 \n", "abc", 9000, "http://127.0.0.1:5173")]
    [InlineData("http://127.0.0.1:5173/dev.html#t=abc", "abc", 8601, "http://127.0.0.1:5173")]
    [InlineData("http://localhost:5173/dev.html#port=12&t=abc", "abc", 12, "http://localhost:5173")]
    [InlineData("http://LocalHost:5173/dev.html#t=abc", "abc", 8601, "http://localhost:5173")]
    [InlineData("http://127.0.0.1/dev.html#t=abc", "abc", 8601, "http://127.0.0.1")]
    [InlineData("http://127.0.0.1:80/dev.html#t=abc", "abc", 8601, "http://127.0.0.1")]
    [InlineData("https://[::1]:5173/#t=abc", "abc", 8601, "https://[::1]:5173")]
    [InlineData("http://u:p@127.0.0.1:5173/#t=abc", "abc", 8601, "http://127.0.0.1:5173")]
    [InlineData("http://127.0.0.1:5173/dev.html#t=a+b%20c&port=08601", "a b c", 8601, "http://127.0.0.1:5173")]
    [InlineData("http://127.0.0.1:5173/dev.html#t=x&t=y", "x", 8601, "http://127.0.0.1:5173")]
    [InlineData("http://127.0.0.1:5173/dev.html#&t=x&&port=65535&", "x", 65535, "http://127.0.0.1:5173")]
    [InlineData("http://127.0.0.1:5173/dev.html#t=x&port=%2012%20", "x", 12, "http://127.0.0.1:5173")]
    public void Link_shapes_the_page_accepts_are_read(string text, string token, int port, string origin)
    {
        var link = PaneLink.Read(text, out var problem);

        Assert.Equal(new PaneLink(token, port, origin), link);
        Assert.Equal("", problem);
    }

    [Theory]
    [InlineData("", "not a link")]
    [InlineData("   ", "not a link")]
    [InlineData("#t=abc&port=9000", "not a link")]
    [InlineData("t=abc&port=9000", "not a link")]
    [InlineData("127.0.0.1:5173/dev.html#t=abc", "not a link")]
    [InlineData("localhost:5173/dev.html#t=abc", "not a link")]
    [InlineData("ws://127.0.0.1:8601/#t=abc", "not a link")]
    [InlineData("file:///dev.html#t=abc", "not a link")]
    [InlineData("http://127.0.0.1:5173/dev.html", "no token")]
    [InlineData("http://127.0.0.1:5173/dev.html#", "no token")]
    [InlineData("http://127.0.0.1:5173/dev.html#t=&port=1", "no token")]
    [InlineData("http://127.0.0.1:5173/dev.html#t&port=1", "no token")]
    [InlineData("http://127.0.0.1:5173/dev.html#port=1", "no token")]
    [InlineData("http://127.0.0.1:5173/dev.html#t=x&port=", "port")]
    [InlineData("http://127.0.0.1:5173/dev.html#t=x&port=0", "port")]
    [InlineData("http://127.0.0.1:5173/dev.html#t=x&port=65536", "port")]
    [InlineData("http://127.0.0.1:5173/dev.html#t=x&port=99999999999", "port")]
    [InlineData("http://127.0.0.1:5173/dev.html#t=x&port=-1", "port")]
    [InlineData("http://127.0.0.1:5173/dev.html#t=x&port=abc", "port")]
    [InlineData("http://127.0.0.1:5173/dev.html#t=x&port=1.5", "port")]
    public void Link_shapes_are_refused_with_a_reason(string text, string reason)
    {
        Assert.Null(PaneLink.Read(text, out var problem));
        Assert.Contains(reason, problem, StringComparison.Ordinal);
    }

    [Fact]
    public void Link_never_prints_its_token()
    {
        var link = PaneLink.Read("http://127.0.0.1:5173/dev.html#t=s3cret-token&port=9000", out _)!;

        Assert.DoesNotContain("s3cret", link.ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain("s3cret", new PageMessage.Hello("s3cret-token").ToString(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(new[] { "--pane-link", "http://x/#t=a" }, "http://x/#t=a")]
    [InlineData(new[] { "--view", "flat", "--pane-link", "http://x/#t=a", "--other" }, "http://x/#t=a")]
    [InlineData(new[] { "--pane-link" }, "")]
    [InlineData(new[] { "--acceptance", "chat" }, null)]
    [InlineData(new string[0], null)]
    public void Pane_link_flag_is_read_from_user_args(string[] args, string? expected) =>
        Assert.Equal(expected, PaneLink.FromArgs(args));

    // The server leaves its link in a file (tools/hands-pane/server.ts, LINK_FILE); the dock fills its field from it.
    [Fact]
    public void Published_link_file_is_where_the_server_writes_it()
    {
        var server = File.ReadAllText(Path.Combine(FindRepositoryRoot(), "tools", "hands-pane", "server.ts"));

        Assert.Contains("LINK_FILE = join(homedir(), '.minivac', 'pane-link')", server, StringComparison.Ordinal);
        Assert.Equal("/someone/.minivac/pane-link", PaneLink.FilePath("/someone"));
    }

    // ---------------------------------------------------------------- client frames, as JSON.stringify writes them

    // Expected strings are Node 26.12.0's JSON.stringify output for the same objects, run 2026-11-11.
    private const string Awkward =
        "q\"b\\s/ n\n t\t r\r b\b f\f c\u0001 c\u001f del\u007f é 😀 lone\ud800 x\udc00 ls\u2028 <>&' +";

    [Fact]
    public void Client_frames_serialise_as_the_web_page_sends_them()
    {
        Assert.Equal("{\"type\":\"hello\",\"protocol\":3,\"token\":\"tok-123\"}",
            PaneProtocol.Serialize(new PageMessage.Hello("tok-123")));
        Assert.Equal(
            "{\"type\":\"user\",\"text\":\"q\\\"b\\\\s/ n\\n t\\t r\\r b\\b f\\f c\\u0001 c\\u001f del\u007f é 😀 lone\\ud800 x\\udc00 ls\u2028 <>&' +\",\"route\":\"model/a b\"}",
            PaneProtocol.Serialize(new PageMessage.User(Awkward, "model/a b")));
        Assert.Equal("{\"type\":\"stop\"}", PaneProtocol.Serialize(new PageMessage.Stop()));
        Assert.Equal("{\"type\":\"end\"}", PaneProtocol.Serialize(new PageMessage.End()));
    }

    [Fact]
    public void Reply_splices_the_engine_json_unchanged()
    {
        const string raw = "{\"n\":1e21,\"f\":0.30000000000000004,\"g\":1.0,\"s\":\"é\\u00e9\",\"a\":[]}";

        Assert.Equal("{\"type\":\"reply\",\"id\":7,\"reply\":" + raw + "}",
            PaneProtocol.Serialize(new PageMessage.Reply(7, raw)));
        Assert.Equal("{\"type\":\"reply\",\"id\":9007199254740991,\"reply\":\"missing\"}",
            PaneProtocol.Serialize(new PageMessage.Reply(9_007_199_254_740_991L, "\"missing\"")));
    }

    // ---------------------------------------------------------------- server frames

    [Fact]
    public void Ready_started_requesting_done_and_error_parse()
    {
        var ready = Assert.IsType<ServerMessage.Ready>(PaneProtocol.Parse("{\"type\":\"ready\",\"routes\":[\"a\",\"b\"],\"maxUserChars\":8000}"));
        Assert.Equal(["a", "b"], ready.Routes);
        Assert.Equal(8000, ready.MaxUserChars);

        Assert.Equal(new ServerMessage.Started("2026-11-11-pane-1"),
            PaneProtocol.Parse("{\"type\":\"started\",\"run\":\"2026-11-11-pane-1\"}"));
        Assert.Equal(new ServerMessage.Requesting(2, "fake"),
            PaneProtocol.Parse("{\"type\":\"requesting\",\"turn\":2,\"route\":\"fake\"}"));
        Assert.Equal(new ServerMessage.Done("refused", "why\nnot"),
            PaneProtocol.Parse("{\"type\":\"done\",\"stop\":\"refused\",\"text\":\"why\\nnot\"}"));
        Assert.Equal(new ServerMessage.ServerError("not a pane message"),
            PaneProtocol.Parse("{\"type\":\"error\",\"message\":\"not a pane message\"}"));
    }

    [Fact]
    public void Request_keeps_the_whole_frame_text()
    {
        const string frame = "{\"type\":\"request\",\"id\":3,\"op\":\"run\",\"calls\":[{\"op\":\"press\",\"button\":1}],\"settleMs\":250}";

        Assert.Equal(new ServerMessage.Request(3, "run", frame), PaneProtocol.Parse(frame));
        Assert.Equal(new ServerMessage.Request(1, "state", "{\"type\":\"request\",\"id\":1,\"op\":\"state\"}"),
            PaneProtocol.Parse("{\"type\":\"request\",\"id\":1,\"op\":\"state\"}"));
    }

    [Fact]
    public void Served_and_turn_parse_with_optional_fields()
    {
        Assert.Equal(new ServerMessage.ServedEvent(1, 200, "?", 0, 0, false),
            PaneProtocol.Parse("{\"type\":\"served\",\"turn\":1,\"status\":200,\"servedBy\":\"?\",\"fallbacks\":0,\"costUsd\":0,\"offPrimary\":false}"));

        var plain = Assert.IsType<ServerMessage.TurnEvent>(PaneProtocol.Parse(
            "{\"type\":\"turn\",\"turn\":1,\"status\":200,\"servedBy\":\"http://h:1\",\"fallbacks\":2,\"costUsd\":0.0012," +
            "\"offPrimary\":true,\"content\":\"I'll wire it.\",\"calls\":[{\"name\":\"minivac_control\",\"args\":\"{\\\"args\\\":\\\"state\\\"}\",\"output\":\"ok\"}]}"));
        Assert.Equal((1, 200, "http://h:1", 2, 0.0012, true), (plain.Turn, plain.Status, plain.ServedBy, plain.Fallbacks, plain.CostUsd, plain.OffPrimary));
        Assert.Null(plain.Stop);
        Assert.Null(plain.Reason);
        Assert.Equal("I'll wire it.", plain.Content);
        Assert.Equal([new ServerMessage.TurnCall("minivac_control", "{\"args\":\"state\"}", "ok")], plain.Calls);

        var failed = Assert.IsType<ServerMessage.TurnEvent>(PaneProtocol.Parse(
            "{\"type\":\"turn\",\"turn\":3,\"status\":500,\"servedBy\":\"?\",\"fallbacks\":0,\"costUsd\":0,\"offPrimary\":false," +
            "\"stop\":\"http_500\",\"reason\":\"Internal Server Error\",\"content\":null,\"calls\":[]}"));
        Assert.Equal("http_500", failed.Stop);
        Assert.Equal("Internal Server Error", failed.Reason);
        Assert.Null(failed.Content);
        Assert.Empty(failed.Calls);
    }

    [Fact]
    public void Ended_parses_with_and_without_a_run_and_an_error()
    {
        Assert.Equal(new ServerMessage.Ended("r-1", null), PaneProtocol.Parse("{\"type\":\"ended\",\"run\":\"r-1\"}"));
        Assert.Equal(new ServerMessage.Ended(null, null), PaneProtocol.Parse("{\"type\":\"ended\",\"run\":null}"));
        Assert.Equal(new ServerMessage.Ended("r-1", "the page engine threw: x"),
            PaneProtocol.Parse("{\"type\":\"ended\",\"run\":\"r-1\",\"error\":\"the page engine threw: x\"}"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("{\"type\":\"ready\"")]
    [InlineData("[1,2]")]
    [InlineData("\"ready\"")]
    [InlineData("null")]
    [InlineData("{}")]
    [InlineData("{\"type\":7}")]
    [InlineData("{\"type\":\"bogus\"}")]
    [InlineData("{\"type\":\"hello\",\"protocol\":3,\"token\":\"x\"}")]
    [InlineData("{\"type\":\"ready\",\"routes\":\"a\",\"maxUserChars\":8000}")]
    [InlineData("{\"type\":\"ready\",\"routes\":[\"a\",1],\"maxUserChars\":8000}")]
    [InlineData("{\"type\":\"ready\",\"routes\":[\"a\"],\"maxUserChars\":8000.5}")]
    [InlineData("{\"type\":\"ready\",\"routes\":[\"a\"]}")]
    [InlineData("{\"type\":\"started\",\"run\":null}")]
    [InlineData("{\"type\":\"request\",\"id\":\"3\",\"op\":\"run\"}")]
    [InlineData("{\"type\":\"request\",\"id\":1.5,\"op\":\"run\"}")]
    [InlineData("{\"type\":\"request\",\"id\":9007199254740992,\"op\":\"run\"}")]
    [InlineData("{\"type\":\"request\",\"id\":1}")]
    [InlineData("{\"type\":\"requesting\",\"turn\":1}")]
    [InlineData("{\"type\":\"served\",\"turn\":1,\"status\":200,\"servedBy\":\"?\",\"fallbacks\":0,\"costUsd\":\"0\",\"offPrimary\":false}")]
    [InlineData("{\"type\":\"served\",\"status\":200,\"servedBy\":\"?\",\"fallbacks\":0,\"costUsd\":0,\"offPrimary\":false}")]
    [InlineData("{\"type\":\"turn\",\"turn\":1,\"status\":200,\"servedBy\":\"?\",\"fallbacks\":0,\"costUsd\":0,\"offPrimary\":false,\"calls\":[]}")]
    [InlineData("{\"type\":\"turn\",\"turn\":1,\"status\":200,\"servedBy\":\"?\",\"fallbacks\":0,\"costUsd\":0,\"offPrimary\":false,\"content\":1,\"calls\":[]}")]
    [InlineData("{\"type\":\"turn\",\"turn\":1,\"status\":200,\"servedBy\":\"?\",\"fallbacks\":0,\"costUsd\":0,\"offPrimary\":false,\"content\":null}")]
    [InlineData("{\"type\":\"turn\",\"turn\":1,\"status\":200,\"servedBy\":\"?\",\"fallbacks\":0,\"costUsd\":0,\"offPrimary\":false,\"content\":null,\"calls\":[null]}")]
    public void Malformed_and_unknown_frames_are_not_understood(string frame) =>
        Assert.IsType<ServerMessage.NotUnderstood>(PaneProtocol.Parse(frame));

    // ---------------------------------------------------------------- what the web page reads anyway (src/pane/ui.ts)

    [Fact]
    public void An_unpaired_surrogate_reads_as_the_replacement_character_in_every_string()
    {
        Assert.Equal(new ServerMessage.Done("done", "Half an emoji \uFFFD at the end"),
            PaneProtocol.Parse("{\"type\":\"done\",\"stop\":\"done\",\"text\":\"Half an emoji \\ud83d at the end\"}"));
        Assert.Equal(new ServerMessage.Done("done", "\uFFFD\uFFFDx\U0001F600"),
            PaneProtocol.Parse("{\"type\":\"done\",\"stop\":\"done\",\"text\":\"\\udc00\\ud800x\\ud83d\\ude00\"}"));
        Assert.Equal(new ServerMessage.ServerError("bad \uFFFD"), PaneProtocol.Parse("{\"type\":\"error\",\"message\":\"bad \\udfff\"}"));
        Assert.Equal(new ServerMessage.Started("r-\uFFFD"), PaneProtocol.Parse("{\"type\":\"started\",\"run\":\"r-\\ud800\"}"));
        Assert.Equal(new ServerMessage.Requesting(1, "m\uFFFD"), PaneProtocol.Parse("{\"type\":\"requesting\",\"turn\":1,\"route\":\"m\\ud800\"}"));
        Assert.Equal(new ServerMessage.Ended("r", "engine \uFFFD"), PaneProtocol.Parse("{\"type\":\"ended\",\"run\":\"r\",\"error\":\"engine \\ud800\"}"));
        var ready = Assert.IsType<ServerMessage.Ready>(PaneProtocol.Parse("{\"type\":\"ready\",\"routes\":[\"a\\ud800\"],\"maxUserChars\":8000}"));
        Assert.Equal(["a\uFFFD"], ready.Routes);

        var turn = Assert.IsType<ServerMessage.TurnEvent>(PaneProtocol.Parse(
            "{\"type\":\"turn\",\"turn\":1,\"status\":200,\"servedBy\":\"h\\ud800\",\"fallbacks\":0,\"costUsd\":0,\"offPrimary\":false," +
            "\"reason\":\"r\\ud800\",\"content\":\"c\\ud800\",\"calls\":[{\"name\":\"minivac_control\"," +
            "\"args\":\"{\\\"args\\\":\\\"pane.json connect \\\\ud83d/1A\\\"}\",\"output\":\"error: unknown terminal \\\"\\ud83d\\\"\"}]}"));
        Assert.Equal(("h\uFFFD", "r\uFFFD", "c\uFFFD"), (turn.ServedBy, turn.Reason, turn.Content));
        Assert.Equal(new ServerMessage.TurnCall("minivac_control", "{\"args\":\"pane.json connect \\ud83d/1A\"}", "error: unknown terminal \"\uFFFD\""),
            Assert.Single(turn.Calls));
    }

    [Theory]
    [InlineData("{\"type\":\"done\",\"stop\":\"done\"}", "done", "")]
    [InlineData("{\"type\":\"done\",\"text\":\"x\"}", "undefined", "x")]
    [InlineData("{\"type\":\"done\",\"stop\":5,\"text\":7}", "5", "7")]
    [InlineData("{\"type\":\"done\",\"stop\":null,\"text\":null}", "null", "null")]
    [InlineData("{\"type\":\"done\",\"stop\":\"done\",\"text\":\"\\ud800\"}", "done", "\uFFFD")]
    [InlineData("{\"type\":\"done\",\"\\udc00\":1,\"stop\":\"done\",\"text\":\"t\"}", "done", "t")]
    public void A_done_frame_is_always_read_however_malformed_the_rest(string frame, string stop, string text) =>
        Assert.Equal(new ServerMessage.Done(stop, text), PaneProtocol.Parse(frame));

    [Theory]
    [InlineData("{\"type\":\"ended\"}", null, null)]
    [InlineData("{\"type\":\"ended\",\"run\":5}", null, null)]
    [InlineData("{\"type\":\"ended\",\"run\":null,\"error\":null}", null, "null")]
    [InlineData("{\"type\":\"ended\",\"run\":\"r\",\"error\":3}", "r", "3")]
    public void An_ended_frame_is_always_read_however_malformed_the_rest(string frame, string? run, string? failure) =>
        Assert.Equal(new ServerMessage.Ended(run, failure), PaneProtocol.Parse(frame));

    [Fact]
    public void Fields_the_page_does_not_need_may_be_missing_or_of_another_type()
    {
        // No status, no offPrimary, fallbacks a string: the page reads none of them as it would a number it needs.
        Assert.Equal(new ServerMessage.ServedEvent(1, 0, "?", 0, 0, false),
            PaneProtocol.Parse("{\"type\":\"served\",\"turn\":1,\"servedBy\":\"?\",\"fallbacks\":\"2\",\"costUsd\":0}"));
        Assert.Equal(new ServerMessage.ServedEvent(1, 0, "undefined", 0, 0, true),
            PaneProtocol.Parse("{\"type\":\"served\",\"turn\":1,\"costUsd\":0,\"offPrimary\":true}"));
        var turn = Assert.IsType<ServerMessage.TurnEvent>(PaneProtocol.Parse(
            "{\"type\":\"turn\",\"turn\":2,\"costUsd\":0,\"content\":null,\"stop\":5,\"reason\":false,\"calls\":[{\"name\":\"x\"},{\"args\":\"{}\",\"output\":3}]}"));
        Assert.Equal(("5", "false"), (turn.Stop, turn.Reason));
        Assert.Equal([new ServerMessage.TurnCall("x", "undefined", ""), new ServerMessage.TurnCall("undefined", "{}", "3")], turn.Calls);
        Assert.Equal(new ServerMessage.ServerError(""), PaneProtocol.Parse("{\"type\":\"error\"}"));
    }

    // ---------------------------------------------------------------- helpers

    private static int Constant(string source, string name)
    {
        var match = Regex.Match(source, @"export const " + name + @" = (\d+);");
        Assert.True(match.Success, name + " not found in the TypeScript source");
        return int.Parse(match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
    }

    private static string Reason(string source, string name)
    {
        var match = Regex.Match(source, @"\[" + name + @"\]: '([^']*)'");
        Assert.True(match.Success, name + " reason not found in src/pane/ui.ts");
        return match.Groups[1].Value;
    }

    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (directory.GetFiles("package.json", SearchOption.TopDirectoryOnly).Length == 1 &&
                directory.GetDirectories("data", SearchOption.TopDirectoryOnly).Length == 1 &&
                directory.GetDirectories("dotnet", SearchOption.TopDirectoryOnly).Length == 1)
                return directory.FullName;
        }

        throw new InvalidOperationException("repository root not found");
    }
}
