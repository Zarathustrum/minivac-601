using System.Linq;
using System.Text.Json;
using Minivac.Core;
using Xunit;
using static Minivac.Hands.Tests.Support;

namespace Minivac.Hands.Tests;

// The JavaScript formatting the port must reproduce, with the values V8 prints for each (checked
// in Node 26: String(x) and JSON.stringify(s)), and the engine path test/pane/engine.spec.ts
// reaches by plugging a cord past the log, which the transfer test cannot reach over JSON.
public sealed class JsAndEngineTests
{
    [Theory]
    [InlineData(0.0, "0")]
    [InlineData(1.0, "1")]
    [InlineData(-1.5, "-1.5")]
    [InlineData(1.5, "1.5")]
    [InlineData(1e20, "100000000000000000000")]
    [InlineData(1e21, "1e+21")]
    [InlineData(1e22, "1e+22")]
    [InlineData(123456789012345680000.0, "123456789012345680000")]
    [InlineData(1.2345678901234568e21, "1.2345678901234568e+21")]
    [InlineData(0.000001, "0.000001")]
    [InlineData(1e-7, "1e-7")]
    [InlineData(1.5e-7, "1.5e-7")]
    [InlineData(123456789.125, "123456789.125")]
    [InlineData(0.1, "0.1")]
    [InlineData(5e-324, "5e-324")]
    [InlineData(1.7976931348623157e308, "1.7976931348623157e+308")]
    [InlineData(2147483647.0, "2147483647")]
    [InlineData(double.PositiveInfinity, "Infinity")]
    [InlineData(double.NaN, "NaN")]
    public void Numbers_print_as_JavaScript_prints_them(double value, string expected)
    {
        Assert.Equal(expected, Js.NumberToString(value));
        Assert.Equal("0", Js.NumberToString(-0.0));
    }

    [Theory]
    [InlineData("1+", "\"1+\"")]
    [InlineData("1−", "\"1−\"")]
    [InlineData("a\"b\\c", "\"a\\\"b\\\\c\"")]
    [InlineData("\t\n\r\b\f\u0001\u001f", "\"\\t\\n\\r\\b\\f\\u0001\\u001f\"")]
    [InlineData("\u2028<>&'é\u007f", "\"\u2028<>&'é\u007f\"")]
    [InlineData("\ud83d\ude00", "\"\ud83d\ude00\"")]
    public void Strings_quote_as_JSON_stringify_quotes_them(string text, string expected)
    {
        Assert.Equal(expected, Js.Quote(text));
    }

    // JSON.parse keeps an escaped lone surrogate as one UTF-16 unit, where System.Text.Json's
    // GetString and property names throw. Parsed, read and printed again, the text must come back
    // as JSON.stringify writes it (lowercase escapes), in keys and in values.
    [Fact]
    public void A_lone_surrogate_survives_parse_read_and_print()
    {
        var parsed = Js.Parse("{\"\\uD800k\":\"x\\udfff\",\"a\":[\"\\ud800\",\"\\ud83d\\ude00\"]}");
        var output = new JsonOut();
        output.Element(parsed);
        Assert.Equal("{\"\\ud800k\":\"x\\udfff\",\"a\":[\"\\ud800\",\"\ud83d\ude00\"]}", output.Text);
        Assert.Equal([new string([(char)0xd800, 'k']), "a"], Js.Names(parsed));
        Assert.Equal(new string(['x', (char)0xdfff]), Js.Text(parsed.EnumerateObject().First().Value));
        // Looking up a plain key walks past the surrogate key, whose name System.Text.Json cannot compare.
        Assert.True(Js.In(parsed, "a"));
        Assert.Equal(JsonValueKind.Array, Js.Prop(parsed, "a")!.Value.ValueKind);
    }

    // The replies Node 26 gives for the same requests (src/pane/engine.ts, JSON.stringify): a lone
    // surrogate from the model's words is a refusal, not an engine error that ends the run.
    [Theory]
    [InlineData("[{\"name\":\"connect\",\"args\":{\"a\":\"\\ud800\",\"b\":\"free\"}}]",
        "{\"ok\":false,\"failedAt\":0,\"result\":{\"ok\":false,\"why\":\"unknown_terminal\",\"detail\":\"\\\"\\\\ud800\\\" is not a terminal\"}}")]
    [InlineData("[{\"name\":\"disconnect\",\"args\":{\"a\":\"x\\udc00y\",\"b\":\"free\"}}]",
        "{\"ok\":false,\"failedAt\":0,\"result\":{\"ok\":false,\"why\":\"unknown_terminal\",\"detail\":\"\\\"x\\\\udc00y\\\" is not a terminal\"}}")]
    [InlineData("[{\"name\":\"power\",\"args\":{\"\\ud800\":1,\"on\":true}},{\"name\":\"loadProgram\",\"args\":{\"program\":\"\\ud800\",\"wires\":[\"1A/1B\"]}}]",
        "{\"ok\":false,\"failedAt\":1,\"result\":{\"ok\":false,\"why\":\"bad_program\",\"detail\":\"\\\"\\\\ud800\\\" is not a program id\"}}")]
    [InlineData("\"\\ud800\"", "{\"error\":\"the page could not check this batch: hands: no tool undefined\"}")]
    public void A_lone_surrogate_in_a_request_is_answered_as_the_page_answers_it(string calls, string expected)
    {
        var engine = new PaneEngine(Net, [RefA, Ideal]);
        var session = HandsJson.Session(Table.newSession(Net, RefA));
        Assert.Equal("\"created\"", PaneJson.Answer(engine, "{\"op\":\"create\",\"session\":{\"\\udc00x\":\"\\ud800\"," + session[1..] + "}"));
        Assert.Equal(expected, PaneJson.Answer(engine, "{\"type\":\"request\",\"id\":2,\"op\":\"run\",\"calls\":" + calls + ",\"settleMs\":500}"));
        Assert.StartsWith("{\"\\udc00x\":\"\\ud800\",\"schema\":", PaneJson.Answer(engine, "{\"op\":\"session\"}"));
    }

