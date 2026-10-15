using System.Collections.Generic;
using Minivac.Core;

namespace Minivac.Conformance;

public sealed record Erratum(string id, string from, string to);

public sealed record Mechanism(string profileKey, string decision);

public sealed record ReviewedDigest(int eventCount, IReadOnlyList<int> moverTransitions);

public sealed record ExpectedObservable(string dev, string v);

public abstract record ScriptStep(string k)
{
    public sealed record Do(Command cmd, bool collapse = false) : ScriptStep("do");

    public sealed record Advance(int ms) : ScriptStep("advance");

    public sealed record Settle(int maxMs) : ScriptStep("settle");

    public sealed record Expect(
        IReadOnlyList<ExpectedObservable> obs,
        string cite,
        string quote,
        string? tag = null,
        string? source = null) : ScriptStep("expect");

    /// <summary>
    /// An expect that first advances one tick at a time until every obs matches or maxMs runs out
    /// (architecture §13.5.1).
    /// </summary>
    public sealed record Until(
        IReadOnlyList<ExpectedObservable> obs,
        int maxMs,
        string cite,
        string quote,
        string? tag = null,
        string? source = null) : ScriptStep("until");
}

public sealed record Fixture(
    string schema,
    string id,
    string source,
    string tier,
    string confidence,
    string profile,
    string contract,
    IReadOnlyList<string> as_printed,
    IReadOnlyList<Erratum> errata_applied,
    IReadOnlyList<string> wires,
    IReadOnlyList<ScriptStep> script,
    string? note,
    bool marginal,
    Mechanism? mechanism,
    ReviewedDigest? digest);

public sealed record LoadedFixture(
    string path,
    Fixture fixture,
    Profile profile,
    LoadedNetlist netlist,
    IReadOnlyList<TerminalWire> wires,
    IReadOnlyList<AllocatedCord> cords);

public sealed record FallbackRecord(string fixtureId, int scriptIndex, string source, string cite);
