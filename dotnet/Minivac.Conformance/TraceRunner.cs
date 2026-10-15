using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using Minivac.Core;

namespace Minivac.Conformance;

public sealed record ExpectationFailure(int scriptIndex, string dev, string expected, string actual);

public sealed record Metrics(int? minDecisionUa, int? minTickGap);

public sealed record RunResult(
    LoadedFixture loaded,
    string trace,
    IReadOnlyList<ExpectationFailure> failures,
    Metrics metrics,
    ReviewedDigest digest);

public sealed class RunnerException : Exception
{
    public RunnerException(string message) : base("runner: " + message) { }
}

public static class TraceRunner
{
    public static RunResult RunLoadedFixture(LoadedFixture loaded)
    {
        var execution = new Execution(loaded);
        for (var index = 0; index < loaded.fixture.script.Count; index++)
        {
            var step = loaded.fixture.script[index];
            switch (step)
            {
                case ScriptStep.Do action:
                    execution.Apply(action);
                    break;
                case ScriptStep.Advance advance:
                    execution.Advance(checked(advance.ms * 10));
                    break;
                case ScriptStep.Settle settle:
                    execution.Settle(checked(settle.maxMs * 10));
                    break;
                case ScriptStep.Expect expectation:
                    execution.Expect(expectation.obs, expectation.quote, index);
                    break;
                case ScriptStep.Until until:
                    execution.Until(until, index);
                    break;
                default:
                    Fail("unknown script step discriminator");
                    break;
            }
        }
        return execution.Result();
    }

    public static RunResult RunFixture(IArtifactSource source, string relativePath) =>
        RunLoadedFixture(FixtureLoader.LoadFixture(source, relativePath));

    public static RunResult RunFixture(
        IArtifactSource source,
        string path,
        byte[] fixtureBytes) =>
        RunLoadedFixture(FixtureLoader.LoadFixture(source, path, fixtureBytes));

