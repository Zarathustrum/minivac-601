using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Xunit;
using Xunit.Abstractions;

namespace Minivac.Godot.Tests;

// The small markdown subset the Godot dock renders in the model's reply text (Tom, 2026-11-12: Godot only).
// The model's text is untrusted: nothing it types may become a BBCode tag.
public sealed class ChatMarkdownTests(ITestOutputHelper output)
{
    // The final reply of run 2026-11-12-pane-1 ("wire up tic-tac-toe"), copied from its run.json.
    private const string RealReply =
        "\n\nTic-Tac-Toe (Book VI, printed pp. 55–56, program `VI-TICTACTOE`) is fully wired and powered on.\n\n" +
        "**What I did:**\n" +
        "- Consulted the manuals: found the Tic-Tac-Toe reference table in `docs/research/programs.md` §1 and its fixture " +
        "`test/conformance/fixtures/C2/VI-TICTACTOE.fixture.json`, and used its corrected wire list (errata applied — including " +
        "keeping the printed `4G/5N`, which is correct as printed and must not be \"fixed\").\n" +
        "- Plugged all 72 cords myself with `connect` in one batch:\n" +
        "  - The 70 jack-to-jack wires of the printed table (relay chains, dial contacts D1–D9, motor block `2L/D18`, `2N/D19`, " +
        "`M-/D17`, wiper `2E/D16`, matrix top/bottom contacts for squares 1–8, `M9b/M11`, `6com/D9`, etc.).\n" +
        "  - The two footnoted free-ended \"play\" wires: cord 70 on `M10` (machine's play wire) and cord 71 on `M11` " +
        "(player's play wire), each left free exactly as printed.\n" +
        "- Switched power on.\n\n" +
        "**Verification:** `state` shows all 72 cords exactly where the table specifies, `power on`, `breaker ok` (no + to – short " +
        "anywhere), and the machine rests cleanly — all relays released, all lamps off, dial at c0. It's ready to play: per the " +
        "printed procedure, the machine's free play wire end would go in `6com`, then hold pushbutton 6 while pressing pushbutton 1 " +
        "for the machine's opening move to the centre (matrix square 9).";

    private static readonly Regex AnyTag = new(@"\[[^\]]*\]", RegexOptions.CultureInvariant);
    private static readonly string[] OwnTags = ["[lb]", "[b]", "[/b]", "[i]", "[/i]", "[code]", "[/code]"];

    /// <summary>Every bracket in the output opens one of the converter's own tags or the escape.</summary>
    private static void OnlyOwnTags(string bbcode)
    {
        for (var at = bbcode.IndexOf('['); at >= 0; at = bbcode.IndexOf('[', at + 1))
            Assert.True(OwnTags.Any(tag => string.CompareOrdinal(bbcode, at, tag, 0, tag.Length) == 0),
                "stray tag at " + at + ": " + bbcode[at..Math.Min(bbcode.Length, at + 24)]);
    }

    [Theory]
    [InlineData("**bold**", "[b]bold[/b]")]
    [InlineData("__bold__", "[b]bold[/b]")]
    [InlineData("a **two words** b", "a [b]two words[/b] b")]
    [InlineData("*italic*", "[i]italic[/i]")]
    [InlineData("_italic_", "[i]italic[/i]")]
    [InlineData("**bold** and *italic*", "[b]bold[/b] and [i]italic[/i]")]
    [InlineData("`code`", "[code]code[/code]")]
    [InlineData("`**not bold** _nor this_`", "[code]**not bold** _nor this_[/code]")]
    [InlineData("# Heading", "[b]Heading[/b]")]
    [InlineData("###### Six **deep**", "[b]Six [b]deep[/b][/b]")]
    [InlineData("- item", "• item")]
    [InlineData("* item", "• item")]
    [InlineData("  - nested *item*", "  • nested [i]item[/i]")]
    [InlineData("**Verification:** cut here **Verif…", "[b]Verification:[/b] cut here **Verif…")]
    [InlineData("see [the manual](https://example.org/a_b)", "see the manual (https://example.org/a_b)")]
    public void Each_construct_converts(string markdown, string bbcode) =>
        Assert.Equal(bbcode, ChatMarkdown.ToBBCode(markdown));

