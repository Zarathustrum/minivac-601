using System;
using System.Collections.Generic;
using Godot;
using Minivac.Conformance;

namespace Minivac.Godot;

public sealed class GodotResourceSource : IArtifactSource
{
    public byte[] ReadAllBytes(string relativePath)
    {
        ValidatePath(relativePath, allowRoot: false);
        var resourcePath = "res://" + relativePath;
        if (!global::Godot.FileAccess.FileExists(resourcePath))
            throw new InvalidOperationException("artifact not found: " + relativePath);

        var bytes = global::Godot.FileAccess.GetFileAsBytes(resourcePath);
        var error = global::Godot.FileAccess.GetOpenError();
        if (error != Error.Ok)
            throw new InvalidOperationException("cannot read artifact " + relativePath + ": " + error);
        return bytes;
    }

    public IReadOnlyList<string> EnumerateFiles(string relativeDir, string pattern)
    {
        ValidatePath(relativeDir, allowRoot: true);
        ArgumentException.ThrowIfNullOrWhiteSpace(pattern);
        if (pattern.IndexOfAny('/', '\\') >= 0)
            throw new ArgumentException("artifact enumeration pattern must be a file-name pattern", nameof(pattern));

        var files = new List<string>();
        CollectFiles(relativeDir, pattern, files);
        files.Sort(StringComparer.Ordinal);
        return files.AsReadOnly();
    }

    private static void CollectFiles(string relativeDir, string pattern, List<string> into)
    {
        var resourceDir = "res://" + relativeDir;
        if (!DirAccess.DirExistsAbsolute(resourceDir))
            throw new InvalidOperationException("artifact directory not found: " + relativeDir);

        foreach (var fileName in DirAccess.GetFilesAt(resourceDir))
        {
            if (MatchesPattern(fileName, pattern))
                into.Add(relativeDir + "/" + fileName);
        }

        foreach (var directoryName in DirAccess.GetDirectoriesAt(resourceDir))
            CollectFiles(relativeDir + "/" + directoryName, pattern, into);
    }

    private static bool MatchesPattern(string text, string pattern)
    {
        var textIndex = 0;
        var patternIndex = 0;
        var starIndex = -1;
        var retryTextIndex = 0;

        while (textIndex < text.Length)
        {
            if (patternIndex < pattern.Length &&
                (pattern[patternIndex] == '?' || pattern[patternIndex] == text[textIndex]))
            {
                patternIndex++;
                textIndex++;
            }
            else if (patternIndex < pattern.Length && pattern[patternIndex] == '*')
            {
                starIndex = patternIndex++;
                retryTextIndex = textIndex;
            }
            else if (starIndex >= 0)
            {
                patternIndex = starIndex + 1;
                textIndex = ++retryTextIndex;
            }
            else
            {
                return false;
            }
        }

        while (patternIndex < pattern.Length && pattern[patternIndex] == '*')
            patternIndex++;
        return patternIndex == pattern.Length;
    }

    private static void ValidatePath(string relativePath, bool allowRoot)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(relativePath);
        if (relativePath.StartsWith("/", StringComparison.Ordinal) || relativePath.IndexOf('\\') >= 0)
            throw new ArgumentException("artifact path must be source-relative and use '/' separators", nameof(relativePath));

        var parts = relativePath.Split('/');
        if (parts.Length < (allowRoot ? 1 : 2) ||
            Array.Exists(parts, part => part.Length == 0 || part is "." or ".."))
            throw new ArgumentException("artifact path must remain under data/ or conformance/", nameof(relativePath));

        if (parts[0] is not ("data" or "conformance"))
            throw new ArgumentException("artifact path must begin with data/ or conformance/", nameof(relativePath));
    }
}
