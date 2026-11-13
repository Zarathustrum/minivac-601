using System;
using System.Collections.Generic;
using System.Text.Json;
using Minivac.Core;

namespace Minivac.Hands;

/// <summary>
/// The engine's answers (engine.ts:21-38, protocol.ts:36 `PaneReplies`): `"created"`,
/// `"exists"`, `"missing"`, an `EngineError`, an accepted batch with the state after it, a
/// refused batch, a state view, or the live session's log.
/// </summary>
public abstract class PaneReply
{
    private protected PaneReply() { }

    public sealed class Word : PaneReply
    {
        public Word(string value) => this.value = value;
        public string value { get; }
    }

    public sealed class Error : PaneReply
    {
        public Error(string error) => this.error = error;
        public string error { get; }
    }

    public sealed class Ran : PaneReply
    {
        public Ran(BatchOutcome.Accepted outcome, StateView view)
        {
            this.outcome = outcome;
            this.view = view;
        }

        public BatchOutcome.Accepted outcome { get; }
        public StateView view { get; }
    }

    public sealed class Refused : PaneReply
    {
        public Refused(BatchRejection rejection) => this.rejection = rejection;
        public BatchRejection rejection { get; }
    }

    public sealed class View : PaneReply
    {
        public View(StateView view) => this.view = view;
        public StateView view { get; }
    }

    /// <summary>`{ ...base, script }`: the session `create` was given, with the live log as its script.</summary>
    public sealed class SessionLog : PaneReply
    {
        public SessionLog(JsonElement @base, IReadOnlyList<SessionStep> script)
        {
            this.@base = @base;
            this.script = script;
        }

        public JsonElement @base { get; }
        public IReadOnlyList<SessionStep> script { get; }
    }

    public static readonly PaneReply Created = new Word("created");
    public static readonly PaneReply Exists = new Word("exists");
    public static readonly PaneReply Missing = new Word("missing");
}

/// <summary>
/// The C# port of `src/pane/engine.ts`: the one live machine the model operates, answering in
/// data. A batch is validated before it runs, so a refused batch leaves the live rig untouched.
/// Engine-free and filesystem-free: it takes the netlist and profiles as arguments.
/// </summary>
public sealed class PaneEngine
{
    private readonly LoadedNetlist _netlist;
    private readonly IReadOnlyList<Profile> _profiles;
    private Rig? _rig;
    private JsonElement _base;

    public PaneEngine(LoadedNetlist netlist, IReadOnlyList<Profile> profiles)
    {
        _netlist = netlist;
        _profiles = profiles;
    }

    /// <summary>engine.ts:55 `message(problem)`.</summary>
    private static string Message(Exception problem) => problem.Message;

    /// <summary>A broken invariant: drop the rig rather than keep driving a machine no log describes.</summary>
    private PaneReply.Error End(string why)
    {
        _rig = null;
        return new PaneReply.Error(why + "; the pane session has ended (start a new one)");
    }

    /// <summary>engine.ts:69: replay `session` into the live rig, unless one is live.</summary>
    public PaneReply Create(JsonElement? session)
    {
        if (_rig is not null) return PaneReply.Exists;
        var wanted = Js.Prop(session, "profile");
        Profile? profile = null;
        foreach (var candidate in _profiles)
        {
            if (Js.StrictEquals(wanted, candidate.id))
            {
                profile = candidate;
                break;
            }
        }
        if (profile is null)
        {
            var ids = new List<string>();
            foreach (var candidate in _profiles) ids.Add(candidate.id);
            return new PaneReply.Error("the page has no profile " + Js.Stringify(wanted) + " (it has " + string.Join(", ", ids) + ")");
        }
        try
        {
            // Replay checks the session's netlist and profile hashes against the page's own data.
            _rig = Table.replay(_netlist, profile, session!.Value);
            _base = session.Value.Clone();
        }
        catch (Exception problem)
        {
            return new PaneReply.Error("the page cannot start this session: " + Message(problem));
        }
        return PaneReply.Created;
    }

