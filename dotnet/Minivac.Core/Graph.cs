using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;

namespace Minivac.Core;

public abstract record El
{
    protected El(int a, int b)
    {
        this.a = a;
        this.b = b;
    }

    public abstract string k { get; }
    public int a { get; internal set; }
    public int b { get; internal set; }
}

public sealed record CoilEl : El
{
    public CoilEl(int a, int b, double rOhm, double lH) : base(a, b)
    {
        this.rOhm = rOhm;
        this.lH = lH;
    }

    public override string k => "coil";
    public double rOhm { get; internal set; }
    public double lH { get; internal set; }
}

public sealed record LampEl : El
{
    public LampEl(int a, int b) : base(a, b)
    {
    }

    public override string k => "lamp";
}

public sealed record ResEl : El
{
    public ResEl(int a, int b, double rOhm) : base(a, b)
    {
        this.rOhm = rOhm;
    }

    public override string k => "res";
    public double rOhm { get; internal set; }
}

public sealed record SourceEl : El
{
    public SourceEl(int a, int b, double vOc, double rSrcOhm) : base(a, b)
    {
        this.vOc = vOc;
        this.rSrcOhm = rSrcOhm;
    }

    public override string k => "source";
    public double vOc { get; internal set; }
    public double rSrcOhm { get; internal set; }
}

public sealed class ResolvedCord : IEquatable<ResolvedCord>
{
    public ResolvedCord(int id, int a, int b, int? rUohm = null)
    {
        this.id = id;
        this.a = a;
        this.b = b;
        this.rUohm = rUohm;
    }

    public int id { get; internal set; }
    public int a { get; internal set; }
    public int b { get; internal set; }
    public int? rUohm { get; internal set; }

    public bool Equals(ResolvedCord? other) =>
        other is not null && id == other.id && a == other.a && b == other.b && rUohm == other.rUohm;

    public override bool Equals(object? obj) => obj is ResolvedCord other && Equals(other);

    public override int GetHashCode() => id;

    public static bool operator ==(ResolvedCord? left, ResolvedCord? right) => Equals(left, right);

    public static bool operator !=(ResolvedCord? left, ResolvedCord? right) => !Equals(left, right);
}

public sealed record GraphInput(IReadOnlyList<ResolvedCord> cords, IReadOnlyList<int> contactPosition);

public sealed record BuiltGraph(
    IReadOnlyList<El> elements,
    IReadOnlyList<string> elementIds,
    IReadOnlyList<short> nodeByTerminal,
    IReadOnlyList<IReadOnlyList<int>> members,
    IReadOnlyList<byte> inSource,
    int nodeCount,
    int datum,
    int sourceNode);

public sealed class GraphException : Exception
{
    public GraphException(string message) : base("graph: " + message)
    {
    }
}

public sealed class GraphWorkspace
{
    private readonly El[] Elements;
    private readonly string[] ElementIds;
    private readonly CoilEl[] CoilSlots;
    private readonly LampEl[] LampSlots;
    private readonly ResEl[] ResSlots;
    private readonly SourceEl[] SourceSlots;

    public GraphWorkspace()
    {
        Elements = new El[Graph.GRAPH_MAX_ELEMENTS];
        ElementIds = new string[Graph.GRAPH_MAX_ELEMENTS];
        CoilSlots = new CoilEl[Graph.GRAPH_MAX_ELEMENTS];
        LampSlots = new LampEl[Graph.GRAPH_MAX_ELEMENTS];
        ResSlots = new ResEl[Graph.GRAPH_MAX_ELEMENTS];
        SourceSlots = new SourceEl[Graph.GRAPH_MAX_ELEMENTS];
        _cordElementIds = new string[Graph.GRAPH_MAX_CORDS];
        for (var i = 0; i < Graph.GRAPH_MAX_ELEMENTS; i++)
        {
            CoilSlots[i] = new CoilEl(0, 0, 1, 0);
            LampSlots[i] = new LampEl(0, 0);
            ResSlots[i] = new ResEl(0, 0, 1);
            SourceSlots[i] = new SourceEl(0, 0, 0, 1);
            Elements[i] = ResSlots[i];
            ElementIds[i] = string.Empty;
        }
        for (var id = 0; id < Graph.GRAPH_MAX_CORDS; id++)
            _cordElementIds[id] = "cord:" + id.ToString(CultureInfo.InvariantCulture);

        elements = new ReadOnlyCollection<El>(Elements);
        elementIds = new ReadOnlyCollection<string>(ElementIds);
    }

