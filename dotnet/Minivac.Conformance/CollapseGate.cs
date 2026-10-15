using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Minivac.Conformance;

public sealed record CollapseFailure(int scriptIndex, string dev, string expected, string actual);

public static partial class CollapseGate
{
    public static readonly IReadOnlyList<string> IDS = Array.AsReadOnly(new[]
    {
        "I-EXP9", "II-MANUALMEM", "II-SELFLOCK", "II-2BUTTONMEM",
        "II-FF1", "IV-FF1", "IV-FF2", "IV-FF2-CARRY",
    });

    public static bool isControlPosition(string dev) =>
        dev is "power" or "breaker" or "dial" || ControlPosition().IsMatch(dev);

    public static IReadOnlyList<ScriptStep> withoutCollapseSteps(IReadOnlyList<ScriptStep> script)
    {
        var result = new List<ScriptStep>(script.Count);
        foreach (var step in script)
            if (step is not ScriptStep.Do { collapse: true }) result.Add(step);
        return result.AsReadOnly();
    }

    public static IReadOnlyList<CollapseFailure> expectedFunctionalFailures(string id) => id switch
    {
        "I-EXP9" => Rows(
            new(11, "relay1", "nc", "no"),
            new(11, "indLamp1", "off", "on")),
        "II-MANUALMEM" => Rows(new CollapseFailure(8, "relay1", "nc", "no")),
        "II-SELFLOCK" => Rows(),
        "II-2BUTTONMEM" => Rows(new CollapseFailure(13, "relay1", "no", "nc")),
        "II-FF1" => Rows(new CollapseFailure(12, "outLamp1", "off", "on")),
        "IV-FF1" => Rows(new CollapseFailure(14, "outLamp6", "off", "on")),
        "IV-FF2" or "IV-FF2-CARRY" => Rows(
            new(6, "relay6", "no", "nc"),
            new(9, "relay5", "nc", "no"),
            new(9, "relay6", "no", "nc")),
        _ => throw new ArgumentException("unknown collapse fixture " + id, nameof(id)),
    };

    public static readonly CollapseFailure SELF_LOCK_WITNESS = new(6, "pb1", "nc", "no");

    public static readonly IReadOnlyList<CollapseFailure> NEUTRALISED_II_FF1 = Rows();

    public static readonly IReadOnlyList<CollapseFailure> NEUTRALISED_IV_FF2 = Rows(
        new CollapseFailure(7, "relay5", "no", "nc"),
        new CollapseFailure(7, "relay6", "no", "nc"),
        new CollapseFailure(10, "relay5", "nc", "no"),
        new CollapseFailure(10, "relay6", "no", "nc"));

    private static IReadOnlyList<CollapseFailure> Rows(params CollapseFailure[] rows) => Array.AsReadOnly(rows);

    [GeneratedRegex("^(?:pb|sw)[1-6]$", RegexOptions.CultureInvariant)]
    private static partial Regex ControlPosition();
}
