using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.Json;

namespace Minivac.Core;

public enum ResistanceKey
{
    R1_uohm,
    R2_uohm,
    R_arm_uohm,
}

public enum NetElementKind
{
    lamp,
    coil,
    res,
    source,
}

public enum LampCurve
{
    lamp6435,
}

public enum ResDrive
{
    dial,
}

public enum SourceTerminal
{
    PLUS,
    MINUS,
}

public enum NetContactKind
{
    relay,
    button,
    slide,
    wiper,
}

public abstract class NetElement
{
    private protected NetElement(NetElementKind k, string id)
    {
        this.k = k;
        this.id = id;
    }

    public NetElementKind k { get; }
    public string id { get; }
}

public sealed class LampDef : NetElement
{
    public LampDef(string id, string a, string b) : base(NetElementKind.lamp, id)
    {
        this.a = a;
        this.b = b;
    }

    public string a { get; }
    public string b { get; }
    public LampCurve curve => LampCurve.lamp6435;
}

public sealed class CoilDef : NetElement
{
    public CoilDef(string id, string a, string b, int relay) : base(NetElementKind.coil, id)
    {
        this.a = a;
        this.b = b;
        this.relay = relay;
    }

    public string a { get; }
    public string b { get; }
    public int relay { get; }
}

public sealed class ResDef : NetElement
{
    public ResDef(string id, string a, string b, ResistanceKey r, ResDrive? drives = null) : base(NetElementKind.res, id)
    {
        this.a = a;
        this.b = b;
        this.r = r;
        this.drives = drives;
    }

    public string a { get; }
    public string b { get; }
    public ResistanceKey r { get; }
    public ResDrive? drives { get; }
}

public sealed class SourceDef : NetElement
{
    public SourceDef(string id) : base(NetElementKind.source, id)
    {
    }

    public SourceTerminal a => SourceTerminal.PLUS;
    public SourceTerminal b => SourceTerminal.MINUS;
}

public abstract class NetContact
{
    private protected NetContact(NetContactKind k) => this.k = k;

    public NetContactKind k { get; }
}

public sealed class RelayContactDef : NetContact
{
    public RelayContactDef(int n, int set, string arm, string nc, string no) : base(NetContactKind.relay)
    {
        this.n = n;
        this.set = set;
        this.arm = arm;
        this.nc = nc;
        this.no = no;
    }

    public int n { get; }
    public int set { get; }
    public string arm { get; }
    public string nc { get; }
    public string no { get; }
}

public sealed class ButtonContactDef : NetContact
{
    public ButtonContactDef(int n, string arm, string nc, string no) : base(NetContactKind.button)
    {
        this.n = n;
        this.arm = arm;
        this.nc = nc;
        this.no = no;
    }

    public int n { get; }
    public string arm { get; }
    public string nc { get; }
    public string no { get; }
}

public sealed class SlideContactDef : NetContact
{
    public SlideContactDef(int n, int set, string arm, string nc, string no) : base(NetContactKind.slide)
    {
        this.n = n;
        this.set = set;
        this.arm = arm;
        this.nc = nc;
        this.no = no;
    }

    public int n { get; }
    public int set { get; }
    public string arm { get; }
    public string nc { get; }
    public string no { get; }
}

public sealed class WiperContactDef : NetContact
{
    public WiperContactDef(string arm, IReadOnlyList<string> pads) : base(NetContactKind.wiper)
    {
        this.arm = arm;
        this.pads = pads;
    }

    public string arm { get; }
    public IReadOnlyList<string> pads { get; }
}

public sealed record LoadedNetlist
{
    internal LoadedNetlist(
        string hash,
        IReadOnlyList<TerminalDef> terminals,
        IReadOnlyList<string> terminalIds,
        IReadOnlyList<int> holePrefixes,
        IReadOnlyList<string> plusMembers,
        IReadOnlyList<string> minusMembers,
        IReadOnlyList<NetElement> elements,
        IReadOnlyList<NetContact> contacts)
    {
        this.hash = hash;
        this.terminals = terminals;
        this.terminalIds = terminalIds;
        this.holePrefixes = holePrefixes;
        this.plusMembers = plusMembers;
        this.minusMembers = minusMembers;
        this.elements = elements;
        this.contacts = contacts;
    }