    [Theory]
    [InlineData("snake_case_name")]
    [InlineData("a_b and c_d_e")]
    [InlineData("2 * 3 * 4")]
    [InlineData("**unclosed bold")]
    [InlineData("__unclosed")]
    [InlineData("*unclosed")]
    [InlineData("`unclosed code")]
    [InlineData("1. numbered stays\n2. as typed")]
    [InlineData("| a | b |\n|---|---|\n| 1 | 2 |")]
    [InlineData("<b>html</b> & <img src=x>")]
    [InlineData("---")]
    [InlineData("#nospace")]
    public void Unmatched_markers_and_unsupported_constructs_stay_as_typed(string markdown) =>
        Assert.Equal(markdown, ChatMarkdown.ToBBCode(markdown));

    [Fact]
    public void An_image_stays_as_typed_with_its_bracket_escaped() =>
        Assert.Equal("![lb]alt](pic.png)", ChatMarkdown.ToBBCode("![alt](pic.png)"));

    [Theory]
    [InlineData("[b]bold[/b]", "[lb]b]bold[lb]/b]")]
    [InlineData("[url=https://evil.example]click[/url]", "[lb]url=https://evil.example]click[lb]/url]")]
    [InlineData("[url]https://evil.example[/url]", "[lb]url]https://evil.example[lb]/url]")]
    [InlineData("[img]res://icon.svg[/img]", "[lb]img]res://icon.svg[lb]/img]")]
    [InlineData("[font=res://x.ttf]x[/font]", "[lb]font=res://x.ttf]x[lb]/font]")]
    [InlineData("[color=red]x[/color]", "[lb]color=red]x[lb]/color]")]
    [InlineData("[lb]", "[lb]lb]")]
    [InlineData("**[url]x[/url]**", "[b][lb]url]x[lb]/url][/b]")]
    [InlineData("`[img]x[/img]`", "[code][lb]img]x[lb]/img][/code]")]
    [InlineData("[[url]](x)", "[lb][lb]url]](x)")]
    public void Bbcode_the_model_types_comes_out_inert(string markdown, string bbcode)
    {
        var converted = ChatMarkdown.ToBBCode(markdown);
        Assert.Equal(bbcode, converted);
        OnlyOwnTags(converted);
    }

    [Fact]
    public void A_link_is_text_and_its_address_never_a_url_tag()
    {
        var converted = ChatMarkdown.ToBBCode("[click me](javascript:alert(1)) and [x](https://example.org)");
        Assert.DoesNotContain("[url", converted, StringComparison.Ordinal);
        Assert.Contains("x (https://example.org)", converted, StringComparison.Ordinal);
        OnlyOwnTags(converted);
    }

    [Fact]
    public void A_fence_shows_its_lines_as_code_with_no_conversion_inside()
    {
        var converted = ChatMarkdown.ToBBCode("before\n```json\n**not bold** [b]x[/b]\n- not a bullet\n```\nafter **b**");
        Assert.Equal("before\n[code]**not bold** [lb]b]x[lb]/b]\n- not a bullet[/code]\nafter [b]b[/b]", converted);
        OnlyOwnTags(converted);
    }

    [Fact]
    public void A_fence_cut_off_before_it_closes_stays_as_typed()
    {
        var converted = ChatMarkdown.ToBBCode("```\n**x**");
        Assert.Equal("```\n[b]x[/b]", converted);
    }

    [Fact]
    public void The_real_reply_of_run_2026_11_12_pane_1_renders()
    {
        var converted = ChatMarkdown.ToBBCode(RealReply);
        OnlyOwnTags(converted);
        Assert.DoesNotContain("**", converted, StringComparison.Ordinal);
        Assert.DoesNotContain("`", converted, StringComparison.Ordinal);
        Assert.StartsWith("\n\nTic-Tac-Toe (Book VI, printed pp. 55–56, program [code]VI-TICTACTOE[/code]) is fully wired", converted, StringComparison.Ordinal);
        Assert.Contains("\n[b]What I did:[/b]\n• Consulted the manuals:", converted, StringComparison.Ordinal);
        Assert.Contains("keeping the printed [code]4G/5N[/code], which", converted, StringComparison.Ordinal);
        Assert.Contains("\n  • The 70 jack-to-jack wires", converted, StringComparison.Ordinal);
        Assert.Contains("\n  • The two footnoted free-ended \"play\" wires: cord 70 on [code]M10[/code] (machine's play wire)", converted, StringComparison.Ordinal);
        Assert.Contains("\n• Switched power on.\n\n[b]Verification:[/b] [code]state[/code] shows", converted, StringComparison.Ordinal);
        // What it shows, with the tags taken out, is the reply less its markers.
        var shown = AnyTag.Replace(converted.Replace("[lb]", "\u0001", StringComparison.Ordinal), "").Replace('\u0001', '[');
        Assert.Equal(RealReply.Replace("**", "", StringComparison.Ordinal).Replace("`", "", StringComparison.Ordinal)
            .Replace("\n- ", "\n• ", StringComparison.Ordinal).Replace("\n  - ", "\n  • ", StringComparison.Ordinal), shown);
    }

