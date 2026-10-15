using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Emit;
using System.Text.Json;
using Minivac.Conformance;
using Xunit;

namespace Minivac.Core.Tests;

public sealed class MachineTraceSliceTests
{
    [Fact]
    public void Trace_formatter_emits_the_exact_contract_bytes()
    {
        Assert.Equal("     0.0", Trace.formatMs(0));
        Assert.Equal("214748364.7", Trace.formatMs(int.MaxValue));

        Command[] commands =
        [
            new Command.Power(true),
            new Command.Breaker(),
            new Command.Connect(7, new CordEnd.Hole("1A#1"), new CordEnd.Touch("2com")),
            new Command.Connect(8, new CordEnd.Free(), new CordEnd.Free(), 22_000_000),
            new Command.Disconnect(7),
            new Command.Button(6, 500),
            new Command.Switch(2, 1000),
            new Command.RelayGrab(1, 1000),
            new Command.RelayRelease(1),
            new Command.DialGrab(359_999_999),
            new Command.DialRelease(),
        ];
        Assert.Equal(
        [
            "    56.7 > power on",
            "    56.7 > breaker reset",
            "    56.7 > connect cord=7 a=hole:1A#1 b=touch:2com r_uohm=0",
            "    56.7 > connect cord=8 a=free b=free r_uohm=22000000",
            "    56.7 > disconnect cord=7",
            "    56.7 > button6 target=500",
            "    56.7 > switch2 target=1000",
            "    56.7 > relayGrab1 target=1000",
            "    56.7 > relayRelease1",
            "    56.7 > dialGrab targetUdeg=359999999",
            "    56.7 > dialRelease",
        ], Array.ConvertAll(commands, command => Trace.formatCommand(567, command)));

        var before = new int[Trace.OBSERVABLE_COUNT];
        var after = new int[Trace.OBSERVABLE_COUNT];
        after[0] = 1;
        after[1] = 1;
        for (var i = 2; i <= 19; i++) after[i] = 2;
        after[20] = -1;
        for (var i = 21; i < Trace.OBSERVABLE_COUNT; i++) after[i] = 2;
        var transition = Trace.formatTransitions(65, before, after);
        Assert.Equal(
            "     6.5 * power off->on  breaker ok->tripped" +
            "  relay1 nc->no  relay2 nc->no  relay3 nc->no  relay4 nc->no  relay5 nc->no  relay6 nc->no" +
            "  pb1 nc->no  pb2 nc->no  pb3 nc->no  pb4 nc->no  pb5 nc->no  pb6 nc->no" +
            "  sw1 nc->no  sw2 nc->no  sw3 nc->no  sw4 nc->no  sw5 nc->no  sw6 nc->no" +
            "  dial c0->gap" +
            "  outLamp1 off->on  outLamp2 off->on  outLamp3 off->on" +
            "  outLamp4 off->on  outLamp5 off->on  outLamp6 off->on" +
            "  indLamp1 off->on  indLamp2 off->on  indLamp3 off->on" +
            "  indLamp4 off->on  indLamp5 off->on  indLamp6 off->on",
            transition);

        Assert.Equal(
            "     0.7 ! relay3 chatter 9 transitions in 80.0ms — suppressed 240.0ms",
            Trace.formatAnomaly(7, new TraceAnomaly.Chatter(ChatterDev.relay3, 9, 800, 2400)));
        Assert.Equal(
            "   500.0 ! no settle in 500.0ms",
            Trace.formatAnomaly(5000, new TraceAnomaly.NoSettle(5000)));
        Assert.Equal("a\nb\n", Trace.formatTrace(["a", "b"]));
        Assert.Equal("\n", Trace.formatTrace(Array.Empty<string>()));
        Assert.Throws<TraceException>(() => Trace.formatTrace(["trailing "]));
        Assert.Throws<TraceException>(() => Trace.formatTrace(["embedded\nline"]));
        Assert.Throws<TraceException>(() => Trace.formatTrace(["carriage\rreturn"]));
        Assert.Throws<TraceException>(() => Trace.formatTrace(["\ufeffbom"]));
    }

