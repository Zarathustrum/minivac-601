using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Minivac.Hands;

namespace Minivac.Godot;

/// <summary>
/// The chat pane's wire protocol, the C# of src/pane/protocol.ts: JSON text frames over one WebSocket
/// to the pane server (tools/hands-pane/server.ts). A test reads the constants out of the TypeScript
/// source and fails if these differ. The engine's request and reply bodies are not typed here: a
/// <c>request</c> goes up as its id, op and the frame's raw JSON, and a <c>reply</c> is spliced in as raw JSON.
/// </summary>
public static class PaneProtocol
{
    /// <summary><c>PANE_PROTOCOL</c>: a client from another build is refused at <c>hello</c>.</summary>
    public const int Version = 3;
    /// <summary><c>DEFAULT_PANE_PORT</c>: the server's port when the link names none.</summary>
    public const int DefaultPort = 8601;
    public const int CloseBadToken = 4001;
    public const int CloseBadProtocol = 4002;
    public const int CloseNoHello = 4003;
    /// <summary>The server's <c>maxPayload</c>; both socket buffers are this size [verified: C0 run 2026-11-11].</summary>
    public const int MaxFrameBytes = 4 * 1024 * 1024;

    /// <summary>The frame as the web page's <c>JSON.stringify</c> writes it: same keys, same order, same escapes.</summary>
    public static string Serialize(PageMessage message) => message switch
    {
        PageMessage.Hello hello => "{\"type\":\"hello\",\"protocol\":" + Version.ToString(CultureInfo.InvariantCulture) +
            ",\"token\":" + Quote(hello.Token) + "}",
        PageMessage.User user => "{\"type\":\"user\",\"text\":" + Quote(user.Text) + ",\"route\":" + Quote(user.Route) + "}",
        PageMessage.Stop => "{\"type\":\"stop\"}",
        PageMessage.End => "{\"type\":\"end\"}",
        PageMessage.Reply reply => "{\"type\":\"reply\",\"id\":" + reply.Id.ToString(CultureInfo.InvariantCulture) +
            ",\"reply\":" + reply.ReplyJson + "}",
        _ => throw new ArgumentOutOfRangeException(nameof(message)),
    };

    /// <summary>A JSON string literal escaped as ECMAScript's <c>JSON.stringify</c> escapes it.</summary>
    public static string Quote(string text)
    {
        var quoted = new StringBuilder(text.Length + 2).Append('"');
        for (var at = 0; at < text.Length; at++)
        {
            var c = text[at];
            switch (c)
            {
                case '"': quoted.Append("\\\""); break;
                case '\\': quoted.Append("\\\\"); break;
                case '\b': quoted.Append("\\b"); break;
                case '\f': quoted.Append("\\f"); break;
                case '\n': quoted.Append("\\n"); break;
                case '\r': quoted.Append("\\r"); break;
                case '\t': quoted.Append("\\t"); break;
                default:
                    var pair = char.IsHighSurrogate(c) && at + 1 < text.Length && char.IsLowSurrogate(text[at + 1]);
                    if (pair)
                    {
                        quoted.Append(c).Append(text[++at]);
                    }
                    else if (c < 0x20 || char.IsSurrogate(c))
                    {
                        quoted.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        quoted.Append(c);
                    }
                    break;
            }
        }
        return quoted.Append('"').ToString();
    }