    [Fact]
    public void Plain_text_passes_through_and_line_breaks_are_kept() =>
        Assert.Equal("I wired terminal 1+ to 1A.\r\nThen\n\npower.", ChatMarkdown.ToBBCode("I wired terminal 1+ to 1A.\r\nThen\n\npower."));

    [Theory]
    [InlineData("***x***", "[b][i]x[/i][/b]")]
    [InlineData("***both*** after", "[b][i]both[/i][/b] after")]
    [InlineData("**a *b** c*", "[b]a *b[/b] c*")]
    [InlineData("*a **b* c**", "[i]a **b[/i] c**")]
    public void Pairs_that_would_cross_leave_the_inner_one_as_typed(string markdown, string bbcode) =>
        Assert.Equal(bbcode, ChatMarkdown.ToBBCode(markdown));

    [Theory]
    [InlineData("**`connect`**", "[b][code]connect[/code][/b]")]
    [InlineData("**bold `code` bold**", "[b]bold [code]code[/code] bold[/b]")]
    [InlineData("*see `state`*", "[i]see [code]state[/code][/i]")]
    [InlineData("``a ` b``", "[code]a ` b[/code]")]
    public void Emphasis_may_wrap_a_code_span(string markdown, string bbcode) =>
        Assert.Equal(bbcode, ChatMarkdown.ToBBCode(markdown));

    [Theory]
    [InlineData("```x``` here\nmore\n```\ncode\n```\nafter", "[code]x[/code] here\nmore\n[code]code[/code]\nafter")]
    [InlineData("```\ncode\n``` trailing words", "```\ncode\n``` trailing words")]
    [InlineData("```js\nlet a = 1;\n```", "[code]let a = 1;[/code]")]
    [InlineData("  ```\nindented\n  ```", "[code]indented[/code]")]
    public void Only_a_bare_fence_line_opens_or_closes_a_block(string markdown, string bbcode) =>
        Assert.Equal(bbcode, ChatMarkdown.ToBBCode(markdown));

    [Theory]
    [InlineData(@"\*not italic\*", "*not italic*")]
    [InlineData(@"\_not italic\_", "_not italic_")]
    [InlineData(@"\`not code\`", "`not code`")]
    [InlineData(@"\# not a heading", "# not a heading")]
    [InlineData(@"\[b]x", "[lb]b]x")]
    [InlineData(@"a\\b", @"a\b")]
    [InlineData(@"C:\new \d", @"C:\new \d")]
    [InlineData(@"**a\*b**", "[b]a*b[/b]")]
    public void A_backslash_escape_prints_the_character_and_is_never_a_marker(string markdown, string bbcode) =>
        Assert.Equal(bbcode, ChatMarkdown.ToBBCode(markdown));

    [Theory]
    [InlineData("x*y + z*w")]
    [InlineData("a*b*c")]
    [InlineData("2*3*4")]
    [InlineData("snake_case_name")]
    [InlineData("a__b__c")]
    [InlineData("# ")]
    [InlineData("#")]
    [InlineData("* * *")]
    [InlineData("***")]
    [InlineData("___")]
    [InlineData("- - -")]
    [InlineData("- ")]
    public void Markers_inside_words_rules_and_empty_headings_stay_as_typed(string markdown) =>
        Assert.Equal(markdown, ChatMarkdown.ToBBCode(markdown));

    // Decided by the word-boundary rule, not by a special case: a whole-word dunder name is bold.
    [Theory]
    [InlineData("__init__", "[b]init[/b]")]
    [InlineData("call obj.__init__() now", "call obj.[b]init[/b]() now")]
    [InlineData("# Title #", "[b]Title #[/b]")]
    public void Word_boundary_outcomes_are_pinned(string markdown, string bbcode) =>
        Assert.Equal(bbcode, ChatMarkdown.ToBBCode(markdown));

