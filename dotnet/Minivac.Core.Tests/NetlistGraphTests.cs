using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Minivac.Conformance;
using Xunit;

namespace Minivac.Core.Tests;

public sealed class NetlistGraphTests
{
    private static readonly string[] Manifest =
    [
        "I-EXP1", "I-EXP2", "I-EXP3", "I-EXP4", "I-EXP5", "I-EXP6", "I-EXP7",
        "I-EXP8", "I-EXP9", "I-EXP10", "I-EXP11", "I-EXP12", "I-EXP13", "I-EXP14",
        "II-EXP1", "II-EXP2", "II-EXP3", "II-MANUALMEM", "II-SELFLOCK", "II-2BUTTONMEM",
        "II-FF1", "II-EXP4", "II-EXP5", "II-EXP6", "II-EXP7",
        "III-3STMT", "III-ANDOR", "III-XOR-PB", "III-RELAYAND", "III-RELAYOR",
        "III-RELAYNOT", "III-RELAYXOR", "MM-PB-CHECK", "MM-RLY-CHECK", "MM-SW-CHECK",
        "SYN-HOLE-EXHAUSTION", "SYN-SAME-TERMINAL", "SYN-ALL-FLOATING-ISLAND",
        "SYN-RAILS-PREUNIONED-NO-CORD", "SYN-DATUM-NOT-LOWEST",
    ];

    public static IEnumerable<object[]> Cases()
    {
        for (var i = 0; i < Manifest.Length; i++)
            yield return [i, Manifest[i]];
    }

    [Fact]
    public void fixed_tables_and_netlist_match_the_frozen_shape()
    {
        var netlist = LoadNetlist();
        Assert.Equal(186, Terminals.TERMINAL_COUNT);
        Assert.Equal(392, Terminals.HOLE_COUNT);
        Assert.Equal(186, netlist.terminals.Count);
        Assert.Equal(187, netlist.holePrefixes.Count);
        Assert.Equal(392, netlist.holePrefixes[^1]);
        Assert.Equal(["1+", "2+", "3+", "4+", "5+", "6+", "M+"], netlist.plusMembers);
        Assert.Equal(["1-", "2-", "3-", "4-", "5-", "6-", "M-"], netlist.minusMembers);
        Assert.Equal(22, netlist.elements.Count);
        Assert.Equal(31, netlist.contacts.Count);
        Assert.Equal("2354ceebf3f8c566", netlist.hash);
    }

    [Fact]
    public void terminal_grammar_and_hole_allocation_match_the_source()
    {
        Assert.Equal("1A", Terminals.parseTerminalId("1A"));
        Assert.Equal(new TerminalWire("1+", "1A"), Terminals.parseTerminalWire("1+/1A"));
        Assert.Equal(new HoleRef("M10#6", "M10", 6, 345), Terminals.parseHoleId("M10#6"));
        Assert.Equal(Terminals.HOLE_COUNT - 1, Terminals.holeByIndex(Terminals.HOLE_COUNT - 1).index);

        // terminals.ts reports an oversized hole number as a RANGE error, not a syntax error, and
        // the CLI compares that stderr byte for byte.
        var oversized = Assert.Throws<TerminalsException>(() => Terminals.parseHoleId("1A#9999999999"));
        Assert.Equal("terminals: hole out of range for \"1A\": 9999999999", oversized.Message);
        Assert.Throws<TerminalsException>(() => Terminals.parseHoleId("1A#1\n"));
        Assert.Throws<TerminalsException>(() => Terminals.parseProgramDesignator("\u03a9_123\n"));
        Assert.Throws<TerminalsException>(() => Terminals.parseProgramDesignator("\u03a9_B1\n"));

        var same = Terminals.AllocateHoles([new TerminalWire("1A", "1A")]);
        Assert.Equal("1A#1", same[0].a.id);
        Assert.Equal("1A#2", same[0].b.id);

        var error = Assert.Throws<HoleAllocationException>(() => Terminals.AllocateHoles(
            [new TerminalWire("1A", "2A"), new TerminalWire("1A", "3A"), new TerminalWire("1A", "4A")]));
        Assert.Equal("hole_occupied", error.Code);
        Assert.Equal(2, error.WireIndex);
        Assert.Equal("1A", error.Terminal);

        foreach (var invalid in new[]
                 {
                     "M10t", "M10b", "M11t", "M11b", "1D", "1I", "1M", "1O", "1P", "1Q",
                     "Q", "Ω", "Ω_1", "Ω_B1", "PLUS", "MINUS", "D20", "M0t", "0A", "7A", "1a", "1 A",
                 })
        {
            Assert.Throws<TerminalsException>(() => Terminals.parseTerminalId(invalid));
        }
    }

