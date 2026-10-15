using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using Minivac.Core;

namespace Minivac.Conformance;

public static class ProbeRunner
{
    public static ProbeResult Run(IArtifactSource source, string relativePath) =>
        runProbe(source, relativePath);

    public static ProbeResult runProbe(
        IArtifactSource source,
        string relativePath,
        IProbeFixtureProvider? fixtures = null) =>
        runLoadedProbe(source, ProbeLoader.loadProbe(source, relativePath, fixtures), fixtures);

    public static ProbeResult runLoadedProbe(
        IArtifactSource source,
        LoadedProbe loaded,
        IProbeFixtureProvider? fixtures = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        fixtures ??= new ArtifactProbeFixtureProvider(source);
        var assets = LoadAssets(source, loaded.probe.profile);
        var cases = new List<ProbeCaseResult>(loaded.probe.cases.Count);
        foreach (var row in loaded.probe.cases)
        {
            cases.Add(row is MachineCase machine
                ? RunMachineCase(machine, loaded.probe.profile, assets, fixtures)
                : RunProfileCase((ProfileLoadCase)row, assets.profile));
        }
        var pass = true;
        foreach (var row in cases)
            if (!CasePass(row)) pass = false;
        return new ProbeResult("minivac.probe-result/1", loaded.probe.id, loaded.probe.profile, cases.AsReadOnly(), pass);
    }

    public static void assertProbePortable(State state)
    {
        if (state.flags.nonPortable)
            throw new ProbeException("Machine marked probe non-portable");
    }

    private static (Profile profile, LoadedNetlist netlist) LoadAssets(IArtifactSource source, string profileId)
    {
        var profileBytes = source.ReadAllBytes("data/profiles/" + profileId + ".json");
        var profileText = StrictText(profileBytes, profileId + " profile");
        Profile profile;
        try
        {
            using var document = JsonDocument.Parse(profileText);
            profile = Profile.LoadProfile(document.RootElement);
        }
        catch (JsonException)
        {
            throw new ProbeException(profileId + " profile is not valid JSON");
        }
        if (!string.Equals(profile.id, profileId, StringComparison.Ordinal))
            throw new ProbeException("loaded profile id does not match probe profile " + profileId);
        var netlist = Netlist.LoadNetlist(source.ReadAllBytes("data/netlist.json"));
        return (profile, netlist);
    }

    private static string StrictText(byte[] bytes, string where)
    {
        if (bytes.Length >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf)
            throw new ProbeException(where + " has a UTF-8 BOM");
        for (var i = 0; i < bytes.Length; i++)
            if (bytes[i] == 0x0d) throw new ProbeException(where + " contains CR at byte " + i);
        try { return new UTF8Encoding(false, true).GetString(bytes); }
        catch (DecoderFallbackException) { throw new ProbeException(where + " is not valid UTF-8"); }
    }