    /// <summary>
    /// A server frame, checked field by field. Total: anything else is <see cref="ServerMessage.NotUnderstood"/>.
    /// It reads what the web page reads (src/pane/ui.ts, <c>onServer</c>): a field the page does not need may be
    /// missing or of another type, and a <c>done</c> or <c>ended</c> frame is always read, so the dock can never
    /// stay busy or ending on a frame it dropped. Every string is read for display: an unpaired surrogate, which
    /// the server's <c>JSON.stringify</c> writes as <c>\udXXX</c>, becomes U+FFFD.
    /// </summary>
    public static ServerMessage Parse(string text)
    {
        try
        {
            using var document = JsonDocument.Parse(text);
            var frame = document.RootElement;
            if (frame.ValueKind != JsonValueKind.Object) return new ServerMessage.NotUnderstood("not a JSON object");
            var type = Text(frame, "type");
            if (type is null) return new ServerMessage.NotUnderstood("no type");
            var message = type switch
            {
                "ready" => Strings(frame, "routes") is { } routes && Int(frame, "maxUserChars") is { } max
                    ? new ServerMessage.Ready(routes, max) : null,
                "started" => Text(frame, "run") is { } run ? new ServerMessage.Started(run) : null,
                "request" => Id(frame) is { } id && Text(frame, "op") is { } op ? new ServerMessage.Request(id, op, text) : null,
                "requesting" => Int(frame, "turn") is { } turn && Text(frame, "route") is { } route
                    ? new ServerMessage.Requesting(turn, route) : null,
                "served" => Served(frame),
                "turn" => Turn(frame),
                "done" => new ServerMessage.Done(Loose(frame, "stop") ?? "undefined", Loose(frame, "text") ?? ""),
                "ended" => new ServerMessage.Ended(Text(frame, "run"), Loose(frame, "error")),
                "error" => new ServerMessage.ServerError(Loose(frame, "message") ?? ""),
                _ => (ServerMessage?)new ServerMessage.NotUnderstood("unknown type " + Quote(type)),
            };
            return message ?? new ServerMessage.NotUnderstood("a " + type + " frame with a field missing or of the wrong type");
        }
        catch (JsonException)
        {
            return new ServerMessage.NotUnderstood("not JSON");
        }
        catch (InvalidOperationException)
        {
            // Not expected: every string and key is read leniently. Kept so Parse stays total.
            return new ServerMessage.NotUnderstood("text that is not valid UTF-16");
        }
    }

    // The page needs the turn (to match a reply) and the cost (it calls toFixed); servedBy, fallbacks, offPrimary
    // and status it only prints or tests for truth, so those default as the page would read them.
    private static ServerMessage.ServedEvent? Served(JsonElement frame) =>
        Int(frame, "turn") is { } turn && Number(frame, "costUsd") is { } cost
            ? new ServerMessage.ServedEvent(turn, Int(frame, "status") ?? 0, Loose(frame, "servedBy") ?? "undefined",
                Int(frame, "fallbacks") ?? 0, cost, Bool(frame, "offPrimary") ?? false)
            : null;

    // The page needs content as a string or null (it trims it) and calls as a list of objects (it reads their fields).
    private static ServerMessage.TurnEvent? Turn(JsonElement frame)
    {
        if (Served(frame) is not { } served) return null;
        if (!Field(frame, "content", out var content) ||
            content.ValueKind is not (JsonValueKind.String or JsonValueKind.Null)) return null;
        if (!Field(frame, "calls", out var callList) || callList.ValueKind != JsonValueKind.Array) return null;
        var calls = new List<ServerMessage.TurnCall>();
        foreach (var call in callList.EnumerateArray())
        {
            if (call.ValueKind != JsonValueKind.Object) return null;
            calls.Add(new ServerMessage.TurnCall(Loose(call, "name") ?? "undefined", Loose(call, "args") ?? "undefined", Loose(call, "output") ?? ""));
        }
        return new ServerMessage.TurnEvent(served.Turn, served.Status, served.ServedBy, served.Fallbacks, served.CostUsd,
            served.OffPrimary, Loose(frame, "stop"), Loose(frame, "reason"),
            content.ValueKind == JsonValueKind.Null ? null : Text(content), calls);
    }

    /// <summary>
    /// A field the page prints whatever it holds: null when absent, a string as read, anything else as its JSON
    /// text (what the page's string conversion shows for a number, a boolean or null).
    /// </summary>
    private static string? Loose(JsonElement frame, string name) =>
        !Field(frame, name, out var field) ? null
        : field.ValueKind == JsonValueKind.String ? Text(field)
        : field.GetRawText();

    /// <summary>A field as JSON.parse reads it (Js.Prop): the last of a repeated key, and any key, however escaped.</summary>
    private static bool Field(JsonElement frame, string name, out JsonElement field)
    {
        field = Js.Prop(frame, name) ?? default;
        return field.ValueKind != JsonValueKind.Undefined;
    }

    private static string? Text(JsonElement frame, string name) =>
        Field(frame, name, out var field) && field.ValueKind == JsonValueKind.String ? Text(field) : null;

