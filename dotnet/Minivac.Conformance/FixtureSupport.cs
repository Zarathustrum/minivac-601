using System;
using Minivac.Core;

namespace Minivac.Conformance;

public static class FixtureSupport
{
    public static int ObservableIndex(string name)
    {
        for (var index = 0; index < Trace.OBSERVABLES.Count; index++)
        {
            if (string.Equals(Trace.OBSERVABLES[index].name, name, StringComparison.Ordinal))
                return index;
        }
        throw new FixtureException("unknown observable " + Quote(name));
    }

    public static string ObservableValue(int index, int encoded)
    {
        if (index < 0 || index >= Trace.OBSERVABLES.Count)
            throw new FixtureException("observable index out of range: " + index);
        var row = Trace.OBSERVABLES[index];
        var at = encoded - row.minValue;
        if (at < 0 || at >= row.values.Count)
            throw new FixtureException(row.name + " has invalid encoding " + encoded);
        return row.values[at];
    }

    public static int ExpectedEncoding(string name, string value)
    {
        var index = ObservableIndex(name);
        var row = Trace.OBSERVABLES[index];
        for (var at = 0; at < row.values.Count; at++)
        {
            if (string.Equals(row.values[at], value, StringComparison.Ordinal))
                return row.minValue + at;
        }
        throw new FixtureException(name + " has invalid spelling " + Quote(value));
    }

    public static string QuoteGolden(string text) =>
        "\"" + text.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("\"", "\\\"", StringComparison.Ordinal) + "\"";

    private static string Quote(string text) => System.Text.Json.JsonSerializer.Serialize(text);
}
