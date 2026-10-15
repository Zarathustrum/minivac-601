using System.Collections.Generic;

namespace Minivac.Conformance;

public interface IArtifactSource
{
    byte[] ReadAllBytes(string relativePath);

    IReadOnlyList<string> EnumerateFiles(string relativeDir, string pattern);
}