    public IReadOnlyList<El> elements { get; }
    public IReadOnlyList<string> elementIds { get; }
    public short[] nodeByTerminal { get; } = new short[Graph.GRAPH_TERMINALS];
    public short[] memberOffsets { get; } = new short[Graph.GRAPH_MAX_NODES + 1];
    public short[] memberTerminals { get; } = new short[Graph.GRAPH_TERMINALS];
    public byte[] inSource { get; } = new byte[Graph.GRAPH_MAX_NODES];
    public int elementCount { get; internal set; }
    public int nodeCount { get; internal set; }
    public int datum { get; internal set; }
    public int sourceNode { get; internal set; }
    public bool sourceEnabled { get; internal set; }

    internal short[] _parent { get; } = new short[Graph.GRAPH_TERMINALS];
    internal short[] _size { get; } = new short[Graph.GRAPH_TERMINALS];
    internal short[] _rootMin { get; } = new short[Graph.GRAPH_TERMINALS];
    internal short[] _rootNode { get; } = new short[Graph.GRAPH_TERMINALS];
    internal short[] _memberCounts { get; } = new short[Graph.GRAPH_MAX_NODES];
    internal short[] _memberCursor { get; } = new short[Graph.GRAPH_MAX_NODES];
    internal byte[] _cordPresent { get; } = new byte[Graph.GRAPH_MAX_CORDS];
    internal short[] _cordA { get; } = new short[Graph.GRAPH_MAX_CORDS];
    internal short[] _cordB { get; } = new short[Graph.GRAPH_MAX_CORDS];
    internal int[] _cordR { get; } = new int[Graph.GRAPH_MAX_CORDS];
    internal string[] _cordElementIds { get; }

    internal void setElement(int index, El element, string id)
    {
        Elements[index] = element;
        ElementIds[index] = id;
    }

    internal CoilEl coilSlot(int index) => CoilSlots[index];
    internal LampEl lampSlot(int index) => LampSlots[index];
    internal ResEl resSlot(int index) => ResSlots[index];
    internal SourceEl sourceSlot(int index) => SourceSlots[index];
}

public static class Graph
{
    public const int CONTACT_OPEN = -1;
    public const int CONTACT_NC = 0;
    public const int CONTACT_NO = 1;

    public const int GRAPH_TERMINALS = 186;
    public const int GRAPH_MAX_NODES = 174;
    public const int GRAPH_MAX_ROWS = 173;
    public const int GRAPH_MAX_CORDS = 256;
    public const int GRAPH_FIXED_ELEMENTS = 22;
    public const int GRAPH_MAX_ELEMENTS = GRAPH_FIXED_ELEMENTS + GRAPH_MAX_CORDS;

    public static GraphWorkspace createGraphWorkspace() => new();

    public static GraphWorkspace buildGraphInto(
        LoadedNetlist netlist,
        Profile profile,
        GraphInput input,
        bool sourceEnabled,
        GraphWorkspace workspace)
    {
        if (netlist.terminals.Count != GRAPH_TERMINALS)
            Fail("loaded terminal count is not 186");
        // The 278 element slots are 22 fixed plus 256 cords; without this the fixed count is only
        // checked after BuildElementsInto has already written past the end of the slot array.
        if (netlist.elements.Count != GRAPH_FIXED_ELEMENTS)
            Fail("loaded fixed element count is not 22");
        ResetWorkspace(workspace);
        workspace.sourceEnabled = sourceEnabled;
        IndexCords(workspace, input.cords);
        UnionBusses(workspace, netlist);
        UnionIdealCords(workspace);
        UnionContacts(workspace, netlist, input.contactPosition);
        CanonicalNodesInto(workspace, netlist);
        BuildElementsInto(workspace, netlist, profile, workspace.nodeByTerminal);
        SourceComponentInto(workspace);
        return workspace;
    }

    public static BuiltGraph buildGraph(LoadedNetlist netlist, Profile profile, GraphInput input)
    {
        var workspace = buildGraphInto(netlist, profile, input, true, createGraphWorkspace());
        var elements = new El[workspace.elementCount];
        var elementIds = new string[workspace.elementCount];
        for (var i = 0; i < workspace.elementCount; i++)
        {
            elements[i] = CopyElement(workspace.elements[i]);
            elementIds[i] = workspace.elementIds[i];
        }

        var members = new IReadOnlyList<int>[workspace.nodeCount];
        for (var node = 0; node < workspace.nodeCount; node++)
        {
            var start = workspace.memberOffsets[node];
            var end = workspace.memberOffsets[node + 1];
            var row = new int[end - start];
            for (var i = start; i < end; i++)
                row[i - start] = workspace.memberTerminals[i];
            members[node] = Array.AsReadOnly(row);
        }

        var nodeByTerminal = new short[GRAPH_TERMINALS];
        Array.Copy(workspace.nodeByTerminal, nodeByTerminal, nodeByTerminal.Length);
        var inSource = new byte[workspace.nodeCount];
        Array.Copy(workspace.inSource, inSource, inSource.Length);

        return new BuiltGraph(
            Array.AsReadOnly(elements),
            Array.AsReadOnly(elementIds),
            Array.AsReadOnly(nodeByTerminal),
            Array.AsReadOnly(members),
            Array.AsReadOnly(inSource),
            workspace.nodeCount,
            workspace.datum,
            workspace.sourceNode);
    }