    private static MachineCaseResult RunMachineCase(
        MachineCase row,
        string profileId,
        (Profile profile, LoadedNetlist netlist) assets,
        IProbeFixtureProvider fixtures)
    {
        Profile profile;
        Machine machine;
        IReadOnlyList<object> steps;
        var fixtureBacked = row.source is FixtureMachineSource;
        if (row.source is FixtureMachineSource fixtureSource)
        {
            var fixture = fixtures.LoadFixture(fixtureSource.fixture);
            if (fixture.fixture.profile != profileId)
                throw new ProbeException(row.name + " fixture profile differs from probe profile");
            profile = fixture.profile;
            machine = Machine.CreateMachine(fixture.netlist, profile);
            ApplyInitial(machine, fixture.cords);
            var projected = new object[fixture.fixture.script.Count];
            for (var i = 0; i < projected.Length; i++) projected[i] = fixture.fixture.script[i];
            steps = projected;
        }
        else
        {
            var scenario = (ScenarioMachineSource)row.source;
            profile = assets.profile;
            machine = Machine.CreateMachine(assets.netlist, profile);
            var wires = new List<TerminalWire>(scenario.wires.Count);
            foreach (var wire in scenario.wires) wires.Add(Terminals.parseTerminalWire(wire));
            ApplyInitial(machine, Terminals.AllocateHoles(wires));
            var projected = new object[scenario.actions.Count];
            for (var i = 0; i < projected.Length; i++) projected[i] = scenario.actions[i];
            steps = projected;
        }

        var events = new List<Event>();
        var results = new List<CheckpointResult>(row.checkpoints.Count);
        var checkpointIndex = 0;
        var last = row.checkpoints[^1].at.Index;
        for (var i = 0; i <= last; i++)
        {
            if (i >= steps.Count)
                throw new ProbeException(row.name + " source ended before checkpoint");
            if (fixtureBacked)
                ExecuteFixtureStep(machine, (ScriptStep)steps[i], profile, events);
            else
                ExecuteAction(machine, (ProbeAction)steps[i], profile, events);

            if (checkpointIndex >= row.checkpoints.Count || row.checkpoints[checkpointIndex].at.Index != i) continue;
            var checkpoint = row.checkpoints[checkpointIndex++];
            var state = machine.Snapshot();
            assertProbePortable(state);
            var checks = new List<CheckResult>(checkpoint.checks.Count);
            foreach (var check in checkpoint.checks)
                checks.Add(EvaluateMachineCheck(check, state, events, profile));
            results.Add(new CheckpointResult(checkpoint.name, checkpoint.at, checks.AsReadOnly()));
        }
        return new MachineCaseResult(row.name, results.AsReadOnly());
    }

    private static void ApplyInitial(Machine machine, IReadOnlyList<AllocatedCord> cords)
    {
        foreach (var cord in cords)
        {
            var result = machine.Apply(new Command.Connect(
                cord.wireIndex, new CordEnd.Hole(cord.a.id), new CordEnd.Hole(cord.b.id)));
            if (result is CmdResult.Failure failure)
                throw new ProbeException("initial wire " + cord.wireIndex + " rejected: " + failure.why);
        }
    }

    private static void ExecuteAction(Machine machine, ProbeAction action, Profile profile, List<Event> events)
    {
        if (action is ProbeDoAction command)
        {
            var result = machine.Apply(command.cmd);
            if (result is CmdResult.Failure failure)
                throw new ProbeException("scenario command rejected: " + failure.why);
        }
        else if (action is ProbeAdvanceAction advance)
        {
            Advance(machine, advance.ticks, events);
        }
        else
        {
            SettleMachine(machine, ((ProbeSettleAction)action).maxTicks, checked((int)profile.v.settle_quiet_ticks), events);
        }
    }

    private static void ExecuteFixtureStep(Machine machine, ScriptStep step, Profile profile, List<Event> events)
    {
        if (step is ScriptStep.Do command)
        {
            var result = machine.Apply(command.cmd);
            if (result is CmdResult.Failure failure)
                throw new ProbeException("fixture command rejected: " + failure.why);
        }
        else if (step is ScriptStep.Advance advance)
        {
            Advance(machine, checked(advance.ms * 10), events);
        }
        else if (step is ScriptStep.Settle settle)
        {
            SettleMachine(machine, checked(settle.maxMs * 10), checked((int)profile.v.settle_quiet_ticks), events);
        }
        else if (step is ScriptStep.Until)
        {
            throw new ProbeException("fixture replay does not support until steps");
        }
    }

    private static void Advance(Machine machine, int ticks, List<Event> events)
    {
        machine.Advance(ticks);
        events.AddRange(machine.DrainEvents());
        assertProbePortable(machine.Snapshot());
    }

    private static void SettleMachine(Machine machine, int maxTicks, int quietTicks, List<Event> events)
    {
        var previous = (int[])machine.Observables().Clone();
        var quiet = 0;
        for (var waited = 1; waited <= maxTicks; waited++)
        {
            machine.Advance(1);
            events.AddRange(machine.DrainEvents());
            var after = machine.Observables();
            quiet = SameVector(previous, after) && machine.MotionMask() == 0 ? quiet + 1 : 0;
            previous = (int[])after.Clone();
            assertProbePortable(machine.Snapshot());
            if (quiet >= quietTicks) return;
        }
        throw new ProbeException("settle exhausted its cap of " + maxTicks + " ticks");
    }