    /// <summary>engine.ts:85: validate `calls`, then apply them in order and settle once, capped at `settleMs`.</summary>
    public PaneReply Run(JsonElement? calls, JsonElement? settleMs)
    {
        if (_rig is null) return PaneReply.Missing;
        var rig = _rig;
        IReadOnlyList<ToolCall> list;
        BatchRejection? verdict;
        try
        {
            list = Calls(calls);
            verdict = Table.validateBatch(rig, list, settleMs);
        }
        catch (Exception problem)
        {
            // validateBatch never touches the rig, so the session stands.
            return new PaneReply.Error("the page could not check this batch: " + Message(problem));
        }
        if (verdict is not null) return new PaneReply.Refused(verdict);
        BatchOutcome outcome;
        try
        {
            outcome = Table.runBatch(rig, list, settleMs);
        }
        catch (Exception problem)
        {
            return End("the page machine failed a validated batch: " + Message(problem));
        }
        if (outcome is BatchRejection rejection)
        {
            var step = rejection.failedAt < list.Count ? "command " + (rejection.failedAt + 1).ToString(System.Globalization.CultureInfo.InvariantCulture) : "the settle step";
            return End("the page machine refused " + step + " of a validated batch (" + rejection.result.why + ": " + rejection.result.detail + ")");
        }
        return new PaneReply.Ran((BatchOutcome.Accepted)outcome, Table.stateView(rig));
    }

    /// <summary>Typed callers: the calls as a list.</summary>
    public PaneReply Run(IReadOnlyList<ToolCall> calls, int settleMs)
    {
        var output = new JsonOut();
        output.BeginArray();
        foreach (var call in calls)
        {
            if (call.Raw is { } raw) output.Element(raw);
            else output.Null();
        }
        output.EndArray();
        return Run(Js.Parse(output.Text), Js.Number(settleMs));
    }

    private static IReadOnlyList<ToolCall> Calls(JsonElement? calls)
    {
        var list = new List<ToolCall>();
        foreach (var call in Js.ArrayLike(calls)) list.Add(new ToolCall(call));
        return list;
    }

    public PaneReply State() => _rig is null ? PaneReply.Missing : new PaneReply.View(Table.stateView(_rig));

    /// <summary>The live session's `minivac.session/1` log, for export.</summary>
    public PaneReply Session() => _rig is null ? PaneReply.Missing : new PaneReply.SessionLog(_base, _rig.log.ToArray());

    /// <summary>The live rig's machine, for the host's view, or null with no live session.</summary>
    public Machine? Machine() => _rig?.machine;
}

/// <summary>
/// The JSON boundary: a `PaneRequest` (or the whole `request` frame; other keys are ignored) in, the
/// `PaneReply` JSON out, as the web page's `answer` (src/pane/ui.ts:185) produces it. Node parses
/// the reply and renders it with the CLI's renderer.
/// </summary>
public static class PaneJson
{
    /// <summary>
    /// ui.ts:185 `answer`: dispatch on `op`; an engine exception becomes
    /// `{ error: 'the page engine threw: ...' }`. An unknown `op` leaves the reply undefined there
    /// (the frame then carries no `reply`); here that is null. A request that is valid JSON but not
    /// an object answers as `answer` does: `null` throws reading `op`, anything else has no `op`.
    /// Never throws: text that does not parse (not JSON, or nested past System.Text.Json's 64
    /// levels, which `JSON.parse` would accept) answers `{ error: 'the page engine threw: ...' }`
    /// with the parser's message and leaves the engine untouched. The server never sends either.
    /// </summary>
    public static string? Answer(PaneEngine engine, string requestJson)
    {
        JsonElement request;
        try
        {
            request = Js.Parse(requestJson);
        }
        catch (JsonException problem)
        {
            return Write(new PaneReply.Error("the page engine threw: " + problem.Message));
        }
        var reply = Dispatch(engine, request);
        return reply is null ? null : Write(reply);
    }

    public static PaneReply? Dispatch(PaneEngine engine, JsonElement request)
    {
        try
        {
            var op = Js.Prop(request, "op");
            if (Js.StrictEquals(op, "create")) return engine.Create(Js.Prop(request, "session"));
            if (Js.StrictEquals(op, "run")) return engine.Run(Js.Prop(request, "calls"), Js.Prop(request, "settleMs"));
            if (Js.StrictEquals(op, "state")) return engine.State();
            if (Js.StrictEquals(op, "session")) return engine.Session();
            return null;
        }
        catch (Exception problem)
        {
            return new PaneReply.Error("the page engine threw: " + problem.Message);
        }
    }

    public static string Write(PaneReply reply)
    {
        var output = new JsonOut();
        switch (reply)
        {
            case PaneReply.Word word:
                output.String(word.value);
                break;
            case PaneReply.Error error:
                output.BeginObject().Key("error").String(error.error).EndObject();
                break;
            case PaneReply.Ran ran:
                HandsJson.Outcome(output, ran.outcome, ran.view);
                break;
            case PaneReply.Refused refused:
                HandsJson.Outcome(output, refused.rejection);
                break;
            case PaneReply.View view:
                HandsJson.View(output, view.view);
                break;
            case PaneReply.SessionLog log:
                output.Element(log.@base, "script", (into) => HandsJson.Script(into, log.script));
                break;
        }
        return output.Text;
    }
}