    private static void ResetWorkspace(GraphWorkspace workspace)
    {
        workspace.elementCount = 0;
        workspace.nodeCount = 0;
        workspace.datum = 0;
        workspace.sourceNode = 0;
        workspace.sourceEnabled = false;
        Array.Clear(workspace._cordPresent);
        for (var i = 0; i < GRAPH_TERMINALS; i++)
        {
            workspace._parent[i] = (short)i;
            workspace._size[i] = 1;
            workspace._rootMin[i] = -1;
            workspace._rootNode[i] = -1;
        }
    }

    private static int Find(GraphWorkspace workspace, int x)
    {
        var root = x;
        while (workspace._parent[root] != root)
            root = workspace._parent[root];
        while (workspace._parent[x] != x)
        {
            var next = workspace._parent[x];
            workspace._parent[x] = (short)root;
            x = next;
        }
        return root;
    }

    private static void Union(GraphWorkspace workspace, int a, int b)
    {
        var ra = Find(workspace, a);
        var rb = Find(workspace, b);
        if (ra == rb)
            return;
        var sa = workspace._size[ra];
        var sb = workspace._size[rb];
        if (sa < sb || (sa == sb && ra > rb))
            (ra, rb) = (rb, ra);
        workspace._parent[rb] = (short)ra;
        workspace._size[ra] = (short)(sa + sb);
    }

    private static void IndexCords(GraphWorkspace workspace, IReadOnlyList<ResolvedCord> cords)
    {
        if (cords.Count > GRAPH_MAX_CORDS)
            Fail("more than 256 cords");
        for (var i = 0; i < cords.Count; i++)
        {
            var cord = cords[i];
            if (cord is null)
                throw new GraphException("cord[" + i.ToString(CultureInfo.InvariantCulture) + "] must be a non-null object");
            if (cord.id < 0 || cord.id >= GRAPH_MAX_CORDS)
                Fail("cord[" + i.ToString(CultureInfo.InvariantCulture) + "].id must be 0..255");
            if (workspace._cordPresent[cord.id] == 1)
                Fail("duplicate cord id " + cord.id.ToString(CultureInfo.InvariantCulture));
            CheckTerminalIndex(cord.a, "cord " + cord.id.ToString(CultureInfo.InvariantCulture) + " end a");
            CheckTerminalIndex(cord.b, "cord " + cord.id.ToString(CultureInfo.InvariantCulture) + " end b");
            var r = cord.rUohm ?? 0;
            if (r < 0)
                Fail("cord " + cord.id.ToString(CultureInfo.InvariantCulture) + " rUohm must be int32 >= 0");
            workspace._cordPresent[cord.id] = 1;
            workspace._cordA[cord.id] = (short)cord.a;
            workspace._cordB[cord.id] = (short)cord.b;
            workspace._cordR[cord.id] = r;
        }
    }

    private static void CheckTerminalIndex(int index, string where)
    {
        if (index < -1 || index >= GRAPH_TERMINALS)
            Fail(where + " terminal index must be -1 or 0..185");
    }

    private static void UnionBusses(GraphWorkspace workspace, LoadedNetlist netlist)
    {
        var plus0 = Tid(netlist.plusMembers[0]);
        var minus0 = Tid(netlist.minusMembers[0]);
        for (var i = 1; i < netlist.plusMembers.Count; i++)
            Union(workspace, plus0, Tid(netlist.plusMembers[i]));
        for (var i = 1; i < netlist.minusMembers.Count; i++)
            Union(workspace, minus0, Tid(netlist.minusMembers[i]));
    }

    private static void UnionIdealCords(GraphWorkspace workspace)
    {
        for (var id = 0; id < GRAPH_MAX_CORDS; id++)
        {
            var a = workspace._cordA[id];
            var b = workspace._cordB[id];
            if (workspace._cordPresent[id] == 0 || a < 0 || b < 0 || workspace._cordR[id] > 0)
                continue;
            Union(workspace, a, b);
        }
    }

