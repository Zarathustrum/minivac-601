using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Minivac.Conformance;

public static class Fallbacks
{
    public static IReadOnlyList<FallbackRecord> List(
        IArtifactSource source,
        string relativeDirectory = "conformance/fixtures")
    {
        ArgumentNullException.ThrowIfNull(source);
        var paths = source.EnumerateFiles(relativeDirectory, "*.fixture.json");
        var records = new List<FallbackRecord>();
        for (var pathIndex = 0; pathIndex < paths.Count; pathIndex++)
        {
            var fixture = FixtureLoader.LoadFixture(source, paths[pathIndex]).fixture;
            for (var scriptIndex = 0; scriptIndex < fixture.script.Count; scriptIndex++)
            {
                if (fixture.script[scriptIndex] is ScriptStep.Expect { tag: "unverified" } expect)
                    records.Add(new FallbackRecord(fixture.id, scriptIndex, expect.source!, expect.cite));
                else if (fixture.script[scriptIndex] is ScriptStep.Until { tag: "unverified" } until)
                    records.Add(new FallbackRecord(fixture.id, scriptIndex, until.source!, until.cite));
            }
        }
        records.Sort(Compare);
        return records.AsReadOnly();
    }

    public static string Format(IReadOnlyList<FallbackRecord> records)
    {
        ArgumentNullException.ThrowIfNull(records);
        var output = new StringBuilder();
        for (var index = 0; index < records.Count; index++)
        {
            var record = records[index];
            output.Append(record.fixtureId).Append('\t')
                .Append("script[").Append(record.scriptIndex.ToString(CultureInfo.InvariantCulture)).Append("]\t")
                .Append(record.source).Append('\t').Append(record.cite).Append('\n');
        }
        return output.ToString();
    }

    private static int Compare(FallbackRecord left, FallbackRecord right)
    {
        var byId = string.CompareOrdinal(left.fixtureId, right.fixtureId);
        return byId != 0 ? byId : left.scriptIndex.CompareTo(right.scriptIndex);
    }
}
