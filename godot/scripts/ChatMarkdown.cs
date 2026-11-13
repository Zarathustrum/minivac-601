using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

namespace Minivac.Godot;

/// <summary>
/// The small markdown subset the dock renders in the model's reply text (Tom, 2026-11-12: the Godot dock
/// only; the web pane stays plain): <c>**bold**</c> and <c>__bold__</c>, <c>*italic*</c> and <c>_italic_</c>
/// (at word boundaries only), <c>`code`</c>, fenced code blocks, <c>#</c> headings as a bold line, <c>-</c> and
/// <c>*</c> bullets, links printed as <c>text (url)</c>, and backslash escapes. Everything else, and any marker
/// without its partner, stays as typed; only the markers of a construct that rendered are dropped.
/// The model's text is untrusted: every character it typed reaches the label through <see cref="Escape"/>,
/// so the only tags out are <c>b</c>, <c>i</c> and <c>code</c>, always balanced and properly nested.
/// Each line is converted in one left-to-right pass, linear in its length.
/// </summary>
public static class ChatMarkdown
{
    private const RegexOptions Options = RegexOptions.CultureInvariant;
    // A fence is a line of three backticks alone; the opening one may carry a language tag. Nothing else counts.
    private static readonly Regex OpeningFence = new(@"^[ \t]*```[^`\s]*[ \t]*\r?$", Options);
    private static readonly Regex ClosingFence = new(@"^[ \t]*```[ \t]*\r?$", Options);
    // A line of only *, -, _ and spaces (a rule, or nothing) stays as typed.
    private static readonly Regex Rule = new(@"^[ \t*_-]*\r?$", Options);
    private static readonly Regex Heading = new(@"^#{1,6}[ \t]+(\S.*)$", Options);
    private static readonly Regex Bullet = new(@"^([ \t]*)[-*][ \t]+(\S.*)$", Options);
    private const string Escapable = "\\`*_#[]";

    public static string ToBBCode(string text)
    {
        var lines = text.Split('\n');
        // For each line, the first closing fence at or after it, so pairing fences stays linear.
        var nextClose = new int[lines.Length + 1];
        nextClose[lines.Length] = -1;
        for (var at = lines.Length - 1; at >= 0; at--)
            nextClose[at] = ClosingFence.IsMatch(lines[at]) ? at : nextClose[at + 1];

        var output = new List<string>(lines.Length);
        for (var at = 0; at < lines.Length; at++)
        {
            var line = lines[at];
            var close = nextClose[at + 1];
            if (close >= 0 && OpeningFence.IsMatch(line))
            {
                output.Add("[code]" + Escape(string.Join("\n", lines[(at + 1)..close])) + "[/code]");
                at = close;
                continue;
            }
            if (Rule.IsMatch(line))
            {
                output.Add(line);
                continue;
            }
            var heading = Heading.Match(line);
            var bullet = Bullet.Match(line);
            output.Add(heading.Success ? "[b]" + Inline(heading.Groups[1].Value) + "[/b]"
                : bullet.Success ? bullet.Groups[1].Value + "• " + Inline(bullet.Groups[2].Value)
                : Inline(line));
        }
        return string.Join("\n", output);
    }

    // BBCode's own escape for an opening bracket: with none left, nothing the model typed can open a tag.
    private static string Escape(string text) => text.Replace("[", "[lb]", System.StringComparison.Ordinal);

    // A piece of one line: text as typed, a code span's content, or a run of * or _ that may open or close.
    private sealed class Piece(string text, bool code = false, char mark = '\0', bool opens = false, bool closes = false)
    {
        public string Text { get; } = text;
        public bool Code { get; } = code;
        public char Mark { get; } = mark;
        public bool Opens { get; } = opens;
        public bool Closes { get; } = closes;
        public string? Tag { get; set; } // set when the run rendered: its opening or closing tags
    }