    [Fact]
    public void Parsed_objects_reprint_in_JavaScript_key_order()
    {
        var output = new JsonOut();
        output.Element(Js.Parse("{\"b\":1,\"10\":2,\"a\":[1.0,1e2,\"x\"],\"2\":3,\"b\":4,\"01\":5}"));
        Assert.Equal("{\"2\":3,\"10\":2,\"b\":4,\"a\":[1,100,\"x\"],\"01\":5}", output.Text);
    }

    // test/pane/engine.spec.ts 'a batch that fails after validation passed ends the session instead of rebuilding it'
    [Fact]
    public void A_batch_that_fails_after_validation_ends_the_session()
    {
        var engine = new PaneEngine(Net, [RefA, Ideal]);
        var session = Js.Parse(HandsJson.Session(Table.newSession(Net, RefA)));
        Assert.Same(PaneReply.Created, engine.Create(session));
        Assert.IsType<PaneReply.Ran>(engine.Run([Connect("1+/1A"), PowerOn], 500));
        // A cord plugged straight into the machine, outside the log: validation sees cord id 1
        // free, the live machine already has it.
        var machine = engine.Machine()!;
        Assert.True(machine.Apply(new Command.Connect(1, new CordEnd.Hole("6+#1"), new CordEnd.Hole("6-#1"))).ok);
        var reply = engine.Run([Call("power", "{\"on\":false}"), Connect("1B/1-")], 500);
        Assert.Equal("{\"error\":\"the page machine refused command 2 of a validated batch (cord_exists: connect 1B/1- rejected by the machine); " +
            "the pane session has ended (start a new one)\"}", PaneJson.Write(reply));
        Assert.Null(engine.Machine());
        Assert.Same(PaneReply.Missing, engine.State());
        Assert.Same(PaneReply.Missing, engine.Session());
        Assert.Same(PaneReply.Created, engine.Create(session));
        Assert.NotSame(machine, engine.Machine());
    }

    // PaneJson.Answer is the entry point the Godot poll loop calls: it never throws, and input
    // that is not a request leaves the live session as it was. A non-object request answers as
    // src/pane/ui.ts `answer` does (null throws reading `op`; the rest have no `op`, so no reply).
    [Theory]
    [InlineData("", true)]
    [InlineData("{", true)]
    [InlineData("{\"op\":\"state\"} x", true)]
    [InlineData("nope", true)]
    [InlineData("deep", true)]
    [InlineData("null", false)]
    [InlineData("5", false)]
    [InlineData("[]", false)]
    [InlineData("\"state\"", false)]
    [InlineData("{\"op\":\"State\"}", false)]
    public void Answer_never_throws_and_leaves_the_session_alone(string request, bool unparsed)
    {
        if (request == "deep") request = new string('[', 65) + new string(']', 65);
        var engine = new PaneEngine(Net, [RefA, Ideal]);
        Assert.Equal("\"created\"", PaneJson.Answer(engine, "{\"op\":\"create\",\"session\":" + HandsJson.Session(Table.newSession(Net, RefA)) + "}"));
        PaneJson.Answer(engine, "{\"op\":\"run\",\"calls\":[{\"name\":\"connect\",\"args\":{\"a\":\"1+\",\"b\":\"1A\"}},{\"name\":\"power\",\"args\":{\"on\":true}}],\"settleMs\":500}");
        var state = PaneJson.Answer(engine, "{\"op\":\"state\"}");
        var session = PaneJson.Answer(engine, "{\"op\":\"session\"}");

        var reply = PaneJson.Answer(engine, request);
        if (unparsed) Assert.StartsWith("{\"error\":\"the page engine threw: ", reply);
        else if (request == "null") Assert.Equal("{\"error\":\"the page engine threw: Cannot read properties of null (reading 'op')\"}", reply);
        else Assert.Null(reply);

        Assert.Equal(state, PaneJson.Answer(engine, "{\"op\":\"state\"}"));
        Assert.Equal(session, PaneJson.Answer(engine, "{\"op\":\"session\"}"));
    }
}