    private static bool SameVector(IReadOnlyList<int> a, IReadOnlyList<int> b)
    {
        if (a.Count != b.Count) return false;
        for (var i = 0; i < a.Count; i++) if (a[i] != b[i]) return false;
        return true;
    }

    private static CheckResult EvaluateMachineCheck(
        ProbeCheck check,
        State state,
        IReadOnlyList<Event> events,
        Profile profile)
    {
        if (check is NearProbeCheck near)
        {
            var actual = ReadMachineNumber(near.read, state, profile);
            return new NearCheckResult(near.name, actual, near.expected, near.tolerance,
                Near(actual, near.expected, near.tolerance));
        }
        if (check is CompareProbeCheck compare)
        {
            var left = ReadMachineNumber(compare.left, state, profile);
            var right = compare.right is LiteralNumericOperand literal
                ? literal.value
                : ReadMachineNumber(((ReadNumericOperand)compare.right).read, state, profile);
            return new CompareCheckResult(compare.name, left, compare.op, right, Compare(left, compare.op, right));
        }
        if (check is BoolProbeCheck boolean)
        {
            var actual = boolean.read is StateBoolRead
                ? state.breakerTripped
                : state.relays[((RelayBoolRead)boolean.read).n - 1].held;
            return new BoolCheckResult(boolean.name, actual, boolean.expected, actual == boolean.expected);
        }
        var seen = (EventSeenProbeCheck)check;
        var count = EventCount(events, seen.@event);
        return new EventSeenCheckResult(seen.name, count, seen.expected, (count > 0) == seen.expected);
    }

    private static int ReadMachineNumber(NumericRead read, State state, Profile profile) => read switch
    {
        ProfileNumericRead value => ReadProfileValue(value.field, profile),
        StateNumericRead value => value.field == "railMv" ? state.railMv : state.supplyUa,
        RelayNumericRead value => ReadRelay(value, state.relays[value.n - 1]),
        LampNumericRead value => ReadLamp(value, value.kind == "out" ? state.outLamps[value.n - 1] : state.indLamps[value.n - 1]),
        TerminalPairMvRead value => ReadTerminalPair(value, state),
        _ => throw new ProbeException("machine received a non-machine numeric read"),
    };

    private static int ReadProfileValue(string field, Profile profile) => field switch
    {
        "ITripUa" => checked((int)profile.v.I_trip_ua),
        "tripDelayTicks" => profile.derived.tripDelayTicks,
        "pullInUa" => profile.derived.pullInUa,
        "dropOutUa" => profile.derived.dropOutUa,
        _ => throw new ProbeException("probe read an unknown profile field " + field),
    };

    private static int ReadRelay(RelayNumericRead read, State.Relay relay) => read.field switch
    {
        "travel" => relay.travel,
        "coilMv" => relay.coilMv,
        "coilUa" => relay.coilUa,
        "pullInUa" => relay.pullInUa,
        "dropOutUa" => relay.dropOutUa,
        "indicatorUa" => relay.indicatorUa,
        _ => throw new ProbeException("probe read an unknown relay field " + read.field),
    };

    private static int ReadLamp(LampNumericRead read, State.Lamp lamp) => read.field == "ua" ? lamp.ua : lamp.milli;

    private static int ReadTerminalPair(TerminalPairMvRead read, State state)
    {
        var a = state.terminalMv[Terminals.terminalIndex(Terminals.parseTerminalId(read.a))];
        var b = state.terminalMv[Terminals.terminalIndex(Terminals.parseTerminalId(read.b))];
        if (a is null || b is null)
            throw new ProbeException("terminalPairMv read is floating: " + read.a + "/" + read.b);
        var delta = (long)a.Value - b.Value;
        return checked((int)(delta < 0 ? -delta : delta));
    }