    public string schema => Netlist.NETLIST_SCHEMA;
    public string hash { get; }
    public IReadOnlyList<TerminalDef> terminals { get; }
    public IReadOnlyList<string> terminalIds { get; }
    public IReadOnlyList<int> holePrefixes { get; }
    public IReadOnlyList<string> plusMembers { get; }
    public IReadOnlyList<string> minusMembers { get; }
    public IReadOnlyList<NetElement> elements { get; }
    public IReadOnlyList<NetContact> contacts { get; }
}

public sealed class NetlistException : Exception
{
    public NetlistException(string message) : base("netlist: " + message)
    {
    }
}

public static class Netlist
{
    public const string NETLIST_SCHEMA = "minivac.netlist/1";

    private const int TERMINAL_COUNT = 186;
    private const int HOLE_COUNT = 392;
    private const int BASE_NODE_COUNT = 174;
    private const int ELEMENT_COUNT = 22;
    private const int CONTACT_COUNT = 31;
    private const long MAX_SAFE_INTEGER = 9_007_199_254_740_991;

    public static LoadedNetlist LoadNetlist(byte[] rawBytes)
    {
        ArgumentNullException.ThrowIfNull(rawBytes);
        var bytes = (byte[])rawBytes.Clone();
        var hash = Ints.fnv1a64(bytes);
        using var document = ParseJson(bytes);
        var raw = Object(document.RootElement, "document");
        ExactKeys(raw, ["schema", "terminals", "bus", "elements", "contacts"], "document");
        if (String(raw.GetProperty("schema"), "schema") != NETLIST_SCHEMA)
            Fail("schema must be " + JsonSerializer.Serialize(NETLIST_SCHEMA));

        LoadTerminals(raw.GetProperty("terminals"));
        var bus = Object(raw.GetProperty("bus"), "bus");
        ExactKeys(bus, ["PLUS", "MINUS"], "bus");
        var plusMembers = LoadBus(bus.GetProperty("PLUS"), "PLUS");
        var minusMembers = LoadBus(bus.GetProperty("MINUS"), "MINUS");
        for (var i = 0; i < plusMembers.Count; i++)
        {
            for (var j = 0; j < minusMembers.Count; j++)
            {
                if (plusMembers[i] == minusMembers[j])
                    Fail(plusMembers[i] + " belongs to both power busses");
            }
        }

        if (TERMINAL_COUNT - plusMembers.Count - minusMembers.Count + 2 != BASE_NODE_COUNT)
            Fail("base node count is not 174");

        return new LoadedNetlist(
            hash,
            Terminals.TERMINALS,
            Terminals.TERMINAL_IDS,
            Terminals.HOLE_PREFIXES,
            plusMembers,
            minusMembers,
            LoadElements(raw.GetProperty("elements")),
            LoadContacts(raw.GetProperty("contacts")));
    }

    private static JsonDocument ParseJson(byte[] bytes)
    {
        var chars = new char[bytes.Length];
        for (var i = 0; i < bytes.Length; i++)
        {
            if (bytes[i] > 0x7f)
                Fail("byte " + i.ToString(CultureInfo.InvariantCulture) + " is not ASCII");
            chars[i] = (char)bytes[i];
        }

        try
        {
            return JsonDocument.Parse(new string(chars));
        }
        catch (JsonException)
        {
            Fail("invalid JSON");
            throw;
        }
    }

