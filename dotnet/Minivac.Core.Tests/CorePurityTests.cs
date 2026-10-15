using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Xunit;

namespace Minivac.Core.Tests;

public sealed class CorePurityTests
{
    private static readonly (string Name, Regex Pattern)[] BannedCorePatterns =
    [
        ("Godot", Pattern(@"\bGodot\b")),
        ("System.Linq", Pattern(@"\bSystem\s*\.\s*Linq\b")),
        ("System.Numerics", Pattern(@"\bSystem\s*\.\s*Numerics\b")),
        ("Random", Pattern(@"\bRandom\b")),
        ("DateTime", Pattern(@"\bDateTime\b")),
        ("Stopwatch", Pattern(@"\bStopwatch\b")),
        ("Environment.TickCount", Pattern(@"\bEnvironment\s*\.\s*TickCount\b")),
        ("MathF", Pattern(@"\bMathF\b")),
        ("Math.Round", Pattern(@"\bMath\s*\.\s*Round\b")),
        ("MultiplyAddEstimate", Pattern(@"\bMultiplyAddEstimate\b")),
        ("ConvertToIntegerNative", Pattern(@"\bConvertToIntegerNative\b")),
        ("CultureInfo.CurrentCulture", Pattern(@"\bCultureInfo\s*\.\s*CurrentCulture\b")),
        ("Dictionary<", Pattern(@"\bDictionary\s*<")),
        ("HashSet<", Pattern(@"\bHashSet\s*<")),
        ("OrderBy", Pattern(@"\bOrderBy\b")),
        ("Sort(", Pattern(@"\bSort\s*\(")),
        ("parameterless ToString", Pattern(@"\.\s*ToString\s*\(\s*\)")),
    ];

    private static readonly HashSet<string> AllowedMathMembers = new(StringComparer.Ordinal)
    {
        "Abs",
        "Floor",
        "Truncate",
    };

    private static readonly Regex DirectFileSystemIo = Pattern(
        @"\b(?:File|Directory|FileStream|FileInfo|DirectoryInfo|FileSystemInfo|FileSystemWatcher|DriveInfo|StreamReader|StreamWriter|RandomAccess)\b");

    [Fact]
    public void Core_project_has_no_package_or_project_references()
    {
        var projectPath = Path.Combine(FindRepositoryRoot(), "dotnet", "Minivac.Core", "Minivac.Core.csproj");
        using var stream = OpenRead(projectPath);
        var project = XDocument.Load(stream);

        Assert.DoesNotContain(project.Descendants(), element =>
            element.Name.LocalName is "PackageReference" or "ProjectReference");
    }

    [Fact]
    public void Core_source_contains_no_banned_dependency_or_operation()
    {
        var violations = new List<string>();
        foreach (var source in SourceFiles("Minivac.Core"))
        {
            var executable = MaskCommentsAndLiterals(ReadText(source));
            foreach (var banned in BannedCorePatterns)
            {
                foreach (Match match in banned.Pattern.Matches(executable))
                    violations.Add(Describe(source, executable, match.Index, banned.Name));
            }

            foreach (Match match in Pattern(@"\bMath\s*\.\s*([A-Za-z_]\w*)").Matches(executable))
            {
                var member = match.Groups[1].Value;
                if (!AllowedMathMembers.Contains(member))
                    violations.Add(Describe(source, executable, match.Index, $"Math.{member}"));
            }
        }

        Assert.Empty(violations);
    }

    [Fact]
    public void Conformance_source_uses_only_the_artifact_source_io_seam()
    {
        var violations = new List<string>();
        foreach (var source in SourceFiles("Minivac.Conformance"))
        {
            if (Path.GetFileName(source).Equals("FileSystemSource.cs", StringComparison.Ordinal))
                continue;

            var executable = MaskCommentsAndLiterals(ReadText(source));
            foreach (Match match in DirectFileSystemIo.Matches(executable))
                violations.Add(Describe(source, executable, match.Index, match.Value));
        }

        Assert.Empty(violations);
    }