    private static int EventCount(IReadOnlyList<Event> events, EventSelector selector)
    {
        var count = 0;
        foreach (var @event in events)
        {
            if (@event.k != selector.k) continue;
            if (selector.n is not null)
            {
                var n = @event switch
                {
                    Event.RelayPullIn pullIn => pullIn.n,
                    Event.RelayDropOut dropOut => dropOut.n,
                    _ => -1,
                };
                if (n != selector.n.Value) continue;
            }
            count++;
        }
        return count;
    }

    private sealed record ProfileLoadState(
        int settledSupplyUa,
        int peakSupplyUa,
        int ticksOverTrip,
        int ITripUa,
        int tripDelayTicks,
        int pullInUa,
        int dropOutUa,
        IReadOnlyList<int> relayPullInUa,
        IReadOnlyList<int> relayDropOutUa);

    private static ProfileLoadCaseResult RunProfileCase(ProfileLoadCase row, Profile profile)
    {
        var state = RunProfileLoad(row.load, profile);
        var checks = new List<CheckResult>(row.checks.Count);
        foreach (var check in row.checks) checks.Add(EvaluateProfileCheck(check, state));
        return new ProfileLoadCaseResult(row.name, checks.AsReadOnly(), row.diagnostic);
    }

    private static ProfileLoadState RunProfileLoad(ProfileLoad load, Profile profile)
    {
        var elements = ProfileCircuit(load, profile);
        var carried = ColdStart(elements, profile);
        var cfg = SolveCfgFor(profile);
        var flags = new PortFlags();
        int[]? previous = null;
        var quiet = 0;
        var settledSupplyUa = 0;
        var peakSupplyUa = 0;
        var ticksOverTrip = 0;
        var overRun = true;
        var settled = false;
        for (var tick = 0; tick < profile.derived.settleCapTicks; tick++)
        {
            var result = Solve.tickSolve(elements, carried, cfg);
            if (result.nonPortable) flags.nonPortable = true;
            var currents = new int[elements.Count];
            for (var i = 0; i < currents.Length; i++)
                currents[i] = Ints.quantize(Math.Abs(result.branchI[i]), 1_000_000, flags);
            settledSupplyUa = currents[^1];
            if (settledSupplyUa > peakSupplyUa) peakSupplyUa = settledSupplyUa;
            if (overRun && Devices.breakerOverThreshold(settledSupplyUa, checked((int)profile.v.I_trip_ua)))
                ticksOverTrip++;
            else
                overRun = false;
            var same = previous is not null && SameVector(previous, currents);
            if (same) quiet++;
            else { quiet = 0; previous = currents; }
            if (quiet >= profile.v.settle_quiet_ticks) { settled = true; break; }
        }
        if (flags.nonPortable) throw new ProbeException("profileLoad marked the solve non-portable");
        if (!settled) throw new ProbeException("profileLoad settle exhausted its profile cap");
        return new ProfileLoadState(
            settledSupplyUa, peakSupplyUa, ticksOverTrip, checked((int)profile.v.I_trip_ua),
            profile.derived.tripDelayTicks, profile.derived.pullInUa, profile.derived.dropOutUa,
            profile.derived.relayPullInUa, profile.derived.relayDropOutUa);
    }

    private static IReadOnlyList<El> ProfileCircuit(ProfileLoad load, Profile profile)
    {
        const int minus = 0;
        const int plus = 1;
        var rCoil = profile.v.R_coil_uohm * 1e-6;
        var lCoil = profile.v.L_coil_uh * 1e-6;
        var elements = new List<El>();
        if (load.feed == "C")
        {
            for (var n = 0; n < load.coils; n++)
            {
                var e = 2 + n;
                elements.Add(new LampEl(plus, e));
                elements.Add(new CoilEl(e, minus, rCoil, lCoil));
            }
        }
        else
        {
            for (var n = 0; n < load.coils; n++) elements.Add(new CoilEl(plus, minus, rCoil, lCoil));
            for (var n = 0; n < load.coils; n++) elements.Add(new LampEl(plus, minus));
        }
        for (var n = 0; n < load.outputLamps; n++) elements.Add(new LampEl(plus, minus));
        elements.Add(new LampEl(plus, minus));
        elements.Add(new SourceEl(plus, minus, profile.v.V_oc_mv * 1e-3, profile.v.R_src_uohm * 1e-6));
        return elements.AsReadOnly();
    }