    private static void LoadTerminals(JsonElement raw)
    {
        if (raw.ValueKind != JsonValueKind.Array)
            Fail("terminals must be an array");
        if (raw.GetArrayLength() != TERMINAL_COUNT)
            Fail("terminals count " + raw.GetArrayLength().ToString(CultureInfo.InvariantCulture) + " != 186");
        if (Terminals.TERMINALS.Count != TERMINAL_COUNT || Terminals.TERMINAL_IDS.Count != TERMINAL_COUNT)
            Fail("frozen terminal table count is not 186");
        if (Terminals.HOLE_PREFIXES.Count != TERMINAL_COUNT + 1)
            Fail("frozen hole-prefix table must have 187 entries");

        var index = 0;
        foreach (var item in raw.EnumerateArray())
        {
            var where = "terminals[" + index.ToString(CultureInfo.InvariantCulture) + "]";
            var row = Object(item, where);
            ExactKeys(row, ["id", "holes"], where);
            var id = Terminal(row.GetProperty("id"), where + ".id");
            var holes = Integer(row.GetProperty("holes"), where + ".holes");
            var frozen = Terminals.TERMINALS[index];
            if (id != frozen.id || id != Terminals.TERMINAL_IDS[index])
                Fail(where + ".id " + JsonSerializer.Serialize(id) + " != frozen " + JsonSerializer.Serialize(frozen.id));
            if (holes != frozen.holes)
                Fail(id + " holes " + holes.ToString(CultureInfo.InvariantCulture) + " != frozen " + frozen.holes.ToString(CultureInfo.InvariantCulture));
            if (frozen.index != index || Terminals.terminalIndex(id) != index)
                Fail(id + " frozen index is not " + index.ToString(CultureInfo.InvariantCulture));
            if (frozen.holePrefix != Terminals.HOLE_PREFIXES[index])
                Fail(id + " frozen hole prefix disagrees with HOLE_PREFIXES");
            index++;
        }

        if (Terminals.HOLE_PREFIXES[TERMINAL_COUNT] != HOLE_COUNT)
            Fail("frozen hole count is not 392");
    }

    private static IReadOnlyList<string> LoadBus(JsonElement raw, string name)
    {
        if (raw.ValueKind != JsonValueKind.Array)
            Fail("bus." + name + " must be an array");
        if (raw.GetArrayLength() != 7)
            Fail("bus." + name + " must have 7 members");

        var result = new string[7];
        var i = 0;
        foreach (var item in raw.EnumerateArray())
        {
            var id = Terminal(item, "bus." + name + "[" + i.ToString(CultureInfo.InvariantCulture) + "]");
            var expected = i < 6
                ? SectionTerminal(i + 1, name == "PLUS" ? "+" : "-")
                : Terminals.parseTerminalId("M" + (name == "PLUS" ? "+" : "-"));
            if (id != expected)
                Fail("bus." + name + "[" + i.ToString(CultureInfo.InvariantCulture) + "] must be " + JsonSerializer.Serialize(expected));
            result[i] = id;
            i++;
        }

        return Array.AsReadOnly(result);
    }