    [Fact]
    public void Scanner_masks_literal_text_but_preserves_interpolation_expressions()
    {
        var source =
            "var a = $\"literal DateTime {DateTime.Now}\";\n" +
            "var b = $@\"literal Random {Math.Abs(value)}\";\n" +
            "var c = $\"\"\"literal Stopwatch {Environment.TickCount}\"\"\";\n" +
            "var d = $\"nested {Format(\"Random\", DateTime.Now)}\";";

        var executable = MaskCommentsAndLiterals(source);

        Assert.Equal(2, Pattern(@"\bDateTime\b").Matches(executable).Count);
        Assert.Single(Pattern(@"\bMath\s*\.\s*Abs\b").Matches(executable));
        Assert.Single(Pattern(@"\bEnvironment\s*\.\s*TickCount\b").Matches(executable));
        Assert.DoesNotContain("Random", executable, StringComparison.Ordinal);
        Assert.DoesNotContain("Stopwatch", executable, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("var bytes = File.ReadAllBytes(path);", true)]
    [InlineData("var stream = new FileStream(path, mode);", true)]
    [InlineData("var root = new DirectoryInfo(path);", true)]
    [InlineData("using var reader = new StreamReader(path);", true)]
    [InlineData("using var stream = new MemoryStream(bytes);", false)]
    [InlineData("var label = \"FileStream DirectoryInfo\";", false)]
    public void Conformance_io_scanner_distinguishes_filesystem_access_from_in_memory_streams(
        string source,
        bool expectedViolation)
    {
        Assert.Equal(expectedViolation, DirectFileSystemIo.IsMatch(MaskCommentsAndLiterals(source)));
    }

    private static Regex Pattern(string expression) =>
        new(expression, RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static IReadOnlyList<string> SourceFiles(string projectName)
    {
        var directory = new DirectoryInfo(Path.Combine(FindRepositoryRoot(), "dotnet", projectName));
        return directory.GetFiles("*.cs", SearchOption.AllDirectories)
            .Where(entry => !IsBuildOutput(directory, entry))
            .Select(entry => entry.FullName)
            .Order(StringComparer.Ordinal)
            .ToArray();
    }

    private static bool IsBuildOutput(DirectoryInfo project, FileInfo source)
    {
        var relative = Path.GetRelativePath(project.FullName, source.FullName)
            .Replace(Path.DirectorySeparatorChar, '/');
        return relative.Split('/').Any(part => part is "bin" or "obj");
    }

    private static FileStream OpenRead(string path) =>
        new(path, FileMode.Open, FileAccess.Read, FileShare.Read);

    private static string ReadText(string path)
    {
        using var stream = OpenRead(path);
        using var reader = new StreamReader(stream, new UTF8Encoding(false, true));
        return reader.ReadToEnd();
    }

    private static string MaskCommentsAndLiterals(string source)
    {
        var masked = new char[source.Length];
        for (var at = 0; at < source.Length; at++)
        {
            if (source[at] == '\n')
                masked[at] = '\n';
        }

        CopyCode(source, masked, 0, source.Length);
        return new string(masked);
    }

    private static int CopyCode(string source, char[] masked, int at, int end)
    {
        while (at < end)
        {
            if (at + 1 < end && source[at] == '/' && source[at + 1] == '/')
            {
                at = source.IndexOf('\n', at + 2);
                if (at < 0 || at >= end)
                    return end;
                continue;
            }

            if (at + 1 < end && source[at] == '/' && source[at + 1] == '*')
            {
                var close = source.IndexOf("*/", at + 2, StringComparison.Ordinal);
                at = close < 0 || close >= end ? end : close + 2;
                continue;
            }

            var interpolated = InterpolatedLiteralAt(source, at);
            if (interpolated is not null)
            {
                at = CopyInterpolatedLiteral(source, masked, interpolated.Value);
                continue;
            }

            var literalEnd = PlainLiteralEnd(source, at);
            if (literalEnd >= 0)
            {
                at = literalEnd;
                continue;
            }

            masked[at] = source[at];
            at++;
        }

        return at;
    }

    private static (int Content, int QuoteCount, int BraceCount, bool Verbatim)? InterpolatedLiteralAt(
        string source,
        int at)
    {
        var dollars = 0;
        while (at + dollars < source.Length && source[at + dollars] == '$')
            dollars++;
        if (dollars > 0)
        {
            var quotes = QuoteRun(source, at + dollars);
            if (quotes >= 3)
                return (at + dollars + quotes, quotes, dollars, false);
        }

        if (at + 1 < source.Length && source[at] == '$' && source[at + 1] == '"')
            return (at + 2, 1, 1, false);
        if (at + 2 < source.Length &&
            ((source[at] == '$' && source[at + 1] == '@') ||
             (source[at] == '@' && source[at + 1] == '$')) &&
            source[at + 2] == '"')
            return (at + 3, 1, 1, true);
        return null;
    }

    private static int CopyInterpolatedLiteral(
        string source,
        char[] masked,
        (int Content, int QuoteCount, int BraceCount, bool Verbatim) literal)
    {
        var raw = literal.QuoteCount >= 3;
        for (var at = literal.Content; at < source.Length;)
        {
            if (raw && QuoteRun(source, at) >= literal.QuoteCount)
                return at + literal.QuoteCount;

            if (!raw && source[at] == '"')
            {
                if (literal.Verbatim && at + 1 < source.Length && source[at + 1] == '"')
                {
                    at += 2;
                    continue;
                }
                return at + 1;
            }

            if (!raw && !literal.Verbatim && source[at] == '\\')
            {
                at += Math.Min(2, source.Length - at);
                continue;
            }

            var braces = CharRun(source, at, '{');
            if (braces >= literal.BraceCount)
            {
                if (!raw && braces >= 2)
                {
                    at += 2;
                    continue;
                }

                at = CopyInterpolationExpression(source, masked, at + literal.BraceCount, literal.BraceCount);
                continue;
            }

            at++;
        }

        return source.Length;
    }

    private static int CopyInterpolationExpression(string source, char[] masked, int at, int closingBraceCount)
    {
        var nestedBraces = 0;
        while (at < source.Length)
        {
            if (at + 1 < source.Length && source[at] == '/' && source[at + 1] == '/')
            {
                at = source.IndexOf('\n', at + 2);
                if (at < 0)
                    return source.Length;
                continue;
            }

            if (at + 1 < source.Length && source[at] == '/' && source[at + 1] == '*')
            {
                var close = source.IndexOf("*/", at + 2, StringComparison.Ordinal);
                at = close < 0 ? source.Length : close + 2;
                continue;
            }

            var interpolated = InterpolatedLiteralAt(source, at);
            if (interpolated is not null)
            {
                at = CopyInterpolatedLiteral(source, masked, interpolated.Value);
                continue;
            }

            var literalEnd = PlainLiteralEnd(source, at);
            if (literalEnd >= 0)
            {
                at = literalEnd;
                continue;
            }

            if (source[at] == '{')
            {
                nestedBraces++;
                masked[at++] = '{';
                continue;
            }

            if (source[at] == '}')
            {
                if (nestedBraces == 0 && CharRun(source, at, '}') >= closingBraceCount)
                    return at + closingBraceCount;
                if (nestedBraces > 0)
                    nestedBraces--;
            }

            masked[at] = source[at];
            at++;
        }

        return at;
    }

    private static int PlainLiteralEnd(string source, int at)
    {
        var quotes = QuoteRun(source, at);
        if (quotes >= 3)
        {
            var close = source.IndexOf(new string('"', quotes), at + quotes, StringComparison.Ordinal);
            return close < 0 ? source.Length : close + quotes;
        }

        if (source[at] == '@' && at + 1 < source.Length && source[at + 1] == '"')
            return FindQuotedLiteralEnd(source, at + 1, '"', verbatim: true);
        if (source[at] is '\'' or '"')
            return FindQuotedLiteralEnd(source, at, source[at], verbatim: false);
        return -1;
    }

    private static int FindQuotedLiteralEnd(string source, int start, char quote, bool verbatim)
    {
        for (var at = start + 1; at < source.Length; at++)
        {
            if (source[at] != quote)
                continue;
            if (verbatim && at + 1 < source.Length && source[at + 1] == quote)
            {
                at++;
                continue;
            }
            if (!verbatim && IsEscaped(source, at))
                continue;
            return at + 1;
        }

        return source.Length;
    }

    private static int QuoteRun(string source, int at) => CharRun(source, at, '"');

    private static int CharRun(string source, int at, char value)
    {
        var end = at;
        while (end < source.Length && source[end] == value)
            end++;
        return end - at;
    }

    private static bool IsEscaped(string source, int at)
    {
        var slashes = 0;
        for (var index = at - 1; index >= 0 && source[index] == '\\'; index--)
            slashes++;
        return (slashes & 1) != 0;
    }

    private static string Describe(string path, string source, int index, string violation)
    {
        var line = 1;
        for (var at = 0; at < index; at++)
        {
            if (source[at] == '\n')
                line++;
        }

        return $"{Path.GetFileName(path)}:{line}: forbidden {violation}";
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