    [Fact]
    public void Trace_observable_table_and_chatter_order_are_frozen()
    {
        Assert.Equal(33, Trace.OBSERVABLE_COUNT);
        Assert.Equal(
        [
            "power", "breaker",
            "relay1", "relay2", "relay3", "relay4", "relay5", "relay6",
            "pb1", "pb2", "pb3", "pb4", "pb5", "pb6",
            "sw1", "sw2", "sw3", "sw4", "sw5", "sw6", "dial",
            "outLamp1", "outLamp2", "outLamp3", "outLamp4", "outLamp5", "outLamp6",
            "indLamp1", "indLamp2", "indLamp3", "indLamp4", "indLamp5", "indLamp6",
        ], Array.ConvertAll(((List<ObservableDef>)new List<ObservableDef>(Trace.OBSERVABLES)).ToArray(), row => row.name));
        Assert.Equal(
        [
            ChatterDev.relay1, ChatterDev.relay2, ChatterDev.relay3,
            ChatterDev.relay4, ChatterDev.relay5, ChatterDev.relay6,
            ChatterDev.pb1, ChatterDev.pb2, ChatterDev.pb3,
            ChatterDev.pb4, ChatterDev.pb5, ChatterDev.pb6,
            ChatterDev.sw1, ChatterDev.sw2, ChatterDev.sw3,
            ChatterDev.sw4, ChatterDev.sw5, ChatterDev.sw6, ChatterDev.dial,
        ], Trace.CHATTER_DEVICES);

        var profile = LoadProfile();
        var chatter = Trace.createChatterWorkspace(profile);
        Assert.Equal(9, chatter.triggerTransitions);
        Assert.Equal([800, 800, 800, 800, 800, 800], chatter.windowTicks[..6]);
        Assert.Equal([2000, 2000, 2000, 2000, 2000, 2000], chatter.windowTicks[6..12]);
        Assert.Equal([4800, 4800, 4800, 4800, 4800, 4800], chatter.windowTicks[12..18]);
        Assert.Equal(3332, chatter.windowTicks[18]);

        var values = new int[Trace.OBSERVABLE_COUNT];
        Trace.resetChatter(chatter, values);
        for (var transition = 0; transition < 8; transition++)
        {
            values[2] = values[2] == 0 ? 1 : 0;
            Assert.Equal(0, Trace.updateChatter(transition * 99, values, chatter));
        }
        values[2] = values[2] == 0 ? 1 : 0;
        Assert.Equal(1, Trace.updateChatter(8 * 99, values, chatter));
    }

    [Fact]
    public void Machine_MM_RLY_CHECK_reproduces_both_printed_observable_states()
    {
        var machine = Machine.CreateMachine(LoadNetlist(), LoadProfile());
        (string A, string B)[] wires =
        [
            ("1+", "1H"), ("1+", "1L"), ("2+", "1Y"), ("1X", "1E"), ("1F", "1-"),
            ("1J", "1A"), ("1B", "1-"), ("1G", "2A"), ("2B", "2-"), ("1N", "3A"),
            ("3B", "3-"), ("1K", "4A"), ("4B", "4-"),
        ];
        for (var i = 0; i < wires.Length; i++)
        {
            var result = machine.Apply(new Command.Connect(
                i,
                new CordEnd.Touch(Terminals.parseTerminalId(wires[i].A)),
                new CordEnd.Touch(Terminals.parseTerminalId(wires[i].B))));
            Assert.True(result.ok);
        }

        Assert.True(machine.Apply(new Command.Power(true)).ok);
        machine.Advance(1000);
        var first = machine.Observables();
        Assert.Equal([2, 0, 2, 0], first[21..25]);
        Assert.Equal(0, first[27]);
        Assert.Equal(0, first[2]);

        Assert.True(machine.Apply(new Command.Button(1, 1000)).ok);
        machine.Advance(1001);
        var second = machine.Observables();
        Assert.Same(first, second);
        Assert.Equal([0, 2, 0, 2], second[21..25]);
        Assert.Equal(0, second[27]);
        Assert.Equal(2, second[2]);
    }

    // Twin of test/motor.spec.ts "a slide-switch reversal on a pad is not dial chatter": Book I printed
    // p.24 (PDF p.26) Exp 14 step 5, thrown on the c8 arrival as fixture C2/I-EXP14 does. The drive holds
    // through the slide stroke (TRANSFER-COAST-DEFER) and resumes reversed; architecture §9.2.
    [Fact]
    public void Machine_slide_switch_reversal_on_a_pad_is_not_dial_chatter()
    {
        var profile = LoadProfile();
        var machine = Machine.CreateMachine(LoadNetlist(), profile);
        (string A, string B)[] wires =
        [
            ("6+", "6R"), ("6+", "6W"), ("6-", "6T"), ("6T", "6U"), ("6S", "D18"), ("6V", "D17"),
        ];
        for (var i = 0; i < wires.Length; i++)
        {
            var result = machine.Apply(new Command.Connect(
                i,
                new CordEnd.Touch(Terminals.parseTerminalId(wires[i].A)),
                new CordEnd.Touch(Terminals.parseTerminalId(wires[i].B))));
            Assert.True(result.ok);
        }

        var rev = (int)((60_000_000L * 1000 + profile.v.run_mrpm * profile.v.tick_us - 1) /
            (profile.v.run_mrpm * profile.v.tick_us));
        Assert.True(machine.Apply(new Command.Power(true)).ok);
        machine.Advance(1);
        for (var t = 0; t < 2 * rev && machine.Snapshot().dial.contact != 8; t++) machine.Advance(1);
        Assert.Equal(8, machine.Snapshot().dial.contact);
        machine.DrainEvents();
        Assert.True(machine.Apply(new Command.Switch(6, 1000)).ok);
        machine.Advance(rev);
        Assert.DoesNotContain(machine.DrainEvents(), e => e is Event.Chatter);
        Assert.Empty(machine.Snapshot().flags.chattering);
    }