    private static IReadOnlyList<NetElement> LoadElements(JsonElement raw)
    {
        if (raw.ValueKind != JsonValueKind.Array)
            Fail("elements must be an array");
        if (raw.GetArrayLength() != ELEMENT_COUNT)
            Fail("elements count " + raw.GetArrayLength().ToString(CultureInfo.InvariantCulture) + " != 22");

        var result = new NetElement[ELEMENT_COUNT];
        var i = 0;
        foreach (var item in raw.EnumerateArray())
        {
            var where = "elements[" + i.ToString(CultureInfo.InvariantCulture) + "]";
            var row = Object(item, where);
            var k = String(Property(row, "k", where), where + ".k");
            var id = String(Property(row, "id", where), where + ".id");
            switch (k)
            {
                case "lamp":
                    ExactKeys(row, ["k", "id", "a", "b", "curve"], where);
                    if (String(row.GetProperty("curve"), where + ".curve") != "lamp6435")
                        Fail(where + ".curve must be \"lamp6435\"");
                    result[i] = new LampDef(id, Terminal(row.GetProperty("a"), where + ".a"),
                        Terminal(row.GetProperty("b"), where + ".b"));
                    break;
                case "coil":
                    ExactKeys(row, ["k", "id", "a", "b", "relay"], where);
                    var relay = Integer(row.GetProperty("relay"), where + ".relay");
                    if (relay < 1 || relay > 6)
                        Fail(where + ".relay must be 1..6");
                    result[i] = new CoilDef(id, Terminal(row.GetProperty("a"), where + ".a"),
                        Terminal(row.GetProperty("b"), where + ".b"), relay);
                    break;
                case "res":
                    var hasDrives = row.TryGetProperty("drives", out var drivesElement);
                    ExactKeys(row, hasDrives ? ["k", "id", "a", "b", "r", "drives"] : ["k", "id", "a", "b", "r"], where);
                    var r = String(row.GetProperty("r"), where + ".r") switch
                    {
                        "R1_uohm" => ResistanceKey.R1_uohm,
                        "R2_uohm" => ResistanceKey.R2_uohm,
                        "R_arm_uohm" => ResistanceKey.R_arm_uohm,
                        _ => InvalidResistanceKey(where),
                    };
                    ResDrive? drives = null;
                    if (hasDrives)
                    {
                        var drivesText = String(drivesElement, where + ".drives");
                        if (drivesText != "dial")
                            Fail(where + ".drives must be \"dial\"");
                        drives = ResDrive.dial;
                    }
                    result[i] = new ResDef(id, Terminal(row.GetProperty("a"), where + ".a"),
                        Terminal(row.GetProperty("b"), where + ".b"), r, drives);
                    break;
                case "source":
                    ExactKeys(row, ["k", "id", "a", "b"], where);
                    if (String(row.GetProperty("a"), where + ".a") != "PLUS" ||
                        String(row.GetProperty("b"), where + ".b") != "MINUS")
                        Fail(where + " must span PLUS to MINUS");
                    result[i] = new SourceDef(id);
                    if (i != ELEMENT_COUNT - 1)
                        Fail("source element must be last");
                    break;
                default:
                    Fail(where + ".k is unknown: " + JsonSerializer.Serialize(k));
                    break;
            }

            SameApprovedElement(result[i], ExpectedElement(i), where);
            i++;
        }

        return Array.AsReadOnly(result);
    }

    private static IReadOnlyList<NetContact> LoadContacts(JsonElement raw)
    {
        if (raw.ValueKind != JsonValueKind.Array)
            Fail("contacts must be an array");
        if (raw.GetArrayLength() != CONTACT_COUNT)
            Fail("contacts count " + raw.GetArrayLength().ToString(CultureInfo.InvariantCulture) + " != 31");

        var result = new NetContact[CONTACT_COUNT];
        var i = 0;
        foreach (var item in raw.EnumerateArray())
        {
            var where = "contacts[" + i.ToString(CultureInfo.InvariantCulture) + "]";
            var row = Object(item, where);
            var k = String(Property(row, "k", where), where + ".k");
            switch (k)
            {
                case "relay":
                case "slide":
                    ExactKeys(row, ["k", "n", "set", "arm", "nc", "no"], where);
                    var n = Integer(row.GetProperty("n"), where + ".n");
                    var set = Integer(row.GetProperty("set"), where + ".set");
                    if (n < 1 || n > 6)
                        Fail(where + ".n must be 1..6");
                    if (set is not 1 and not 2)
                        Fail(where + ".set must be 1 or 2");
                    var arm = Terminal(row.GetProperty("arm"), where + ".arm");
                    var nc = Terminal(row.GetProperty("nc"), where + ".nc");
                    var no = Terminal(row.GetProperty("no"), where + ".no");
                    result[i] = k == "relay"
                        ? new RelayContactDef(n, set, arm, nc, no)
                        : new SlideContactDef(n, set, arm, nc, no);
                    break;
                case "button":
                    ExactKeys(row, ["k", "n", "arm", "nc", "no"], where);
                    var button = Integer(row.GetProperty("n"), where + ".n");
                    if (button < 1 || button > 6)
                        Fail(where + ".n must be 1..6");
                    result[i] = new ButtonContactDef(button,
                        Terminal(row.GetProperty("arm"), where + ".arm"),
                        Terminal(row.GetProperty("nc"), where + ".nc"),
                        Terminal(row.GetProperty("no"), where + ".no"));
                    break;
                case "wiper":
                    ExactKeys(row, ["k", "arm", "pads"], where);
                    var padsElement = row.GetProperty("pads");
                    if (padsElement.ValueKind != JsonValueKind.Array || padsElement.GetArrayLength() != 16)
                        Fail(where + ".pads must contain 16 terminals");
                    var pads = new string[16];
                    var p = 0;
                    foreach (var pad in padsElement.EnumerateArray())
                    {
                        pads[p] = Terminal(pad, where + ".pads[" + p.ToString(CultureInfo.InvariantCulture) + "]");
                        p++;
                    }
                    result[i] = new WiperContactDef(Terminal(row.GetProperty("arm"), where + ".arm"), Array.AsReadOnly(pads));
                    break;
                default:
                    Fail(where + ".k is unknown: " + JsonSerializer.Serialize(k));
                    break;
            }

            SameApprovedContact(result[i], ExpectedContact(i), where);
            i++;
        }

        return Array.AsReadOnly(result);
    }

