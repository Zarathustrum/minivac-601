using System;
using System.Collections.Generic;
using System.IO;

namespace Minivac.Conformance;

public sealed class FileSystemSource : IArtifactSource
{
    private readonly DirectoryInfo _dataRoot;
    private readonly DirectoryInfo _conformanceRoot;

    public FileSystemSource(string repoRoot)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(repoRoot);

        var root = new DirectoryInfo(Path.GetFullPath(repoRoot));
        _dataRoot = new DirectoryInfo(Path.Combine(root.FullName, "data"));
        _conformanceRoot = new DirectoryInfo(Path.Combine(root.FullName, "test", "conformance"));
        if (!root.Exists || !_dataRoot.Exists || !_conformanceRoot.Exists)
            throw new DirectoryNotFoundException($"artifact repository root not found: {root.FullName}");
    }

    public byte[] ReadAllBytes(string relativePath)
    {
        var path = Resolve(relativePath, allowRoot: false);
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length > int.MaxValue)
            throw new IOException($"artifact is too large: {relativePath}");

        var bytes = new byte[(int)stream.Length];
        stream.ReadExactly(bytes);
        return bytes;
    }

    public IReadOnlyList<string> EnumerateFiles(string relativeDir, string pattern)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(pattern);
        if (pattern.IndexOfAny('/', '\\') >= 0)
            throw new ArgumentException("artifact enumeration pattern must be a file-name pattern", nameof(pattern));

        var directory = new DirectoryInfo(Resolve(relativeDir, allowRoot: true));
        var files = directory.GetFiles(pattern, SearchOption.AllDirectories);
        var paths = new string[files.Length];
        for (var index = 0; index < files.Length; index++)
        {
            var tail = Path.GetRelativePath(directory.FullName, files[index].FullName)
                .Replace(Path.DirectorySeparatorChar, '/');
            paths[index] = relativeDir + "/" + tail;
        }

        Array.Sort(paths, StringComparer.Ordinal);
        return paths;
    }

    private string Resolve(string relativePath, bool allowRoot)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(relativePath);
        if (Path.IsPathRooted(relativePath) || relativePath.IndexOf('\\') >= 0)
            throw new ArgumentException("artifact path must be source-relative and use '/' separators", nameof(relativePath));

        var parts = relativePath.Split('/');
        if (parts.Length < (allowRoot ? 1 : 2) || Array.Exists(parts, part => part.Length == 0 || part is "." or ".."))
            throw new ArgumentException("artifact path must remain under data/ or conformance/", nameof(relativePath));

        var root = parts[0] switch
        {
            "data" => _dataRoot,
            "conformance" => _conformanceRoot,
            _ => throw new ArgumentException("artifact path must begin with data/ or conformance/", nameof(relativePath)),
        };

        var path = root.FullName;
        for (var index = 1; index < parts.Length; index++)
            path = Path.Combine(path, parts[index]);

        path = Path.GetFullPath(path);
        var rootPrefix = Path.TrimEndingDirectorySeparator(root.FullName) + Path.DirectorySeparatorChar;
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        if (!path.Equals(root.FullName, comparison) && !path.StartsWith(rootPrefix, comparison))
            throw new ArgumentException("artifact path must remain under data/ or conformance/", nameof(relativePath));

        return path;
    }
}
