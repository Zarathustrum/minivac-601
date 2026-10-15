using System;
using System.Collections.Generic;
using System.Text;

namespace Minivac.Godot.Tests;

internal sealed record LiteralSpan(int Offset, int Length, string Value);

internal static class LiteralExtractor
{
    internal static IReadOnlyList<LiteralSpan> Extract(string source)
    {
        ArgumentNullException.ThrowIfNull(source);
        var result = new List<LiteralSpan>();
        var index = 0;
        while (index < source.Length)
        {
            if (Starts(source, index, "//"))
            {
                index = SkipLine(source, index + 2);
                continue;
            }
            if (Starts(source, index, "/*"))
            {
                index = SkipBlock(source, index + 2);
                continue;
            }
            if (source[index] == '\'')
            {
                index = SkipQuoted(source, index + 1, '\'');
                continue;
            }

            var prefix = StringPrefixLength(source, index, out var verbatim, out var interpolated);
            if (prefix == 0)
            {
                index++;
                continue;
            }
            var start = index;
            index += prefix;
            var value = new StringBuilder();
            while (index < source.Length)
            {
                var ch = source[index++];
                if (ch == '"')
                {
                    if (verbatim && index < source.Length && source[index] == '"')
                    {
                        value.Append('"');
                        index++;
                        continue;
                    }
                    break;
                }
                if (!verbatim && ch == '\\' && index < source.Length)
                {
                    AppendEscape(value, source[index++]);
                    continue;
                }
                if (interpolated && ch == '{')
                {
                    if (index < source.Length && source[index] == '{')
                    {
                        value.Append('{');
                        index++;
                        continue;
                    }
                    index = SkipInterpolation(source, index);
                    continue;
                }
                if (interpolated && ch == '}' && index < source.Length && source[index] == '}')
                {
                    value.Append('}');
                    index++;
                    continue;
                }
                value.Append(ch);
            }
            result.Add(new LiteralSpan(start, index - start, value.ToString()));
        }
        return result.AsReadOnly();
    }

    private static int StringPrefixLength(string source, int index, out bool verbatim, out bool interpolated)
    {
        verbatim = false;
        interpolated = false;
        if (Starts(source, index, "$@\"") || Starts(source, index, "@$\""))
        {
            verbatim = true;
            interpolated = true;
            return 3;
        }
        if (Starts(source, index, "@\""))
        {
            verbatim = true;
            return 2;
        }
        if (Starts(source, index, "$\""))
        {
            interpolated = true;
            return 2;
        }
        return source[index] == '"' ? 1 : 0;
    }

    private static int SkipLine(string source, int index)
    {
        while (index < source.Length && source[index] != '\n') index++;
        return index;
    }

    private static int SkipBlock(string source, int index)
    {
        while (index + 1 < source.Length && !Starts(source, index, "*/")) index++;
        return Math.Min(source.Length, index + 2);
    }

    private static int SkipQuoted(string source, int index, char quote)
    {
        while (index < source.Length)
        {
            if (source[index] == '\\') index += Math.Min(2, source.Length - index);
            else if (source[index++] == quote) break;
        }
        return index;
    }

    private static int SkipInterpolation(string source, int index)
    {
        var depth = 1;
        while (index < source.Length && depth > 0)
        {
            if (Starts(source, index, "//")) index = SkipLine(source, index + 2);
            else if (Starts(source, index, "/*")) index = SkipBlock(source, index + 2);
            else if (source[index] == '"') index = SkipQuoted(source, index + 1, '"');
            else if (source[index] == '\'') index = SkipQuoted(source, index + 1, '\'');
            else
            {
                if (source[index] == '{') depth++;
                else if (source[index] == '}') depth--;
                index++;
            }
        }
        return index;
    }

    private static void AppendEscape(StringBuilder value, char escaped)
    {
        value.Append(escaped switch
        {
            'n' => '\n',
            'r' => '\r',
            't' => '\t',
            '0' => '\0',
            '\\' => '\\',
            '\'' => '\'',
            '"' => '"',
            _ => escaped,
        });
    }

    private static bool Starts(string source, int index, string value) =>
        index + value.Length <= source.Length &&
        source.AsSpan(index, value.Length).SequenceEqual(value.AsSpan());
}