    private static NetElement ExpectedElement(int index)
    {
        if (index < 18)
        {
            var section = (index / 3) + 1;
            return (index % 3) switch
            {
                0 => new LampDef("out" + section.ToString(CultureInfo.InvariantCulture), SectionTerminal(section, "A"), SectionTerminal(section, "B")),
                1 => new LampDef("ind" + section.ToString(CultureInfo.InvariantCulture), SectionTerminal(section, "C"), SectionTerminal(section, "E")),
                _ => new CoilDef("coil" + section.ToString(CultureInfo.InvariantCulture), SectionTerminal(section, "E"), SectionTerminal(section, "F"), section),
            };
        }

        return index switch
        {
            18 => new ResDef("R1", Terminals.parseTerminalId("D17"), Terminals.parseTerminalId("D19"), ResistanceKey.R1_uohm),
            19 => new ResDef("R2", Terminals.parseTerminalId("D18"), Terminals.parseTerminalId("D19"), ResistanceKey.R2_uohm),
            20 => new ResDef("MOT", Terminals.parseTerminalId("D18"), Terminals.parseTerminalId("D19"), ResistanceKey.R_arm_uohm, ResDrive.dial),
            _ => new SourceDef("PSU"),
        };
    }

    private static NetContact ExpectedContact(int index)
    {
        if (index == 30)
        {
            var pads = new string[16];
            for (var pad = 0; pad < pads.Length; pad++)
                pads[pad] = Terminals.parseTerminalId("D" + pad.ToString(CultureInfo.InvariantCulture));
            return new WiperContactDef(Terminals.parseTerminalId("D16"), Array.AsReadOnly(pads));
        }

        var section = (index / 5) + 1;
        return (index % 5) switch
        {
            0 => new RelayContactDef(section, 1, SectionTerminal(section, "H"), SectionTerminal(section, "J"), SectionTerminal(section, "G")),
            1 => new RelayContactDef(section, 2, SectionTerminal(section, "L"), SectionTerminal(section, "N"), SectionTerminal(section, "K")),
            2 => new ButtonContactDef(section, SectionTerminal(section, "Y"), SectionTerminal(section, "Z"), SectionTerminal(section, "X")),
            3 => new SlideContactDef(section, 1, SectionTerminal(section, "S"), SectionTerminal(section, "R"), SectionTerminal(section, "T")),
            _ => new SlideContactDef(section, 2, SectionTerminal(section, "V"), SectionTerminal(section, "U"), SectionTerminal(section, "W")),
        };
    }

    private static void SameApprovedElement(NetElement actual, NetElement expected, string where)
    {
        var matches = (actual, expected) switch
        {
            (LampDef got, LampDef want) => got.id == want.id && got.a == want.a && got.b == want.b && got.curve == want.curve,
            (CoilDef got, CoilDef want) => got.id == want.id && got.a == want.a && got.b == want.b && got.relay == want.relay,
            (ResDef got, ResDef want) => got.id == want.id && got.a == want.a && got.b == want.b && got.r == want.r && got.drives == want.drives,
            (SourceDef got, SourceDef want) => got.id == want.id && got.a == want.a && got.b == want.b,
            _ => false,
        };
        if (!matches)
            Fail(where + " does not match the approved topology");
    }