    private static string Inline(string line)
    {
        var runs = BacktickRuns(line);
        var pieces = new List<Piece>();
        var plain = new StringBuilder();
        void Flush()
        {
            if (plain.Length == 0) return;
            pieces.Add(new Piece(plain.ToString()));
            plain.Clear();
        }

        for (var at = 0; at < line.Length;)
        {
            var c = line[at];
            if (c == '\\' && at + 1 < line.Length && Escapable.Contains(line[at + 1]))
            {
                plain.Append(line[at + 1]);
                at += 2;
            }
            else if (c == '`')
            {
                var length = Run(line, at, '`');
                var close = runs.Close(at, length);
                if (close < 0)
                {
                    plain.Append(line, at, length);
                    at += length;
                    continue;
                }
                Flush();
                pieces.Add(new Piece(line[(at + length)..close], code: true));
                at = close + length;
            }
            else if (c == '[' && (at == 0 || line[at - 1] != '!') && Link(line, at, out var label, out var url, out var end))
            {
                plain.Append(label).Append(" (").Append(url).Append(')');
                at = end;
            }
            else if (c is '*' or '_')
            {
                var length = Run(line, at, c);
                var before = at == 0 ? ' ' : line[at - 1];
                var after = at + length < line.Length ? line[at + length] : ' ';
                var opens = length <= 3 && !char.IsWhiteSpace(after) && !char.IsLetterOrDigit(before);
                var closes = length <= 3 && !char.IsWhiteSpace(before) && !char.IsLetterOrDigit(after);
                if (opens || closes)
                {
                    Flush();
                    pieces.Add(new Piece(line.Substring(at, length), mark: c, opens: opens, closes: closes));
                }
                else plain.Append(line, at, length);
                at += length;
            }
            else
            {
                plain.Append(c);
                at++;
            }
        }
        Flush();
        Pair(pieces);

        var output = new StringBuilder(line.Length + 16);
        foreach (var piece in pieces)
            output.Append(piece.Code ? "[code]" + Escape(piece.Text) + "[/code]" : piece.Tag ?? Escape(piece.Text));
        return output.ToString();
    }

    // A closing run pairs with the nearest open run of the same marker and length; open runs above that one
    // cannot pair any more without crossing it, so they stay as typed. Each run is pushed and popped once.
    private static void Pair(List<Piece> pieces)
    {
        var open = new List<Piece>();
        var waiting = new Dictionary<(char, int), int>();
        foreach (var piece in pieces)
        {
            if (piece.Mark == '\0') continue;
            var kind = (piece.Mark, piece.Text.Length);
            if (piece.Closes && waiting.GetValueOrDefault(kind) > 0)
            {
                Piece opener;
                do
                {
                    opener = open[^1];
                    open.RemoveAt(open.Count - 1);
                    waiting[(opener.Mark, opener.Text.Length)]--;
                } while (opener.Mark != piece.Mark || opener.Text.Length != piece.Text.Length);
                (opener.Tag, piece.Tag) = piece.Text.Length switch
                {
                    1 => ("[i]", "[/i]"),
                    2 => ("[b]", "[/b]"),
                    _ => ("[b][i]", "[/i][/b]"),
                };
            }
            else if (piece.Opens)
            {
                open.Add(piece);
                waiting[kind] = waiting.GetValueOrDefault(kind) + 1;
            }
        }
    }

    private static int Run(string line, int at, char c)
    {
        var end = at;
        while (end < line.Length && line[end] == c) end++;
        return end - at;
    }

    // [text](url): no brackets, backticks or line break in the text; no brackets, parentheses, backticks or
    // spaces in the url. Each scan stops at the next bracket, so all of them together stay linear.
    private static bool Link(string line, int at, out string label, out string url, out int end)
    {
        label = url = "";
        end = at;
        var close = at + 1;
        while (close < line.Length && line[close] is not ('[' or ']' or '`')) close++;
        if (close == at + 1 || close + 1 >= line.Length || line[close] != ']' || line[close + 1] != '(') return false;
        var stop = close + 2;
        while (stop < line.Length && line[stop] is not ('(' or ')' or '[' or ']' or '`') && !char.IsWhiteSpace(line[stop])) stop++;
        if (stop == close + 2 || stop >= line.Length || line[stop] != ')') return false;
        label = line[(at + 1)..close];
        url = line[(close + 2)..stop];
        end = stop + 1;
        return true;
    }

    // Every backtick run in the line (an escaped backtick starts none) and, per run length, where the next one
    // starts: a code span closes at the next run of exactly its own length.
    private sealed class BacktickRunIndex
    {
        private readonly Dictionary<int, List<int>> _starts = [];
        private readonly Dictionary<int, int> _cursor = [];

        public void Add(int start, int length)
        {
            if (!_starts.TryGetValue(length, out var list)) _starts[length] = list = [];
            list.Add(start);
        }

        /// <summary>The start of the first run of <paramref name="length"/> after the one at <paramref name="start"/>, or -1.</summary>
        public int Close(int start, int length)
        {
            var list = _starts[length];
            var cursor = _cursor.GetValueOrDefault(length);
            while (cursor < list.Count && list[cursor] <= start) cursor++;
            _cursor[length] = cursor;
            return cursor < list.Count ? list[cursor] : -1;
        }
    }

    private static BacktickRunIndex BacktickRuns(string line)
    {
        var runs = new BacktickRunIndex();
        for (var at = 0; at < line.Length;)
        {
            if (line[at] == '\\' && at + 1 < line.Length && Escapable.Contains(line[at + 1])) at += 2;
            else if (line[at] == '`')
            {
                var length = Run(line, at, '`');
                runs.Add(at, length);
                at += length;
            }
            else at++;
        }
        return runs;
    }
}