    [Fact]
    public void LoadNetlist_hashes_raw_bytes_and_accepts_duplicate_keys_with_last_value_winning()
    {
        var bytes = ArtifactSource().ReadAllBytes("data/netlist.json");
        var original = Netlist.LoadNetlist(bytes);
        var changed = new byte[bytes.Length + 1];
        changed[0] = bytes[0];
        changed[1] = 0x20;
        Array.Copy(bytes, 1, changed, 2, bytes.Length - 1);
        var whitespace = Netlist.LoadNetlist(changed);
        Assert.NotEqual(original.hash, whitespace.hash);
        Assert.Equal(original.elements.Select(ElementKey), whitespace.elements.Select(ElementKey));

        var text = Encoding.ASCII.GetString(bytes);
        var duplicate = text.Replace(
            "  \"schema\": \"minivac.netlist/1\",",
            "  \"schema\": \"bad\",\n  \"schema\": \"minivac.netlist/1\",",
            StringComparison.Ordinal);
        Assert.Equal(Netlist.NETLIST_SCHEMA, Netlist.LoadNetlist(Encoding.ASCII.GetBytes(duplicate)).schema);
    }

    [Fact]
    public void graph_preserves_fixed_then_cord_id_then_source_element_order_and_values()
    {
        var profile = LoadProfile();
        var a = Terminals.terminalIndex("1com");
        var b = Terminals.terminalIndex("2com");
        var graph = Graph.buildGraph(LoadNetlist(), profile, new GraphInput(
            [new ResolvedCord(9, a, b, 9000), new ResolvedCord(2, a, b, 2000), new ResolvedCord(7, a, b, 7000)],
            Enumerable.Repeat(Graph.CONTACT_OPEN, 31).ToArray()));

        Assert.Equal(
            [
                "out1", "ind1", "coil1", "out2", "ind2", "coil2", "out3", "ind3", "coil3",
                "out4", "ind4", "coil4", "out5", "ind5", "coil5", "out6", "ind6", "coil6",
                "R1", "R2", "MOT", "cord:2", "cord:7", "cord:9", "PSU",
            ],
            graph.elementIds);

        var expectedElements = new List<El>();
        for (var section = 1; section <= 6; section++)
        {
            expectedElements.Add(new LampEl(Node(graph, section + "A"), Node(graph, section + "B")));
            expectedElements.Add(new LampEl(Node(graph, section + "C"), Node(graph, section + "E")));
            expectedElements.Add(new CoilEl(
                Node(graph, section + "E"), Node(graph, section + "F"),
                profile.v.R_coil_uohm * 1e-6, profile.v.L_coil_uh * 1e-6));
        }
        expectedElements.Add(new ResEl(Node(graph, "D17"), Node(graph, "D19"), profile.v.R1_uohm * 1e-6));
        expectedElements.Add(new ResEl(Node(graph, "D18"), Node(graph, "D19"), profile.v.R2_uohm * 1e-6));
        expectedElements.Add(new ResEl(Node(graph, "D18"), Node(graph, "D19"), profile.v.R_arm_uohm * 1e-6));
        expectedElements.Add(new ResEl(graph.nodeByTerminal[a], graph.nodeByTerminal[b], 2000 * 1e-6));
        expectedElements.Add(new ResEl(graph.nodeByTerminal[a], graph.nodeByTerminal[b], 7000 * 1e-6));
        expectedElements.Add(new ResEl(graph.nodeByTerminal[a], graph.nodeByTerminal[b], 9000 * 1e-6));
        expectedElements.Add(new SourceEl(
            Node(graph, "1+"), Node(graph, "1-"),
            profile.v.V_oc_mv * 1e-3, profile.v.R_src_uohm * 1e-6));
        Assert.Equal(expectedElements.Count, graph.elements.Count);
        for (var element = 0; element < expectedElements.Count; element++)
            Assert.Equal(expectedElements[element], graph.elements[element]);
    }

