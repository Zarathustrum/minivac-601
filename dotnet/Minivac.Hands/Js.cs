using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Minivac.Hands;

/// <summary>
/// A JavaScript TypeError as V8 words it. The TypeScript table reads its arguments as plain JS
/// values, so a malformed request fails there with V8's own message, and that message reaches the
/// model inside an engine error. The port raises the same text where the read is the same.
/// </summary>
public sealed class JsTypeError : Exception
{
    public JsTypeError(string message) : base(message) { }
}

/// <summary>
/// The JavaScript value semantics `src/hands/table.ts` and `src/pane/engine.ts` rely on, over
/// parsed JSON. A JS value that came from `JSON.parse` is a <see cref="JsonElement"/>; `undefined`
/// (an absent property) is a null <c>JsonElement?</c>. Nothing here touches a file, a clock or
/// a culture.
/// </summary>
public static class Js
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    /// <summary>`obj.name`: the last occurrence wins, as in `JSON.parse`; undefined when absent.</summary>
    public static JsonElement? Prop(JsonElement? obj, string name)
    {
        if (obj is not { } value) throw new JsTypeError("Cannot read properties of undefined (reading '" + name + "')");
        if (value.ValueKind == JsonValueKind.Null) throw new JsTypeError("Cannot read properties of null (reading '" + name + "')");
        if (value.ValueKind != JsonValueKind.Object) return null;
        JsonElement? found = null;
        try
        {
            foreach (var property in value.EnumerateObject())
            {
                if (property.NameEquals(name)) found = property.Value;
            }
        }
        catch (InvalidOperationException)
        {
            // A key System.Text.Json cannot unescape (a lone surrogate): compare JSON.parse's keys.
            found = null;
            var names = Names(value);
            var i = 0;
            foreach (var property in value.EnumerateObject())
            {
                if (string.Equals(names[i++], name, StringComparison.Ordinal)) found = property.Value;
            }
        }
        return found;
    }

    /// <summary>`name in obj`. Only an object can be searched; arrays have no named keys here.</summary>
    public static bool In(JsonElement? obj, string name)
    {
        if (obj is { ValueKind: JsonValueKind.Object } value) return Names(value).Contains(name);
        if (obj is { ValueKind: JsonValueKind.Array }) return false;
        throw new JsTypeError("Cannot use 'in' operator to search for '" + name + "' in " + ToJsString(obj));
    }

    /// <summary>
    /// A JSON string's value as the UTF-16 units `JSON.parse` makes of it. An escaped lone
    /// surrogate (`"\ud800"`) is one unit there; System.Text.Json refuses to unescape it, so that
    /// string is decoded from its raw text instead. Every string read out of request JSON goes
    /// through here, and every key through <see cref="Names"/>.
    /// </summary>
    public static string Text(JsonElement value)
    {
        try
        {
            return value.GetString()!;
        }
        catch (InvalidOperationException) when (value.ValueKind == JsonValueKind.String)
        {
            var raw = value.GetRawText();
            return Unescape(raw.AsSpan(1, raw.Length - 2));
        }
    }

    /// <summary>An object's keys in order, duplicates included, as `JSON.parse` reads them; see <see cref="Text"/>.</summary>
    public static List<string> Names(JsonElement obj)
    {
        var names = new List<string>();
        try
        {
            foreach (var property in obj.EnumerateObject()) names.Add(property.Name);
            return names;
        }
        catch (InvalidOperationException)
        {
            names.Clear();
        }
        // Read the keys' raw, still escaped text and unescape it here.
        var reader = new Utf8JsonReader(Encoding.UTF8.GetBytes(obj.GetRawText()));
        reader.Read();
        while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
        {
            names.Add(Unescape(Encoding.UTF8.GetString(reader.ValueSpan)));
            reader.Skip();
        }
        return names;
    }

    /// <summary>The body of a JSON string literal (already validated by the parser), unescaped unit by unit.</summary>
    private static string Unescape(ReadOnlySpan<char> escaped)
    {
        var text = new StringBuilder(escaped.Length);
        for (var i = 0; i < escaped.Length; i++)
        {
            var c = escaped[i];
            if (c != '\\')
            {
                text.Append(c);
                continue;
            }
            c = escaped[++i];
            switch (c)
            {
                case 'b': text.Append('\b'); break;
                case 'f': text.Append('\f'); break;
                case 'n': text.Append('\n'); break;
                case 'r': text.Append('\r'); break;
                case 't': text.Append('\t'); break;
                case 'u':
                    text.Append((char)int.Parse(escaped.Slice(i + 1, 4), NumberStyles.AllowHexSpecifier, Invariant));
                    i += 4;
                    break;
                default: text.Append(c); break; // '"', '\\' and '/'
            }
        }
        return text.ToString(0, text.Length);
    }

    public static bool IsUndefined(JsonElement? value) => value is null;

    /// <summary>`value ?? fallback`: null and undefined take the fallback.</summary>
    public static bool IsNullish(JsonElement? value) => value is null || value.Value.ValueKind == JsonValueKind.Null;

    public static bool IsString(JsonElement? value) => value is { ValueKind: JsonValueKind.String };

    public static bool IsNumber(JsonElement? value) => value is { ValueKind: JsonValueKind.Number };

    public static bool IsBoolean(JsonElement? value) =>
        value is { ValueKind: JsonValueKind.True } or { ValueKind: JsonValueKind.False };

    public static bool IsTrue(JsonElement? value) => value is { ValueKind: JsonValueKind.True };

    /// <summary>`value === text` for a string literal.</summary>
    public static bool StrictEquals(JsonElement? value, string text) =>
        value is { ValueKind: JsonValueKind.String } element && string.Equals(Text(element), text, StringComparison.Ordinal);

    /// <summary>
    /// A JSON number as the double `JSON.parse` makes of it. An out-of-range literal (1e400)
    /// becomes an infinity there, so it does here (`TryGetDouble` refuses it).
    /// </summary>
    public static double Num(JsonElement value)
    {
        if (value.TryGetDouble(out var number)) return number;
        return double.Parse(value.GetRawText(), NumberStyles.Float, Invariant);
    }

    /// <summary>`Number.isInteger(value)`.</summary>
    public static bool IsInteger(JsonElement? value)
    {
        if (value is not { ValueKind: JsonValueKind.Number } element) return false;
        var number = Num(element);
        return double.IsFinite(number) && Math.Floor(number) == number;
    }

    /// <summary>`value.method(...)` on what must be a string, else V8's TypeError.</summary>
    public static string StringFor(JsonElement? value, string expression, string method)
    {
        if (value is null) throw new JsTypeError("Cannot read properties of undefined (reading '" + method + "')");
        if (value.Value.ValueKind == JsonValueKind.Null) throw new JsTypeError("Cannot read properties of null (reading '" + method + "')");
        if (value.Value.ValueKind != JsonValueKind.String) throw new JsTypeError(expression + "." + method + " is not a function");
        return Text(value.Value);
    }

    /// <summary>
    /// The elements of an array-like `x` as a `for (i = 0; i &lt; x.length; i++) x[i]` loop sees
    /// them: an array's elements, a string's UTF-16 units, nothing for a number or a boolean, and
    /// V8's TypeError for null or undefined. An object with a `length` property is outside what
    /// this port matches and throws.
    /// </summary>
    public static IReadOnlyList<JsonElement?> ArrayLike(JsonElement? value)
    {
        var items = new List<JsonElement?>();
        if (value is null || value.Value.ValueKind == JsonValueKind.Null) Prop(value, "length");
        var element = value!.Value;
        switch (element.ValueKind)
        {
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray()) items.Add(item);
                break;
            case JsonValueKind.String:
                foreach (var unit in Text(element)) items.Add(Parse(Quote(new string(unit, 1))));
                break;
            case JsonValueKind.Object:
                if (In(element, "length")) throw new NotSupportedException("hands: an array-like object with a length is not supported");
                break;
        }
        return items;
    }

    /// <summary>`String(value)`, as `'text' + value` converts it.</summary>
    public static string ToJsString(JsonElement? value)
    {
        if (value is not { } element) return "undefined";
        switch (element.ValueKind)
        {
            case JsonValueKind.Null: return "null";
            case JsonValueKind.True: return "true";
            case JsonValueKind.False: return "false";
            case JsonValueKind.Number: return NumberToString(Num(element));
            case JsonValueKind.String: return Text(element);
            case JsonValueKind.Array:
            {
                var text = new StringBuilder();
                var first = true;
                foreach (var item in element.EnumerateArray())
                {
                    if (!first) text.Append(',');
                    first = false;
                    if (item.ValueKind != JsonValueKind.Null) text.Append(ToJsString(item));
                }
                return text.ToString(0, text.Length);
            }
            default: return "[object Object]";
        }
    }

    /// <summary>`'text' + JSON.stringify(value)`: undefined stringifies to undefined, printed as such.</summary>
    public static string Stringify(JsonElement? value)
    {
        if (value is not { } element) return "undefined";
        var output = new JsonOut();
        output.Element(element);
        return output.Text;
    }

    /// <summary>`JSON.stringify(text)` for a string: the ES2019 well-formed escaping V8 uses.</summary>
    public static string Quote(string text)
    {
        var output = new StringBuilder(text.Length + 2);
        AppendQuoted(output, text);
        return output.ToString(0, output.Length);
    }

    internal static void AppendQuoted(StringBuilder output, string text)
    {
        output.Append('"');
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            switch (c)
            {
                case '"': output.Append("\\\""); break;
                case '\\': output.Append("\\\\"); break;
                case '\b': output.Append("\\b"); break;
                case '\f': output.Append("\\f"); break;
                case '\n': output.Append("\\n"); break;
                case '\r': output.Append("\\r"); break;
                case '\t': output.Append("\\t"); break;
                default:
                    if (c < 0x20)
                    {
                        AppendUnicodeEscape(output, c);
                    }
                    else if (char.IsHighSurrogate(c) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1]))
                    {
                        output.Append(c).Append(text[i + 1]);
                        i++;
                    }
                    else if (char.IsSurrogate(c))
                    {
                        AppendUnicodeEscape(output, c); // a lone surrogate: well-formed JSON.stringify
                    }
                    else
                    {
                        output.Append(c);
                    }
                    break;
            }
        }
        output.Append('"');
    }

    private static void AppendUnicodeEscape(StringBuilder output, char c) =>
        output.Append("\\u").Append(((int)c).ToString("x4", Invariant));

    /// <summary>
    /// `String(number)`: ECMAScript Number::toString(10). The digits are .NET's shortest
    /// round-trip digits ("R"), which are the same shortest digits V8 prints; the layout (plain up
    /// to 21 integer digits, `0.000001` down to 1e-6, else `1.5e+22`) is ECMA-262's.
    /// </summary>
    public static string NumberToString(double value)
    {
        if (double.IsNaN(value)) return "NaN";
        if (value == 0) return "0"; // both zeros print as 0
        if (double.IsPositiveInfinity(value)) return "Infinity";
        if (double.IsNegativeInfinity(value)) return "-Infinity";
        if (value < 0) return "-" + NumberToString(-value);

        var round = value.ToString("R", Invariant);
        var e = round.IndexOf('E', StringComparison.Ordinal);
        var mantissa = e < 0 ? round : round[..e];
        var exponent = e < 0 ? 0 : int.Parse(round[(e + 1)..], NumberStyles.AllowLeadingSign, Invariant);
        var point = mantissa.IndexOf('.', StringComparison.Ordinal);
        var integerDigits = point < 0 ? mantissa.Length : point;
        var raw = point < 0 ? mantissa : mantissa.Remove(point, 1);
        var leading = 0;
        while (leading < raw.Length - 1 && raw[leading] == '0') leading++;
        var digits = raw[leading..].TrimEnd('0');
        var k = digits.Length;
        var n = integerDigits + exponent - leading; // value = 0.digits * 10^n

        if (k <= n && n <= 21) return digits + new string('0', n - k);
        if (0 < n && n <= 21) return digits[..n] + "." + digits[n..];
        if (-6 < n && n <= 0) return "0." + new string('0', -n) + digits;
        var power = n - 1;
        var sign = power < 0 ? "-" : "+";
        var magnitude = Math.Abs(power).ToString(Invariant);
        return (k == 1 ? digits : digits[..1] + "." + digits[1..]) + "e" + sign + magnitude;
    }

    /// <summary>One JSON text as a free-standing element.</summary>
    public static JsonElement Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    /// <summary>A JS number as a JSON element (for typed callers of the JS-valued API).</summary>
    public static JsonElement Number(double value) => Parse(NumberToString(value));
}

