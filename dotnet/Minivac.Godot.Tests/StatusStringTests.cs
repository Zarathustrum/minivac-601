using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Xunit;

namespace Minivac.Godot.Tests;

public sealed class StatusStringTests
{
    private static readonly string[] Fixed =
    [
        "All 256 cord ids are in use.",
        "Cord endpoint connected.",
        "Cord change cancelled.",
        "Cord drop cancelled.",
        "Cord move cancelled.",
        "Touch requires a free cord end.",
        "Select a cord end first.",
        "Select end A or B, then click a jack hole. Free ends stay electrically loose.",
        "Rejected: ",
        "Accepted: ",
        " is occupied.",
    ];

    private static readonly (string First, string Second)[] Pairs =
    [
        ("Cord rollback rejected: ", "."),
        ("Cord change rejected: ", "."),
        ("Touching terminal ", "."),
        ("Choose a terminal or Free for cord ", "."),
    ];

    [Fact]
    public void Extractor_returns_literals_and_offsets_but_not_comments_or_characters()
    {
        const string source = "// \"comment\"\nvar a = \"one\\n\"; var b = @\"two\"\"x\"; char c = '\"';";
        var spans = LiteralExtractor.Extract(source);

        Assert.Equal(["one\n", "two\"x"], spans.Select(span => span.Value));
        Assert.Equal(source.IndexOf("\"one", StringComparison.Ordinal), spans[0].Offset);
    }

    [Fact]
    public void All_fifteen_status_cases_are_live_code_literals()
    {
        var files = Directory.GetFiles(Path.Combine(RepoRoot(), "godot/scripts"), "*.cs")
            .Select(path => (Path: path, Spans: LiteralExtractor.Extract(File.ReadAllText(path))))
            .ToArray();

        foreach (var expected in Fixed)
            Assert.Contains(files.SelectMany(file => file.Spans), span => span.Value == expected);

        foreach (var (first, second) in Pairs)
        {
            Assert.Contains(files, file => file.Spans.Any(left =>
                left.Value == first && file.Spans.Any(right =>
                    right.Value == second && right.Offset > left.Offset && right.Offset - left.Offset <= 200)));
        }
    }

    private static string RepoRoot() =>
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../.."));
}