    // Twin of test/motor.spec.ts "a reversal-driven hunt is still dial chatter": relay 1, fed through the
    // dial, delays relay 2, whose transfer picks the motor's direction, so the dial hunts across pad 8.
    // Only the dial detector catches it; the reversal reseed is once per dial window (architecture §9.2).
    [Fact]
    public void Machine_reversal_driven_hunt_is_still_dial_chatter()
    {
        var profile = LoadProfile();
        var machine = Machine.CreateMachine(LoadNetlist(), profile);
        (string A, string B)[] wires =
        [
            ("D16", "1+"), ("D8", "1E"), ("1F", "1-"), ("1+", "1H"), ("1G", "2E"), ("2F", "2-"),
            ("2+", "2J"), ("2-", "2G"), ("2-", "2N"), ("2+", "2K"), ("2H", "D18"), ("2L", "D17"),
        ];
        for (var i = 0; i < wires.Length; i++)
        {
            var result = machine.Apply(new Command.Connect(
                i,
                new CordEnd.Touch(Terminals.parseTerminalId(wires[i].A)),
                new CordEnd.Touch(Terminals.parseTerminalId(wires[i].B))));
            Assert.True(result.ok);
        }

        var rev = (int)((60_000_000L * 1000 + profile.v.run_mrpm * profile.v.tick_us - 1) /
            (profile.v.run_mrpm * profile.v.tick_us));
        Assert.True(machine.Apply(new Command.Power(true)).ok);
        machine.Advance(1);
        machine.Advance(rev);
        var chatter = machine.DrainEvents().OfType<Event.Chatter>().Select(e => e.dev).ToArray();
        Assert.Equal([ChatterDev.dial], chatter);
        Assert.Equal([ChatterDev.dial], machine.Snapshot().flags.chattering);
    }

    [Fact]
    public void Machine_Advance_reachable_IL_has_only_authorized_allocation_sites()
    {
        var implementation = typeof(Machine).Assembly.GetType("Minivac.Core.MachineImpl", throwOnError: true)!;
        var entry = implementation.GetMethod(nameof(Machine.Advance), BindingFlags.Instance | BindingFlags.Public)!;
        var pending = new Stack<MethodBase>();
        var visited = new HashSet<MethodBase>();
        var allocations = new List<string>();
        pending.Push(entry);
        var delegateTargets = ConstructorDelegateTargets(implementation);
        var contactTarget = implementation.GetMethod("RecordContactEdge", BindingFlags.Instance | BindingFlags.NonPublic)!;
        var rotaryTarget = implementation.GetMethod("RecordRotaryEdge", BindingFlags.Instance | BindingFlags.NonPublic)!;
        Assert.Contains(contactTarget, delegateTargets);
        Assert.Contains(rotaryTarget, delegateTargets);
        foreach (var target in delegateTargets) pending.Push(target);

        while (pending.Count > 0)
        {
            var method = pending.Pop();
            if (!visited.Add(method)) continue;
            var body = method.GetMethodBody();
            if (body is null) continue;
            var bytes = body.GetILAsByteArray()!;
            for (var at = 0; at < bytes.Length;)
            {
                var opcode = ReadOpcode(bytes, ref at);
                var operandAt = at;
                at += OperandSize(opcode, bytes, operandAt);
                if (opcode != OpCodes.Call && opcode != OpCodes.Callvirt &&
                    opcode != OpCodes.Newobj && opcode != OpCodes.Newarr && opcode != OpCodes.Box) continue;
                if (opcode == OpCodes.Newarr)
                {
                    allocations.Add(Describe(method, "newarr"));
                    continue;
                }
                if (opcode == OpCodes.Box)
                {
                    var boxToken = BitConverter.ToInt32(bytes, operandAt);
                    allocations.Add(Describe(method, "box " + method.Module.ResolveType(boxToken).FullName));
                    continue;
                }
                var token = BitConverter.ToInt32(bytes, operandAt);
                MethodBase? target;
                try
                {
                    target = method.Module.ResolveMethod(token,
                        method.DeclaringType?.GetGenericArguments(),
                        method is MethodInfo info ? info.GetGenericArguments() : null);
                }
                catch (ArgumentException)
                {
                    continue;
                }
                if (target is null) continue;
                if (opcode == OpCodes.Newobj)
                {
                    var allocated = target.DeclaringType;
                    if (allocated is null ||
                        (!allocated.IsValueType &&
                         !typeof(Exception).IsAssignableFrom(allocated) &&
                         allocated.Name is not "PrimitivePage" and not "ChatterPage"))
                        allocations.Add(Describe(method, "new " + allocated?.FullName));
                    continue;
                }
                if (target.Module.Assembly == typeof(Machine).Assembly) pending.Push(target);
            }
        }

        Assert.Empty(allocations);
    }