    private static void UnionContacts(GraphWorkspace workspace, LoadedNetlist netlist, IReadOnlyList<int> positions)
    {
        if (positions.Count != netlist.contacts.Count)
        {
            Fail("contactPosition length " + positions.Count.ToString(CultureInfo.InvariantCulture) + " != " +
                netlist.contacts.Count.ToString(CultureInfo.InvariantCulture));
        }
        for (var i = 0; i < netlist.contacts.Count; i++)
            UnionContact(workspace, netlist.contacts[i], positions[i], i);
    }

    private static void UnionContact(GraphWorkspace workspace, NetContact contact, int position, int index)
    {
        if (contact is WiperContactDef wiper)
        {
            if (position == CONTACT_OPEN)
                return;
            if (position < 0 || position >= wiper.pads.Count)
                Fail("wiper position must be -1 or 0..15");
            Union(workspace, Tid(wiper.arm), Tid(wiper.pads[position]));
            return;
        }

        if (position == CONTACT_OPEN)
            return;
        string arm;
        string nc;
        string no;
        switch (contact)
        {
            case RelayContactDef relay:
                (arm, nc, no) = (relay.arm, relay.nc, relay.no);
                break;
            case ButtonContactDef button:
                (arm, nc, no) = (button.arm, button.nc, button.no);
                break;
            case SlideContactDef slide:
                (arm, nc, no) = (slide.arm, slide.nc, slide.no);
                break;
            default:
                throw new InvalidOperationException("unknown contact type");
        }

        if (position == CONTACT_NC)
            Union(workspace, Tid(arm), Tid(nc));
        else if (position == CONTACT_NO)
            Union(workspace, Tid(arm), Tid(no));
        else
            Fail("transfer contact position must be -1, 0 or 1 at index " + index.ToString(CultureInfo.InvariantCulture));
    }

    private static void CanonicalNodesInto(GraphWorkspace workspace, LoadedNetlist netlist)
    {
        for (var terminal = 0; terminal < GRAPH_TERMINALS; terminal++)
        {
            var root = Find(workspace, terminal);
            if (workspace._rootMin[root] < 0)
                workspace._rootMin[root] = (short)terminal;
        }

        var datumRoot = Find(workspace, Tid(netlist.minusMembers[0]));
        var next = 0;
        for (var terminal = 0; terminal < GRAPH_TERMINALS; terminal++)
        {
            var root = Find(workspace, terminal);
            if (root != datumRoot && workspace._rootMin[root] == terminal)
            {
                workspace._rootNode[root] = (short)next;
                next++;
            }
        }

        var datum = next;
        workspace._rootNode[datumRoot] = (short)datum;
        var nodeCount = datum + 1;
        if (nodeCount > GRAPH_MAX_NODES)
            Fail("more than 174 panel nodes after union");
        if (datum > GRAPH_MAX_ROWS)
            Fail("more than 173 non-datum panel nodes");

        Array.Clear(workspace._memberCounts, 0, nodeCount);
        for (var terminal = 0; terminal < GRAPH_TERMINALS; terminal++)
        {
            var node = workspace._rootNode[Find(workspace, terminal)];
            if (node < 0)
                Fail("terminal " + terminal.ToString(CultureInfo.InvariantCulture) + " has no canonical node");
            workspace.nodeByTerminal[terminal] = node;
            workspace._memberCounts[node]++;
        }

        var offset = 0;
        for (var node = 0; node < nodeCount; node++)
        {
            workspace.memberOffsets[node] = (short)offset;
            workspace._memberCursor[node] = (short)offset;
            offset += workspace._memberCounts[node];
        }
        workspace.memberOffsets[nodeCount] = (short)offset;
        for (var terminal = 0; terminal < GRAPH_TERMINALS; terminal++)
        {
            var node = workspace.nodeByTerminal[terminal];
            var at = workspace._memberCursor[node];
            workspace.memberTerminals[at] = (short)terminal;
            workspace._memberCursor[node] = (short)(at + 1);
        }

        workspace.nodeCount = nodeCount;
        workspace.datum = datum;
    }