    private static Carried ColdStart(IReadOnlyList<El> elements, Profile profile)
    {
        var coils = 0;
        var lamps = 0;
        foreach (var element in elements)
        {
            if (element is CoilEl) coils++;
            else if (element is LampEl) lamps++;
        }
        var resistance = new double[lamps];
        Array.Fill(resistance, profile.v.R_cold_uohm * 1e-6);
        return new Carried(new double[coils], resistance);
    }

    private static SolveCfg SolveCfgFor(Profile profile)
    {
        var xs = new double[profile.pwl.Count];
        var ys = new double[profile.pwl.Count];
        for (var i = 0; i < profile.pwl.Count; i++)
        {
            xs[i] = profile.pwl[i][0] * 1e-6;
            ys[i] = profile.pwl[i][1] * 1e-6;
        }
        return new SolveCfg(
            profile.v.tick_us * 1e-6,
            profile.v.V_arc_clamp_mv * 1e-3,
            profile.derived.kThermal,
            profile.v.gmin_ns * 1e-9,
            new Pwl(xs, ys),
            0);
    }

    private static CheckResult EvaluateProfileCheck(ProbeCheck check, ProfileLoadState state)
    {
        if (check is NearProbeCheck near)
        {
            var actual = ReadProfileNumber(near.read, state);
            return new NearCheckResult(near.name, actual, near.expected, near.tolerance,
                Near(actual, near.expected, near.tolerance));
        }
        if (check is not CompareProbeCheck compare)
            throw new ProbeException("profileLoad received a non-numeric check");
        var left = ReadProfileNumber(compare.left, state);
        var right = compare.right is LiteralNumericOperand literal
            ? literal.value
            : ReadProfileNumber(((ReadNumericOperand)compare.right).read, state);
        return new CompareCheckResult(compare.name, left, compare.op, right, Compare(left, compare.op, right));
    }

    private static int ReadProfileNumber(NumericRead read, ProfileLoadState state) => read switch
    {
        LoadNumericRead value => value.field switch
        {
            "settledSupplyUa" => state.settledSupplyUa,
            "peakSupplyUa" => state.peakSupplyUa,
            _ => state.ticksOverTrip,
        },
        ProfileNumericRead value => value.field switch
        {
            "ITripUa" => state.ITripUa,
            "tripDelayTicks" => state.tripDelayTicks,
            "pullInUa" => state.pullInUa,
            _ => state.dropOutUa,
        },
        RelayThresholdNumericRead value => value.field == "pullInUa"
            ? state.relayPullInUa[value.n - 1]
            : state.relayDropOutUa[value.n - 1],
        _ => throw new ProbeException("profileLoad received a machine numeric read"),
    };

    private static bool Near(int actual, int expected, int tolerance)
    {
        var difference = (long)actual - expected;
        var magnitude = difference < 0 ? -difference : difference;
        return magnitude <= tolerance;
    }

    private static bool Compare(int left, string op, int right) => op switch
    {
        "lt" => left < right,
        "le" => left <= right,
        "eq" => left == right,
        "ge" => left >= right,
        "gt" => left > right,
        _ => throw new ProbeException("probe used an unknown compare operator " + op),
    };

    private static bool CasePass(ProbeCaseResult row)
    {
        if (row is ProfileLoadCaseResult profile)
        {
            foreach (var check in profile.checks) if (!check.pass) return false;
            return true;
        }
        foreach (var checkpoint in ((MachineCaseResult)row).checkpoints)
            foreach (var check in checkpoint.checks)
                if (!check.pass) return false;
        return true;
    }
}