    [Fact]
    public void netlist_literal_unions_are_closed_and_exhaustive()
    {
        Assert.Equal([NetElementKind.lamp, NetElementKind.coil, NetElementKind.res, NetElementKind.source], Enum.GetValues<NetElementKind>());
        Assert.Equal([NetContactKind.relay, NetContactKind.button, NetContactKind.slide, NetContactKind.wiper], Enum.GetValues<NetContactKind>());
        Assert.Equal([LampCurve.lamp6435], Enum.GetValues<LampCurve>());
        Assert.Equal([ResDrive.dial], Enum.GetValues<ResDrive>());
        Assert.Equal([ResistanceKey.R1_uohm, ResistanceKey.R2_uohm, ResistanceKey.R_arm_uohm], Enum.GetValues<ResistanceKey>());
        Assert.Equal([SourceTerminal.PLUS, SourceTerminal.MINUS], Enum.GetValues<SourceTerminal>());

        var netlist = LoadNetlist();
        Assert.All(netlist.elements.OfType<LampDef>(), lamp => Assert.Equal(LampCurve.lamp6435, lamp.curve));
        Assert.Equal(12, netlist.elements.OfType<LampDef>().Count());
        Assert.Equal(6, netlist.elements.OfType<CoilDef>().Count());
        var resistors = netlist.elements.OfType<ResDef>().ToArray();
        Assert.Equal([ResistanceKey.R1_uohm, ResistanceKey.R2_uohm, ResistanceKey.R_arm_uohm], resistors.Select(resistor => resistor.r));
        Assert.Equal([null, null, ResDrive.dial], resistors.Select(resistor => resistor.drives));
        var source = Assert.Single(netlist.elements.OfType<SourceDef>());
        Assert.Equal(SourceTerminal.PLUS, source.a);
        Assert.Equal(SourceTerminal.MINUS, source.b);
        Assert.Equal(Netlist.NETLIST_SCHEMA, netlist.schema);
        Assert.Equal(
            Enumerable.Range(0, 6).SelectMany(_ => new[]
            {
                NetContactKind.relay, NetContactKind.relay, NetContactKind.button,
                NetContactKind.slide, NetContactKind.slide,
            }).Append(NetContactKind.wiper),
            netlist.contacts.Select(contact => contact.k));
    }

    [Theory]
    [InlineData("\"k\": \"lamp\"", "\"k\": \"capacitor\"")]
    [InlineData("\"curve\": \"lamp6435\"", "\"curve\": \"linear\"")]
    [InlineData("\"r\": \"R1_uohm\"", "\"r\": \"R3_uohm\"")]
    [InlineData("\"drives\": \"dial\"", "\"drives\": \"motor\"")]
    [InlineData("\"a\": \"PLUS\"", "\"a\": \"MINUS\"")]
    [InlineData("\"b\": \"MINUS\"", "\"b\": \"PLUS\"")]
    [InlineData("\"k\": \"relay\"", "\"k\": \"toggle\"")]
    public void LoadNetlist_rejects_every_value_outside_a_literal_union(string from, string to)
    {
        var source = Encoding.ASCII.GetString(ArtifactSource().ReadAllBytes("data/netlist.json"));
        var changed = source.Replace(from, to, StringComparison.Ordinal);
        Assert.NotEqual(source, changed);
        Assert.Throws<NetlistException>(() => Netlist.LoadNetlist(Encoding.ASCII.GetBytes(changed)));
    }