/// <summary>
/// A JSON text writer that produces exactly what `JSON.stringify` produces for the same value:
/// keys in the order written, numbers as `String(number)`, strings escaped as V8 escapes them, no
/// whitespace. The pane's replies are parsed in Node and some are re-printed from that parse
/// (`state --json`, the session file), so key order is part of the contract.
/// </summary>
public sealed class JsonOut
{
    private readonly StringBuilder _text = new();
    private readonly Stack<bool> _first = new();

    public string Text => _text.ToString(0, _text.Length);

    public JsonOut BeginObject() => Open('{');

    public JsonOut EndObject() => Close('}');

    public JsonOut BeginArray() => Open('[');

    public JsonOut EndArray() => Close(']');

    public JsonOut Key(string name)
    {
        Separate();
        Js.AppendQuoted(_text, name);
        _text.Append(':');
        _pendingValue = true; // the value that follows takes no separator
        return this;
    }

    public JsonOut String(string value)
    {
        BeforeValue();
        Js.AppendQuoted(_text, value);
        return this;
    }

    public JsonOut Number(double value)
    {
        BeforeValue();
        _text.Append(double.IsFinite(value) ? Js.NumberToString(value) : "null");
        return this;
    }

    public JsonOut Bool(bool value)
    {
        BeforeValue();
        _text.Append(value ? "true" : "false");
        return this;
    }