    private static IReadOnlyList<MethodBase> ConstructorDelegateTargets(Type implementation)
    {
        var targets = new List<MethodBase>();
        foreach (var constructor in implementation.GetConstructors(
                     BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
        {
            var body = constructor.GetMethodBody();
            if (body is null) continue;
            var bytes = body.GetILAsByteArray()!;
            for (var at = 0; at < bytes.Length;)
            {
                var opcode = ReadOpcode(bytes, ref at);
                var operandAt = at;
                at += OperandSize(opcode, bytes, operandAt);
                if (opcode != OpCodes.Ldftn && opcode != OpCodes.Ldvirtftn) continue;
                var target = constructor.Module.ResolveMethod(BitConverter.ToInt32(bytes, operandAt));
                if (target is not null && target.Module.Assembly == typeof(Machine).Assembly)
                    targets.Add(target);
            }
        }
        return targets;
    }

    private static string Describe(MethodBase method, string allocation) =>
        method.DeclaringType?.FullName + "." + method.Name + ": " + allocation;

    private static OpCode ReadOpcode(byte[] bytes, ref int at)
    {
        var first = bytes[at++];
        if (first != 0xfe) return SingleByteOpcodes[first];
        return MultiByteOpcodes[bytes[at++]];
    }

    private static int OperandSize(OpCode opcode, byte[] bytes, int at) => opcode.OperandType switch
    {
        OperandType.InlineNone => 0,
        OperandType.ShortInlineBrTarget or OperandType.ShortInlineI or OperandType.ShortInlineVar => 1,
        OperandType.InlineVar => 2,
        OperandType.InlineI or OperandType.InlineBrTarget or OperandType.InlineField or
            OperandType.InlineMethod or OperandType.InlineSig or OperandType.InlineString or
            OperandType.InlineTok or OperandType.InlineType or OperandType.ShortInlineR => 4,
        OperandType.InlineI8 or OperandType.InlineR => 8,
        OperandType.InlineSwitch => 4 + 4 * BitConverter.ToInt32(bytes, at),
        _ => throw new InvalidOperationException("unknown IL operand type " + opcode.OperandType),
    };

    private static readonly OpCode[] SingleByteOpcodes = BuildOpcodes(false);
    private static readonly OpCode[] MultiByteOpcodes = BuildOpcodes(true);

    private static OpCode[] BuildOpcodes(bool multiByte)
    {
        var result = new OpCode[256];
        foreach (var field in typeof(OpCodes).GetFields(BindingFlags.Public | BindingFlags.Static))
        {
            var opcode = (OpCode)field.GetValue(null)!;
            var value = unchecked((ushort)opcode.Value);
            if (multiByte == (value > byte.MaxValue)) result[value & byte.MaxValue] = opcode;
        }
        return result;
    }

    private static LoadedNetlist LoadNetlist() =>
        Netlist.LoadNetlist(ArtifactSource().ReadAllBytes("data/netlist.json"));

    private static Profile LoadProfile()
    {
        using var document = JsonDocument.Parse(
            ArtifactSource().ReadAllBytes("data/profiles/MV601-REF-A.json"));
        return Profile.LoadProfile(document.RootElement);
    }

    private static IArtifactSource ArtifactSource() => new FileSystemSource(FindRepositoryRoot());

    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(Directory.GetCurrentDirectory());
             directory is not null;
             directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "package.json"))) return directory.FullName;
        }
        throw new InvalidOperationException("repository root not found");
    }
}