    [Fact]
    public void netlist_literal_union_bases_are_externally_closed_and_discriminators_are_get_only()
    {
        AssertClosedUnion(
            typeof(NetElement),
            [typeof(LampDef), typeof(CoilDef), typeof(ResDef), typeof(SourceDef)]);
        AssertClosedUnion(
            typeof(NetContact),
            [typeof(RelayContactDef), typeof(ButtonContactDef), typeof(SlideContactDef), typeof(WiperContactDef)]);

        foreach (var type in new[]
                 {
                     typeof(NetElement), typeof(LampDef), typeof(CoilDef), typeof(ResDef), typeof(SourceDef),
                     typeof(NetContact), typeof(RelayContactDef), typeof(ButtonContactDef),
                     typeof(SlideContactDef), typeof(WiperContactDef),
                 })
        {
            foreach (var property in type.GetProperties(BindingFlags.Instance | BindingFlags.Public))
                Assert.Null(property.SetMethod);
        }

        Assert.Equal(NetElementKind.lamp, new LampDef("test", "1A", "1B").k);
        Assert.Equal(NetElementKind.coil, new CoilDef("test", "1E", "1F", 1).k);
        Assert.Equal(NetElementKind.res, new ResDef("test", "D17", "D19", ResistanceKey.R1_uohm).k);
        Assert.Equal(NetElementKind.source, new SourceDef("test").k);
        Assert.Equal(NetContactKind.relay, new RelayContactDef(1, 1, "1H", "1J", "1G").k);
        Assert.Equal(NetContactKind.button, new ButtonContactDef(1, "1Y", "1Z", "1X").k);
        Assert.Equal(NetContactKind.slide, new SlideContactDef(1, 1, "1S", "1R", "1T").k);
        Assert.Equal(NetContactKind.wiper, new WiperContactDef("D16", ["D0"]).k);
    }

    [Fact]
    public void graph_workspace_reuses_fixed_buffers_and_disabled_source_marks_every_node_floating()
    {
        var workspace = Graph.createGraphWorkspace();
        var elements = workspace.elements;
        var elementIds = workspace.elementIds;
        var nodes = workspace.nodeByTerminal;
        var offsets = workspace.memberOffsets;
        var members = workspace.memberTerminals;
        var source = workspace.inSource;
        var input = new GraphInput([], Enumerable.Repeat(Graph.CONTACT_OPEN, 31).ToArray());

        Graph.buildGraphInto(LoadNetlist(), LoadProfile(), input, true, workspace);
        Assert.Equal(174, workspace.nodeCount);
        Assert.Equal(22, workspace.elementCount);
        var firstElement = workspace.elements[0];
        Graph.buildGraphInto(LoadNetlist(), LoadProfile(), input, false, workspace);

        Assert.Same(elements, workspace.elements);
        Assert.Same(firstElement, workspace.elements[0]);
        Assert.Same(elementIds, workspace.elementIds);
        Assert.Same(nodes, workspace.nodeByTerminal);
        Assert.Same(offsets, workspace.memberOffsets);
        Assert.Same(members, workspace.memberTerminals);
        Assert.Same(source, workspace.inSource);
        Assert.False(workspace.sourceEnabled);
        Assert.All(workspace.inSource.Take(workspace.nodeCount), value => Assert.Equal(0, value));
    }