    private static void BuildElementsInto(GraphWorkspace workspace, LoadedNetlist netlist, Profile profile, short[] nodes)
    {
        var last = netlist.elements[^1];
        if (last is not SourceDef)
            Fail("fixed source is not last");

        var at = 0;
        for (var i = 0; i < netlist.elements.Count - 1; i++)
        {
            var def = netlist.elements[i];
            if (def is SourceDef)
                Fail("source appears before the final fixed element");
            SetFixedElement(workspace, at, def, profile, nodes);
            workspace.setElement(at, workspace.elements[at], def.id);
            at++;
        }

        for (var id = 0; id < GRAPH_MAX_CORDS; id++)
        {
            var a = workspace._cordA[id];
            var b = workspace._cordB[id];
            var rUohm = workspace._cordR[id];
            if (workspace._cordPresent[id] == 0 || a < 0 || b < 0 || rUohm == 0)
                continue;
            var element = workspace.resSlot(at);
            element.a = nodes[a];
            element.b = nodes[b];
            element.rOhm = rUohm * 1e-6;
            workspace.setElement(at, element, workspace._cordElementIds[id]);
            at++;
        }

        var source = workspace.sourceSlot(at);
        source.a = nodes[Tid(netlist.plusMembers[0])];
        source.b = nodes[Tid(netlist.minusMembers[0])];
        source.vOc = profile.v.V_oc_mv * 1e-3;
        source.rSrcOhm = profile.v.R_src_uohm * 1e-6;
        workspace.setElement(at, source, last.id);
        at++;
        if (at > GRAPH_MAX_ELEMENTS)
            Fail("more than 278 active elements");
        workspace.elementCount = at;
        workspace.sourceNode = source.a;
    }

    private static void SetFixedElement(GraphWorkspace workspace, int at, NetElement def, Profile profile, short[] nodes)
    {
        switch (def)
        {
            case LampDef lamp:
                var lampElement = workspace.lampSlot(at);
                lampElement.a = Endpoint(lamp.a, nodes);
                lampElement.b = Endpoint(lamp.b, nodes);
                workspace.setElement(at, lampElement, lamp.id);
                break;
            case CoilDef coil:
                var coilElement = workspace.coilSlot(at);
                coilElement.a = Endpoint(coil.a, nodes);
                coilElement.b = Endpoint(coil.b, nodes);
                coilElement.rOhm = profile.v.R_coil_uohm * 1e-6;
                coilElement.lH = profile.v.L_coil_uh * 1e-6;
                workspace.setElement(at, coilElement, coil.id);
                break;
            case ResDef resistor:
                var resElement = workspace.resSlot(at);
                resElement.a = Endpoint(resistor.a, nodes);
                resElement.b = Endpoint(resistor.b, nodes);
                resElement.rOhm = Resistance(profile, resistor.r) * 1e-6;
                workspace.setElement(at, resElement, resistor.id);
                break;
            default:
                throw new InvalidOperationException("unknown fixed element type");
        }
    }

    private static long Resistance(Profile profile, ResistanceKey key) => key switch
    {
        ResistanceKey.R1_uohm => profile.v.R1_uohm,
        ResistanceKey.R2_uohm => profile.v.R2_uohm,
        ResistanceKey.R_arm_uohm => profile.v.R_arm_uohm,
        _ => throw new InvalidOperationException("unknown resistance key"),
    };

    private static void SourceComponentInto(GraphWorkspace workspace)
    {
        Array.Clear(workspace.inSource, 0, workspace.nodeCount);
        if (!workspace.sourceEnabled)
            return;
        var source = (SourceEl)workspace.elements[workspace.elementCount - 1];
        workspace.inSource[source.a] = 1;
        workspace.inSource[source.b] = 1;
        var changed = true;
        while (changed)
        {
            changed = false;
            for (var i = 0; i < workspace.elementCount; i++)
            {
                var element = workspace.elements[i];
                if (workspace.inSource[element.a] == 1 && workspace.inSource[element.b] == 0)
                {
                    workspace.inSource[element.b] = 1;
                    changed = true;
                }
                else if (workspace.inSource[element.b] == 1 && workspace.inSource[element.a] == 0)
                {
                    workspace.inSource[element.a] = 1;
                    changed = true;
                }
            }
        }
    }

    private static El CopyElement(El element) => element switch
    {
        LampEl lamp => new LampEl(lamp.a, lamp.b),
        CoilEl coil => new CoilEl(coil.a, coil.b, coil.rOhm, coil.lH),
        ResEl resistor => new ResEl(resistor.a, resistor.b, resistor.rOhm),
        SourceEl source => new SourceEl(source.a, source.b, source.vOc, source.rSrcOhm),
        _ => throw new InvalidOperationException("unknown element type"),
    };

    private static int Endpoint(string id, short[] nodes) => nodes[Tid(id)];

    private static int Tid(string id) => Terminals.terminalIndex(id);

    private static void Fail(string message) => throw new GraphException(message);
}
