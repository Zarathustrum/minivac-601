using System.Collections.Generic;
using Minivac.Core;

namespace Minivac.Conformance;

public sealed record LoadedProbe(string path, ProbeDocument probe);

public sealed record ProbeDocument(
    string schema,
    string id,
    string source,
    string profile,
    IReadOnlyList<ProbeCase> cases,
    IReadOnlyList<ModeledObservableSubstitution> modeledSubstitutions);

public sealed record ModeledObservableSubstitution(
    string k,
    string claim,
    string model,
    string status,
    bool sourceEquivalent);

public abstract record ProbeCase(string k, string name);

public sealed record MachineCase(
    string name,
    MachineSource source,
    IReadOnlyList<MachineCheckpoint> checkpoints) : ProbeCase("machine", name);

public sealed record ProfileLoadCase(
    string name,
    ProfileLoad load,
    IReadOnlyList<ProbeCheck> checks,
    bool diagnostic) : ProbeCase("profileLoad", name);

public abstract record MachineSource(string k);

public sealed record FixtureMachineSource(string fixture) : MachineSource("fixture");

public sealed record ScenarioMachineSource(
    IReadOnlyList<string> wires,
    IReadOnlyList<ProbeAction> actions) : MachineSource("scenario");

public abstract record ProbeAction(string k);

public sealed record ProbeDoAction(Command cmd) : ProbeAction("do");

public sealed record ProbeAdvanceAction(int ticks) : ProbeAction("advance");

public sealed record ProbeSettleAction(int maxTicks) : ProbeAction("settle");

public abstract record CheckpointAddress(string k)
{
    public abstract int Index { get; }
    public abstract string StepKind { get; }
}

public sealed record FixtureStepAddress(int scriptIndex, string stepKind) : CheckpointAddress("fixtureStep")
{
    public override int Index => scriptIndex;
    public override string StepKind => stepKind;
}

public sealed record ActionAddress(int actionIndex, string actionKind) : CheckpointAddress("action")
{
    public override int Index => actionIndex;
    public override string StepKind => actionKind;
}

public sealed record MachineCheckpoint(
    string name,
    CheckpointAddress at,
    IReadOnlyList<ProbeCheck> checks);

public sealed record ProfileLoad(
    int coils,
    string feed,
    int outputLamps,
    string indicatorLamps,
    PanelLampModelSubstitute powerLamp);

public sealed record PanelLampModelSubstitute(string k, int count, string status);

public abstract record NumericRead(string k);

public sealed record StateNumericRead(string field) : NumericRead("state");

public sealed record RelayNumericRead(int n, string field) : NumericRead("relay");

public sealed record LampNumericRead(string kind, int n, string field) : NumericRead("lamp");

public sealed record TerminalPairMvRead(string a, string b) : NumericRead("terminalPairMv");

public sealed record LoadNumericRead(string field) : NumericRead("load");

public sealed record ProfileNumericRead(string field) : NumericRead("profile");

public sealed record RelayThresholdNumericRead(int n, string field) : NumericRead("relayThreshold");

public abstract record NumericOperand(string k);

public sealed record ReadNumericOperand(NumericRead read) : NumericOperand(read.k);

public sealed record LiteralNumericOperand(int value) : NumericOperand("literal");

public abstract record BoolRead(string k);

public sealed record StateBoolRead(string field) : BoolRead("stateBool");

public sealed record RelayBoolRead(int n, string field) : BoolRead("relayBool");

public sealed record EventSelector(string k, int? n);

public abstract record ProbeCheck(string k, string name);

public sealed record NearProbeCheck(
    string name,
    NumericRead read,
    int expected,
    int tolerance) : ProbeCheck("near", name);

public sealed record CompareProbeCheck(
    string name,
    NumericRead left,
    string op,
    NumericOperand right) : ProbeCheck("compare", name);

public sealed record BoolProbeCheck(
    string name,
    BoolRead read,
    bool expected) : ProbeCheck("bool", name);

public sealed record EventSeenProbeCheck(
    string name,
    EventSelector @event,
    bool expected) : ProbeCheck("eventSeen", name);

public abstract record CheckResult(string k, string name, bool pass);

public sealed record NearCheckResult(
    string name,
    int actual,
    int expected,
    int tolerance,
    bool pass) : CheckResult("near", name, pass);

public sealed record CompareCheckResult(
    string name,
    int left,
    string op,
    int right,
    bool pass) : CheckResult("compare", name, pass);

public sealed record BoolCheckResult(
    string name,
    bool actual,
    bool expected,
    bool pass) : CheckResult("bool", name, pass);

public sealed record EventSeenCheckResult(
    string name,
    int count,
    bool expected,
    bool pass) : CheckResult("eventSeen", name, pass);

public sealed record CheckpointResult(
    string name,
    CheckpointAddress at,
    IReadOnlyList<CheckResult> checks);

public abstract record ProbeCaseResult(string k, string name);

public sealed record MachineCaseResult(
    string name,
    IReadOnlyList<CheckpointResult> checkpoints) : ProbeCaseResult("machine", name);

public sealed record ProfileLoadCaseResult(
    string name,
    IReadOnlyList<CheckResult> checks,
    bool diagnostic) : ProbeCaseResult("profileLoad", name);

public sealed record ProbeResult(
    string schema,
    string id,
    string profile,
    IReadOnlyList<ProbeCaseResult> cases,
    bool pass);

public interface IProbeFixtureProvider
{
    LoadedFixture LoadFixture(string fixtureId);
}

public sealed class ArtifactProbeFixtureProvider : IProbeFixtureProvider
{
    private readonly IArtifactSource _source;

    public ArtifactProbeFixtureProvider(IArtifactSource source) => _source = source;

    public LoadedFixture LoadFixture(string fixtureId)
    {
        var paths = _source.EnumerateFiles("conformance/fixtures", fixtureId + ".fixture.json");
        if (paths.Count != 1)
            throw new ProbeException("fixture " + fixtureId + " occurs " + paths.Count + " times, expected 1");
        return FixtureLoader.LoadFixture(_source, paths[0]);
    }
}