    [Fact]
    public void resolved_cord_retains_public_construction_readable_shape_and_value_semantics()
    {
        var cord = new ResolvedCord(7, 12, -1, 9000);
        Assert.Equal(7, cord.id);
        Assert.Equal(12, cord.a);
        Assert.Equal(-1, cord.b);
        Assert.Equal(9000, cord.rUohm);
        Assert.Equal(new ResolvedCord(7, 12, -1, 9000), cord);
        Assert.True(new ResolvedCord(7, 12, -1, 9000) == cord);
        Assert.False(new ResolvedCord(8, 12, -1, 9000) == cord);

        var type = typeof(ResolvedCord);
        Assert.True(type.IsSealed);
        foreach (var propertyName in new[] { "id", "a", "b", "rUohm" })
        {
            var property = type.GetProperty(propertyName, BindingFlags.Instance | BindingFlags.Public);
            Assert.NotNull(property);
            Assert.True(property.GetMethod!.IsPublic);
            Assert.True(property.SetMethod!.IsAssembly);
        }
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void netlist_kat_case_reproduces_exact_holes_partitions_and_floating_sets(int caseIndex, string expectedId)
    {
        using var kat = JsonDocument.Parse(ArtifactSource().ReadAllBytes("data/kat/netlist-kat.json"));
        Assert.Equal("minivac.netlist-kat/1", kat.RootElement.GetProperty("schema").GetString());
        var cases = kat.RootElement.GetProperty("cases");
        Assert.Equal(40, cases.GetArrayLength());
        var fixture = cases[caseIndex];
        Assert.Equal(expectedId, fixture.GetProperty("id").GetString());

        var wiresElement = fixture.GetProperty("wires");
        var terminalWires = new TerminalWire[wiresElement.GetArrayLength()];
        var resolvedCords = new ResolvedCord[wiresElement.GetArrayLength()];
        var wireIndex = 0;
        foreach (var wire in wiresElement.EnumerateArray())
        {
            Assert.Equal(wireIndex, wire.GetProperty("id").GetInt32());
            var a = Terminals.parseTerminalId(wire.GetProperty("a").GetString()!);
            var b = Terminals.parseTerminalId(wire.GetProperty("b").GetString()!);
            terminalWires[wireIndex] = new TerminalWire(a, b);
            resolvedCords[wireIndex] = new ResolvedCord(
                wireIndex,
                Terminals.terminalIndex(a),
                Terminals.terminalIndex(b),
                wire.TryGetProperty("r_uohm", out var resistance) ? resistance.GetInt32() : null);
            wireIndex++;
        }

        var expected = fixture.GetProperty("expect");
        if (expected.GetProperty("k").GetString() == "error")
        {
            var error = Assert.Throws<HoleAllocationException>(() => Terminals.AllocateHoles(terminalWires));
            Assert.Equal(expected.GetProperty("why").GetString(), error.Code);
            Assert.Equal(expected.GetProperty("wire").GetInt32(), error.WireIndex);
            return;
        }

        var allocated = Terminals.AllocateHoles(terminalWires);
        AssertHoles(expected.GetProperty("holes"), allocated);
        var graph = Graph.buildGraph(LoadNetlist(), LoadProfile(), new GraphInput(
            resolvedCords,
            ContactPositions(fixture.GetProperty("movers"), fixture.GetProperty("wiper").GetInt32())));
        AssertCanonicalGraph(expected.GetProperty("partition"), graph);
        AssertFloating(expected.GetProperty("floating"), graph);
    }

    private static void AssertHoles(JsonElement expected, IReadOnlyList<AllocatedCord> actual)
    {
        Assert.Equal(expected.GetArrayLength(), actual.Count);
        var i = 0;
        foreach (var row in expected.EnumerateArray())
        {
            Assert.Equal(row.GetProperty("id").GetInt32(), actual[i].wireIndex);
            Assert.Equal(row.GetProperty("a").GetString(), actual[i].a.id);
            Assert.Equal(row.GetProperty("b").GetString(), actual[i].b.id);
            i++;
        }
    }

    private static void AssertCanonicalGraph(JsonElement expected, BuiltGraph graph)
    {
        var ordered = new List<int[]>();
        int[]? datumMembers = null;
        foreach (var expectedGroup in expected.EnumerateArray())
        {
            var members = expectedGroup.EnumerateArray()
                .Select(value => Terminals.terminalIndex(value.GetString()!))
                .ToArray();
            if (members.Contains(Terminals.terminalIndex("1-")))
                datumMembers = members;
            else
                ordered.Add(members);
        }
        Assert.NotNull(datumMembers);
        ordered.Add(datumMembers);

        Assert.Equal(ordered.Count - 1, graph.datum);
        Assert.Equal(graph.datum, graph.nodeCount - 1);
        Assert.Equal(ordered.Count, graph.nodeCount);
        Assert.Equal(ordered.Count, graph.members.Count);
        for (var node = 0; node < ordered.Count; node++)
            Assert.Equal(ordered[node], graph.members[node]);

        var expectedNodeByTerminal = new short[Terminals.TERMINAL_COUNT];
        for (var node = 0; node < ordered.Count; node++)
        {
            foreach (var terminal in ordered[node])
                expectedNodeByTerminal[terminal] = (short)node;
        }
        Assert.Equal(expectedNodeByTerminal, graph.nodeByTerminal);
        Assert.Equal(expectedNodeByTerminal[Terminals.terminalIndex("1+")], graph.sourceNode);
    }

    private static void AssertFloating(JsonElement expected, BuiltGraph graph)
    {
        var actual = graph.members
            .Where((_group, node) => graph.inSource[node] == 0)
            .Select(group => Terminals.TERMINAL_IDS[group[0]])
            .ToArray();
        Assert.Equal(expected.EnumerateArray().Select(value => value.GetString()), actual);
    }

    private static int[] ContactPositions(JsonElement movers, int wiper)
    {
        var relays = movers.GetProperty("relays").EnumerateArray().Select(value => value.GetInt32()).ToArray();
        var buttons = movers.GetProperty("buttons").EnumerateArray().Select(value => value.GetInt32()).ToArray();
        var switches = movers.GetProperty("switches").EnumerateArray().Select(value => value.GetInt32()).ToArray();
        var result = new int[31];
        for (var section = 0; section < 6; section++)
        {
            result[section * 5] = relays[section] / 1000;
            result[(section * 5) + 1] = relays[section] / 1000;
            result[(section * 5) + 2] = buttons[section] / 1000;
            result[(section * 5) + 3] = switches[section] / 1000;
            result[(section * 5) + 4] = switches[section] / 1000;
        }
        result[30] = wiper;
        return result;
    }

    private static LoadedNetlist LoadNetlist() =>
        Netlist.LoadNetlist(ArtifactSource().ReadAllBytes("data/netlist.json"));

    private static Profile LoadProfile()
    {
        using var document = JsonDocument.Parse(ArtifactSource().ReadAllBytes("data/profiles/MV601-REF-A.json"));
        return Profile.LoadProfile(document.RootElement);
    }

    private static FileSystemSource ArtifactSource() => new(FindRepositoryRoot());

    private static int Node(BuiltGraph graph, string terminal) =>
        graph.nodeByTerminal[Terminals.terminalIndex(terminal)];

    private static void AssertClosedUnion(Type baseType, IReadOnlyList<Type> variants)
    {
        Assert.True(baseType.IsAbstract);
        Assert.Empty(baseType.GetConstructors(BindingFlags.Instance | BindingFlags.Public));
        Assert.All(
            baseType.GetConstructors(BindingFlags.Instance | BindingFlags.NonPublic),
            constructor => Assert.True(constructor.IsFamilyAndAssembly));
        Assert.Equal(
            variants.OrderBy(type => type.FullName, StringComparer.Ordinal),
            baseType.Assembly.GetTypes()
                .Where(type => type.BaseType == baseType)
                .OrderBy(type => type.FullName, StringComparer.Ordinal));
        Assert.All(variants, variant => Assert.True(variant.IsSealed));
        Assert.Null(baseType.GetProperty("k")!.SetMethod);
    }

    private static string ElementKey(NetElement element) => element switch
    {
        LampDef lamp => string.Join(':', lamp.k, lamp.id, lamp.a, lamp.b, lamp.curve),
        CoilDef coil => string.Join(':', coil.k, coil.id, coil.a, coil.b, coil.relay.ToString(CultureInfo.InvariantCulture)),
        ResDef resistor => string.Join(':', resistor.k, resistor.id, resistor.a, resistor.b, resistor.r, resistor.drives),
        SourceDef source => string.Join(':', source.k, source.id, source.a, source.b),
        _ => throw new InvalidOperationException("unknown element type"),
    };

    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "package.json")) && Directory.Exists(Path.Combine(directory.FullName, "data")))
                return directory.FullName;
        }
        throw new InvalidOperationException("repository root not found");
    }
}