    private static void SameApprovedContact(NetContact actual, NetContact expected, string where)
    {
        if (actual is WiperContactDef gotWiper && expected is WiperContactDef wantWiper)
        {
            if (gotWiper.arm != wantWiper.arm || gotWiper.pads.Count != wantWiper.pads.Count)
                Fail(where + " does not match the approved topology");
            for (var i = 0; i < gotWiper.pads.Count; i++)
            {
                if (gotWiper.pads[i] != wantWiper.pads[i])
                    Fail(where + ".pads[" + i.ToString(CultureInfo.InvariantCulture) + "] must be " + JsonSerializer.Serialize(wantWiper.pads[i]));
            }
            return;
        }

        var matches = (actual, expected) switch
        {
            (RelayContactDef got, RelayContactDef want) =>
                got.n == want.n && got.set == want.set && got.arm == want.arm && got.nc == want.nc && got.no == want.no,
            (ButtonContactDef got, ButtonContactDef want) =>
                got.n == want.n && got.arm == want.arm && got.nc == want.nc && got.no == want.no,
            (SlideContactDef got, SlideContactDef want) =>
                got.n == want.n && got.set == want.set && got.arm == want.arm && got.nc == want.nc && got.no == want.no,
            _ => false,
        };
        if (!matches)
            Fail(where + " does not match the approved topology");
    }

    private static string SectionTerminal(int section, string suffix) =>
        Terminals.parseTerminalId(section.ToString(CultureInfo.InvariantCulture) + suffix);

    private static ResistanceKey InvalidResistanceKey(string where)
    {
        Fail(where + ".r is not a resistance profile key");
        throw new InvalidOperationException();
    }

    private static JsonElement Object(JsonElement value, string where)
    {
        if (value.ValueKind != JsonValueKind.Object)
            Fail(where + " must be an object");
        return value;
    }

    private static JsonElement Property(JsonElement value, string name, string where)
    {
        if (!value.TryGetProperty(name, out var property))
            Fail("missing required key " + JsonSerializer.Serialize(name) + " in " + where);
        return property;
    }

    private static void ExactKeys(JsonElement value, IReadOnlyList<string> allowed, string where)
    {
        foreach (var property in value.EnumerateObject())
        {
            var found = false;
            for (var i = 0; i < allowed.Count; i++)
            {
                if (property.Name == allowed[i])
                {
                    found = true;
                    break;
                }
            }
            if (!found)
                Fail("unknown key " + JsonSerializer.Serialize(property.Name) + " in " + where);
        }

        for (var i = 0; i < allowed.Count; i++)
        {
            if (!value.TryGetProperty(allowed[i], out _))
                Fail("missing required key " + JsonSerializer.Serialize(allowed[i]) + " in " + where);
        }
    }

    private static string String(JsonElement value, string where)
    {
        if (value.ValueKind != JsonValueKind.String)
            Fail(where + " must be a non-empty string");
        var result = value.GetString();
        if (string.IsNullOrEmpty(result))
            Fail(where + " must be a non-empty string");
        return result!;
    }

    private static int Integer(JsonElement value, string where)
    {
        if (value.ValueKind != JsonValueKind.Number)
            Fail(where + " must be a safe integer");
        var number = value.GetDouble();
        if (!double.IsFinite(number) || number % 1 != 0 || number < -MAX_SAFE_INTEGER || number > MAX_SAFE_INTEGER)
            Fail(where + " must be a safe integer");
        if (number < int.MinValue || number > int.MaxValue)
            Fail(where + " must be a safe integer");
        return Convert.ToInt32(number, CultureInfo.InvariantCulture);
    }

    private static string Terminal(JsonElement value, string where)
    {
        var id = String(value, where);
        try
        {
            return Terminals.parseTerminalId(id);
        }
        catch (TerminalsException)
        {
            Fail(where + " is not a terminal: " + JsonSerializer.Serialize(id));
            throw;
        }
    }

    private static void Fail(string message) => throw new NetlistException(message);
}