    /// <summary>
    /// A JSON string for display. System.Text.Json refuses to unescape an unpaired surrogate; the raw text is read
    /// instead (Js.Text, as JSON.parse reads it) and each unpaired surrogate becomes U+FFFD.
    /// </summary>
    public static string Text(JsonElement value)
    {
        var text = Js.Text(value);
        StringBuilder? repaired = null;
        for (var at = 0; at < text.Length; at++)
        {
            var c = text[at];
            if (char.IsHighSurrogate(c) && at + 1 < text.Length && char.IsLowSurrogate(text[at + 1]))
            {
                repaired?.Append(c).Append(text[at + 1]);
                at++;
                continue;
            }
            if (char.IsSurrogate(c))
            {
                repaired ??= new StringBuilder(text, 0, at, text.Length);
                repaired.Append('�');
                continue;
            }
            repaired?.Append(c);
        }
        return repaired?.ToString() ?? text;
    }

    private static int? Int(JsonElement frame, string name) =>
        Field(frame, name, out var field) && field.ValueKind == JsonValueKind.Number && field.TryGetInt32(out var value)
            ? value : null;

    private static double? Number(JsonElement frame, string name) =>
        Field(frame, name, out var field) && field.ValueKind == JsonValueKind.Number && field.TryGetDouble(out var value)
            ? value : null;

    private static bool? Bool(JsonElement frame, string name) =>
        Field(frame, name, out var field) && field.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? field.GetBoolean() : null;

    /// <summary>The request id: a safe integer, as the server checks a reply's (Number.isSafeInteger).</summary>
    private static long? Id(JsonElement frame) =>
        Field(frame, "id", out var field) && field.ValueKind == JsonValueKind.Number &&
        field.TryGetInt64(out var value) && value is >= -9_007_199_254_740_991L and <= 9_007_199_254_740_991L
            ? value : null;

    private static IReadOnlyList<string>? Strings(JsonElement frame, string name)
    {
        if (!Field(frame, name, out var field) || field.ValueKind != JsonValueKind.Array) return null;
        var values = new List<string>();
        foreach (var item in field.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String) return null;
            values.Add(Text(item));
        }
        return values;
    }
}

/// <summary>Client to server: <c>PageMessage</c> in src/pane/protocol.ts.</summary>
public abstract record PageMessage
{
    /// <summary>The first frame; the protocol is always <see cref="PaneProtocol.Version"/>.</summary>
    public sealed record Hello(string Token) : PageMessage
    {
        public override string ToString() => "Hello { }";
    }

    public sealed record User(string Text, string Route) : PageMessage;

    public sealed record Stop : PageMessage;

    public sealed record End : PageMessage;

    /// <summary>The engine's answer to request <paramref name="Id"/>, as JSON text spliced in unchanged.</summary>
    public sealed record Reply(long Id, string ReplyJson) : PageMessage;
}

/// <summary>Server to client: <c>ServerMessage</c> in src/pane/protocol.ts, plus a frame this build cannot read.</summary>
public abstract record ServerMessage
{
    public sealed record Ready(IReadOnlyList<string> Routes, int MaxUserChars) : ServerMessage;

    public sealed record Started(string Run) : ServerMessage;

    /// <summary>A request for the engine; <paramref name="FrameJson"/> is the whole frame's text, for the engine's own reader.</summary>
    public sealed record Request(long Id, string Op, string FrameJson) : ServerMessage;

    public sealed record Requesting(int Turn, string Route) : ServerMessage;

    public sealed record ServedEvent(int Turn, int Status, string ServedBy, int Fallbacks, double CostUsd, bool OffPrimary)
        : ServerMessage;

    public sealed record TurnCall(string Name, string Args, string Output);

    public sealed record TurnEvent(
        int Turn, int Status, string ServedBy, int Fallbacks, double CostUsd, bool OffPrimary,
        string? Stop, string? Reason, string? Content, IReadOnlyList<TurnCall> Calls) : ServerMessage;

    public sealed record Done(string Stop, string Text) : ServerMessage;

    /// <summary>The session ended; <paramref name="Failure"/> is the frame's <c>error</c>, when the engine failed.</summary>
    public sealed record Ended(string? Run, string? Failure) : ServerMessage;

    /// <summary>The server's <c>error</c> frame: a client frame it could not take.</summary>
    public sealed record ServerError(string Message) : ServerMessage;

    /// <summary>A frame this build cannot read: not JSON, an unknown type, or a field missing or mistyped.</summary>
    public sealed record NotUnderstood(string Why) : ServerMessage;
}