    public static string FixtureDisplayPath(string repositoryRoot, string path)
    {
        var fullRoot = Path.GetFullPath(repositoryRoot);
        var fullPath = Path.GetFullPath(path);
        var relative = Path.GetRelativePath(fullRoot, fullPath);
        if (relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            return path;
        return relative.Replace(Path.DirectorySeparatorChar, '/');
    }

    private static void Fail(string message) => throw new RunnerException(message);

    private static string F(int value) => value.ToString(CultureInfo.InvariantCulture);

    private sealed class Execution
    {
        private readonly LoadedFixture _loaded;
        private readonly Machine _machine;
        private readonly List<string> _body = [];
        private readonly List<ExpectationFailure> _failures = [];
        private readonly int[] _previous = new int[Trace.OBSERVABLE_COUNT];
        private readonly int[] _lastChange = new int[Trace.OBSERVABLE_COUNT];
        private readonly int[] _moverTransitions = new int[Trace.CHATTER_DEVICE_COUNT];
        private int? _minDecisionUa;
        private int? _minTickGap;
        private int _eventCount;
        private int _nextBoundaryTick;

        internal Execution(LoadedFixture loaded)
        {
            _loaded = loaded;
            _machine = Machine.CreateMachine(loaded.netlist, loaded.profile);
            ConnectInitialWiring();
            Copy33(_machine.Observables(), _previous);
            Array.Fill(_lastChange, -1);
            _nextBoundaryTick = _machine.Snapshot().tick;
        }

        internal void Advance(int ticks)
        {
            for (var index = 0; index < ticks; index++) AdvanceOne();
        }

        internal void Settle(int maxTicks)
        {
            var quiet = 0;
            var waited = 0;
            var boundaryTick = _nextBoundaryTick;
            while (waited < maxTicks)
            {
                var tick = AdvanceOne();
                boundaryTick = tick.BoundaryTick;
                waited++;
                if (!tick.Changed && _machine.MotionMask() == 0) quiet++;
                else quiet = 0;
                if (quiet >= _loaded.profile.v.settle_quiet_ticks) return;
            }
            _body.Add(Trace.formatAnomaly(boundaryTick, new TraceAnomaly.NoSettle(waited)));
        }

        internal void Apply(ScriptStep.Do action)
        {
            var acceptedAt = _machine.Snapshot().tick;
            var result = _machine.Apply(action.cmd);
            if (result is CmdResult.Failure failure)
                Fail("script command was rejected: " + failure.why);
            if (!result.ok) Fail("script command was rejected");
            _body.Add(Trace.formatCommand(acceptedAt, action.cmd));
        }

        /// <summary>
        /// until (architecture §13.5.1): match is tested before each tick, the cap after it, so a
        /// match on the cap tick is a match. Ticks run through AdvanceOne, the same path as advance
        /// and settle. The step then emits exactly the ? line an expect would at that moment, and on
        /// a timeout records the same failures. Mirrors Execution.until in test/conformance/run.ts.
        /// </summary>
        internal void Until(ScriptStep.Until step, int scriptIndex)
        {
            var indices = new int[step.obs.Count];
            var wanted = new int[step.obs.Count];
            for (var at = 0; at < step.obs.Count; at++)
            {
                indices[at] = FixtureSupport.ObservableIndex(step.obs[at].dev);
                wanted[at] = FixtureSupport.ExpectedEncoding(step.obs[at].dev, step.obs[at].v);
            }
            var cap = checked(step.maxMs * 10);
            var waited = 0;
            while (true)
            {
                var current = _machine.Observables();
                var matched = true;
                for (var at = 0; at < indices.Length && matched; at++)
                    matched = current[indices[at]] == wanted[at];
                if (matched) break;
                if (waited == cap) break;
                AdvanceOne();
                waited++;
            }
            Expect(step.obs, step.quote, scriptIndex);
        }

        internal void Expect(IReadOnlyList<ExpectedObservable> obs, string quote, int scriptIndex)
        {
            var current = _machine.Observables();
            var selected = new int[Trace.OBSERVABLE_COUNT];
            var included = new byte[Trace.OBSERVABLE_COUNT];
            foreach (var expectedObservable in obs)
            {
                var index = FixtureSupport.ObservableIndex(expectedObservable.dev);
                selected[index] = FixtureSupport.ExpectedEncoding(expectedObservable.dev, expectedObservable.v);
                included[index] = 1;
            }

            var payload = new System.Text.StringBuilder();
            for (var index = 0; index < Trace.OBSERVABLE_COUNT; index++)
            {
                if (included[index] == 0) continue;
                var row = Trace.OBSERVABLES[index];
                var actual = FixtureSupport.ObservableValue(index, current[index]);
                var expected = FixtureSupport.ObservableValue(index, selected[index]);
                if (payload.Length > 0) payload.Append(' ');
                payload.Append(row.name).Append('=').Append(actual);
                if (!string.Equals(actual, expected, StringComparison.Ordinal))
                    _failures.Add(new ExpectationFailure(scriptIndex, row.name, expected, actual));
            }
            _body.Add(Trace.formatMs(_machine.Snapshot().tick) + " ? " + payload + "  " +
                FixtureSupport.QuoteGolden(quote));
        }

        internal RunResult Result()
        {
            if (_machine.Snapshot().flags.nonPortable)
                Fail("Machine marked the trace non-portable");
            var metrics = new Metrics(_minDecisionUa, _minTickGap);
            var digest = new ReviewedDigest(_eventCount, Array.AsReadOnly((int[])_moverTransitions.Clone()));
            var headers = TraceHeaders(_loaded.fixture, _loaded.profile, _loaded.netlist.hash, metrics);
            var lines = new string[headers.Count + _body.Count];
            for (var index = 0; index < headers.Count; index++) lines[index] = headers[index];
            for (var index = 0; index < _body.Count; index++) lines[headers.Count + index] = _body[index];
            return new RunResult(
                _loaded,
                Trace.formatTrace(lines),
                _failures.AsReadOnly(),
                metrics,
                digest);
        }

        private void ConnectInitialWiring()
        {
            foreach (var cord in _loaded.cords)
            {
                var result = _machine.Apply(new Command.Connect(
                    cord.wireIndex,
                    new CordEnd.Hole(cord.a.id),
                    new CordEnd.Hole(cord.b.id)));
                if (result is CmdResult.Failure failure)
                    Fail("initial wire " + F(cord.wireIndex) + " was rejected: " + failure.why);
                if (!result.ok) Fail("initial wire " + F(cord.wireIndex) + " was rejected");
            }
        }

        private (int BoundaryTick, bool Changed) AdvanceOne()
        {
            _machine.Advance(1);
            var events = _machine.DrainEvents();
            var boundaryTick = _nextBoundaryTick;
            if (events.Length > 0)
            {
                boundaryTick = events[0].t;
                foreach (var item in events)
                {
                    if (item.t != boundaryTick)
                        Fail("one-tick drain returned mixed event timestamps");
                }
            }
            var epochRestart = RecordEvents(events);
            var after = _machine.Observables();
            var changed = RecordChanges(boundaryTick, after, epochRestart);
            var transition = Trace.formatTransitions(boundaryTick, _previous, after);
            if (transition is not null) _body.Add(transition);
            foreach (var item in events)
            {
                if (item is Event.Chatter chatter)
                {
                    _body.Add(Trace.formatAnomaly(chatter.t, new TraceAnomaly.Chatter(
                        chatter.dev,
                        chatter.transitions,
                        chatter.windowTicks,
                        chatter.quietTicks)));
                }
            }
            Copy33(after, _previous);
            _nextBoundaryTick = checked(boundaryTick + 1);
            return (boundaryTick, changed);
        }

        private bool RecordEvents(IReadOnlyList<Event> events)
        {
            if (_eventCount > int.MaxValue - events.Count) Fail("event digest exceeds int32");
            _eventCount += events.Count;
            var epochRestart = false;
            foreach (var item in events)
            {
                if (item is Event.PowerOn) epochRestart = true;
                int? marginUa = item switch
                {
                    Event.RelayPullIn pullIn => pullIn.marginUa,
                    Event.RelayDropOut dropOut => dropOut.marginUa,
                    _ => null,
                };
                if (marginUa is >= 0 && (_minDecisionUa is null || marginUa < _minDecisionUa))
                    _minDecisionUa = marginUa;
            }
            return epochRestart;
        }

        private bool RecordChanges(int boundaryTick, IReadOnlyList<int> after, bool epochRestart)
        {
            if (epochRestart) Array.Fill(_lastChange, -1);
            var changed = false;
            for (var index = 0; index < Trace.OBSERVABLE_COUNT; index++)
            {
                if (_previous[index] == after[index]) continue;
                changed = true;
                var priorTick = _lastChange[index];
                var gap = boundaryTick - priorTick;
                if (priorTick >= 0 && gap > 0 && (_minTickGap is null || gap < _minTickGap))
                    _minTickGap = gap;
                _lastChange[index] = boundaryTick;
                if (index >= Trace.MOVER_OBSERVABLE_START &&
                    index < Trace.MOVER_OBSERVABLE_START + Trace.CHATTER_DEVICE_COUNT)
                {
                    var mover = index - Trace.MOVER_OBSERVABLE_START;
                    if (_moverTransitions[mover] == int.MaxValue)
                        Fail("mover transition digest exceeds int32");
                    _moverTransitions[mover]++;
                }
            }
            return changed;
        }

        private static void Copy33(IReadOnlyList<int> source, int[] target)
        {
            if (source.Count != Trace.OBSERVABLE_COUNT)
                Fail("Machine.observables() did not return 33 entries");
            for (var index = 0; index < Trace.OBSERVABLE_COUNT; index++) target[index] = source[index];
        }
    }

    private static IReadOnlyList<string> TraceHeaders(
        Fixture fixture,
        Profile profile,
        string netlistHash,
        Metrics metrics)
    {
        var cycles = profile.v.chatter_cycles;
        var quietCycles = profile.v.chatter_quiet_cycles;
        return Array.AsReadOnly(new[]
        {
            "#!mv601-trace 1",
            "# id=" + fixture.id + " contract=" + fixture.contract + " netlist=fnv1a64:" + netlistHash +
                " profile=" + profile.id + "/fnv1a64:" + profile.hash + " wires=" + F(fixture.wires.Count),
            "# rules settleTicks=" + F(profile.v.settle_quiet_ticks) + " chatterN=" + F(profile.v.chatter_n) +
                " relayWinTicks=" + F(cycles * profile.derived.relayCycleTicks) +
                " relayQuietTicks=" + F(quietCycles * profile.derived.relayCycleTicks) +
                " buttonWinTicks=" + F(cycles * profile.derived.buttonCycleTicks) +
                " buttonQuietTicks=" + F(quietCycles * profile.derived.buttonCycleTicks) +
                " switchWinTicks=" + F(cycles * profile.derived.switchCycleTicks) +
                " switchQuietTicks=" + F(quietCycles * profile.derived.switchCycleTicks) +
                " dialWinTicks=" + F(cycles * profile.derived.dialCycleTicks) +
                " dialQuietTicks=" + F(quietCycles * profile.derived.dialCycleTicks),
            "# margins minDecisionUa=" + Metric(metrics.minDecisionUa) +
                " minTickGap=" + Metric(metrics.minTickGap) +
                " marginal=" + (fixture.marginal ? "true" : "false"),
        });
    }

    private static string Metric(int? value) => value is null ? "na" : F(value.Value);

    private static string F(long value) => value.ToString(CultureInfo.InvariantCulture);
}