    public JsonOut Null()
    {
        BeforeValue();
        _text.Append("null");
        return this;
    }

    /// <summary>
    /// `JSON.stringify(JSON.parse(raw))`: a duplicate key keeps its first position and its last
    /// value, and array-index keys ("0", "17") come first in ascending order, as a JS object
    /// orders its own keys. `replace`, when given, substitutes one top-level key's value (or
    /// appends the key), as `{ ...base, key: value }` does.
    /// </summary>
    public JsonOut Element(JsonElement value, string? replaceKey = null, Action<JsonOut>? replaceValue = null)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
            {
                var keys = Js.Names(value);
                var names = new List<string>();
                var values = new List<JsonElement>();
                var k = 0;
                foreach (var property in value.EnumerateObject())
                {
                    var name = keys[k++];
                    var at = names.IndexOf(name);
                    if (at >= 0)
                    {
                        values[at] = property.Value;
                    }
                    else
                    {
                        names.Add(name);
                        values.Add(property.Value);
                    }
                }
                var order = new List<int>();
                for (var i = 0; i < names.Count; i++)
                {
                    if (!IsArrayIndex(names[i])) continue;
                    var spot = 0;
                    while (spot < order.Count && IndexValue(names[order[spot]]) < IndexValue(names[i])) spot++;
                    order.Insert(spot, i);
                }
                for (var i = 0; i < names.Count; i++)
                {
                    if (!IsArrayIndex(names[i])) order.Add(i);
                }
                BeginObject();
                var replaced = false;
                foreach (var i in order)
                {
                    Key(names[i]);
                    if (replaceKey is not null && string.Equals(names[i], replaceKey, StringComparison.Ordinal))
                    {
                        replaceValue!(this);
                        replaced = true;
                    }
                    else
                    {
                        Element(values[i]);
                    }
                }
                if (replaceKey is not null && !replaced)
                {
                    Key(replaceKey);
                    replaceValue!(this);
                }
                return EndObject();
            }
            case JsonValueKind.Array:
                BeginArray();
                foreach (var item in value.EnumerateArray()) Element(item);
                return EndArray();
            case JsonValueKind.String: return String(Js.Text(value));
            case JsonValueKind.Number: return Number(Js.Num(value));
            case JsonValueKind.True: return Bool(true);
            case JsonValueKind.False: return Bool(false);
            default: return Null();
        }
    }

    private static bool IsArrayIndex(string name)
    {
        if (name.Length == 0 || name.Length > 10) return false;
        if (name.Length > 1 && name[0] == '0') return false;
        foreach (var c in name)
        {
            if (c < '0' || c > '9') return false;
        }
        return IndexValue(name) < 4294967295L;
    }

    private static long IndexValue(string name) => long.Parse(name, NumberStyles.None, CultureInfo.InvariantCulture);

    private bool _pendingValue;

    private JsonOut Open(char bracket)
    {
        BeforeValue();
        _text.Append(bracket);
        _first.Push(true);
        return this;
    }

    private JsonOut Close(char bracket)
    {
        _first.Pop();
        _text.Append(bracket);
        return this;
    }

    private void BeforeValue()
    {
        if (_pendingValue)
        {
            _pendingValue = false;
            return;
        }
        Separate();
    }

    private void Separate()
    {
        if (_first.Count == 0) return;
        if (_first.Peek())
        {
            _first.Pop();
            _first.Push(false);
        }
        else
        {
            _text.Append(',');
        }
    }
}