    // Lines a model could send to make a backtracking converter slow: each is one 4 KiB line.
    [Theory]
    [InlineData(" _a")]
    [InlineData("*x ")]
    [InlineData(" __a")]
    [InlineData("**x ")]
    [InlineData("`")]
    [InlineData("[")]
    [InlineData("`` `")]
    [InlineData("[a](")]
    public void An_adversarial_4_KiB_line_converts_in_linear_time(string unit)
    {
        var line = string.Concat(Enumerable.Repeat(unit, 4096 / unit.Length + 1))[..4096];
        ChatMarkdown.ToBBCode(line);
        var best = double.MaxValue;
        for (var run = 0; run < 3; run++)
        {
            var clock = Stopwatch.StartNew();
            ChatMarkdown.ToBBCode(line);
            best = Math.Min(best, clock.Elapsed.TotalMilliseconds);
        }
        output.WriteLine($"unit={unit} best={best:0.00} ms");
        Assert.True(best < 20, $"{unit}: {best:0.0} ms for one 4 KiB line");
    }

    // A fixed-seed property run over strings built from the markers, brackets, backticks, spaces, newlines and letters.
    [Fact]
    public void Random_text_converts_to_inert_balanced_bbcode_that_keeps_every_letter()
    {
        const string alphabet = "**__``[]()\\#- \nab1!";
        var random = new Random(601);
        var openingFenceWithTag = new Regex(@"^[ \t]*```[^`\n]*[^`\s]", RegexOptions.CultureInvariant | RegexOptions.Multiline);
        for (var sample = 0; sample < 4000; sample++)
        {
            var input = new string(Enumerable.Range(0, random.Next(1, 48)).Select(_ => alphabet[random.Next(alphabet.Length)]).ToArray());
            var converted = ChatMarkdown.ToBBCode(input);
            OnlyOwnTags(converted);
            Balanced(converted, input);
            var shown = Visible(converted);
            Assert.True(IsSubsequence(Strip(shown, " •"), Strip(input, " ")), $"not a subsequence: {Show(input)} -> {Show(converted)}");
            // A rendered fence drops its language tag, the one place letters may go: those inputs skip this part.
            if (!openingFenceWithTag.IsMatch(input))
                Assert.True(Letters(shown) == Letters(input), $"letters lost: {Show(input)} -> {Show(converted)}");
        }
    }

    private static readonly Regex Tag = new(@"\[(/?)(b|i|code|lb)\]", RegexOptions.CultureInvariant);

    /// <summary>The converter's own tags open and close in nesting order, and nothing opens inside a code span.</summary>
    private static void Balanced(string bbcode, string input)
    {
        var open = new Stack<string>();
        foreach (Match tag in Tag.Matches(bbcode))
        {
            var name = tag.Groups[2].Value;
            if (name == "lb") continue;
            if (tag.Groups[1].Value.Length == 0)
            {
                Assert.True(!open.Contains("code"), $"tag inside code: {Show(input)} -> {Show(bbcode)}");
                open.Push(name);
            }
            else Assert.True(open.Count > 0 && open.Pop() == name, $"misnested: {Show(input)} -> {Show(bbcode)}");
        }
        Assert.True(open.Count == 0, $"unclosed: {Show(input)} -> {Show(bbcode)}");
    }

    /// <summary>What the label shows: the converter's tags removed and the escape turned back into a bracket.</summary>
    private static string Visible(string bbcode) =>
        Regex.Replace(bbcode.Replace("[lb]", "\u0001", StringComparison.Ordinal), @"\[/?(b|i|code)\]", "").Replace('\u0001', '[');

    private static string Strip(string text, string characters) => new(text.Where(c => !characters.Contains(c)).ToArray());

    private static string Letters(string text) => new(text.Where(char.IsLetterOrDigit).ToArray());

    private static bool IsSubsequence(string part, string whole)
    {
        var at = 0;
        foreach (var c in whole)
            if (at < part.Length && part[at] == c) at++;
        return at == part.Length;
    }

    private static string Show(string text) => text.Replace("\n", "\\n", StringComparison.Ordinal);
}
