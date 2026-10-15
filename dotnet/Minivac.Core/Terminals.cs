using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Minivac.Core;

public sealed record TerminalDef(string id, int holes, int index, int holePrefix);

public sealed record HoleRef(string id, string terminal, int hole, int index);

public sealed record TerminalWire(string a, string b);

public sealed record AllocatedCord(int wireIndex, HoleRef a, HoleRef b);

public abstract record ProgramDesignator
{
    private protected ProgramDesignator(string discriminator) => k = discriminator;

    public string k { get; }

    public sealed record Terminal : ProgramDesignator
    {
        public Terminal(string id) : base("terminal") => this.id = id;

        public string id { get; }
    }

    public abstract record ResistorSplice : ProgramDesignator
    {
        private protected ResistorSplice(string discriminator) : base("resistor-splice") => form = discriminator;

        public string form { get; }
    }

    public sealed record Unspecified : ResistorSplice
    {
        public Unspecified() : base("unspecified") { }
    }

    public sealed record Literal : ResistorSplice
    {
        public Literal(string text) : base("literal") => this.text = text;

        public string text { get; }
    }

    public sealed record Bias : ResistorSplice
    {
        public Bias(int relay) : base("bias") => this.relay = relay;

        public int relay { get; }
    }
}

public sealed class HoleAllocationException : Exception
{
    public HoleAllocationException(int wireIndex, string terminal)
        : base("terminals: hole_occupied at wire " + wireIndex.ToString(CultureInfo.InvariantCulture) +
            " terminal " + JsonSerializer.Serialize(terminal))
    {
        WireIndex = wireIndex;
        Terminal = terminal;
    }

    public string Code => "hole_occupied";

    public int WireIndex { get; }

    public string Terminal { get; }
}

public sealed class TerminalsException : Exception
{
    public TerminalsException(string message) : base("terminals: " + message)
    {
    }
}

public static partial class Terminals
{
    private static readonly string[] SectionSuffixes =
    [
        "A", "B", "+", "-", "C", "E", "F", "G", "H", "J", "K", "L", "N", "com", "cap",
        "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
    ];

    private static readonly TerminalDef[] TerminalDefs;
    private static readonly string[] TerminalIds;
    private static readonly int[] HolePrefixes;

    public const int TERMINAL_COUNT = 186;
    public const int HOLE_COUNT = 392;

    public static readonly IReadOnlyList<TerminalDef> TERMINALS;
    public static readonly IReadOnlyList<string> TERMINAL_IDS;
    public static readonly IReadOnlyList<int> HOLE_PREFIXES;

    static Terminals()
    {
        var rows = new List<(string Id, int Holes)>(TERMINAL_COUNT);
        for (var section = 1; section <= 6; section++)
        {
            foreach (var suffix in SectionSuffixes)
            {
                rows.Add((section.ToString(CultureInfo.InvariantCulture) + suffix, suffix == "com" ? 4 : 2));
            }
        }

        rows.Add(("M+", 2));
        rows.Add(("M-", 2));
        for (var cell = 1; cell <= 9; cell++)
            rows.Add(("M" + cell.ToString(CultureInfo.InvariantCulture) + "t", 2));
        for (var cell = 1; cell <= 9; cell++)
            rows.Add(("M" + cell.ToString(CultureInfo.InvariantCulture) + "b", 2));
        rows.Add(("M10", 6));
        rows.Add(("M11", 6));
        for (var pad = 0; pad <= 19; pad++)
            rows.Add(("D" + pad.ToString(CultureInfo.InvariantCulture), 2));

        if (rows.Count != TERMINAL_COUNT)
            throw new TerminalsException("internal terminal table has " + rows.Count.ToString(CultureInfo.InvariantCulture) + " rows, expected 186");

        TerminalDefs = new TerminalDef[TERMINAL_COUNT];
        TerminalIds = new string[TERMINAL_COUNT];
        HolePrefixes = new int[TERMINAL_COUNT + 1];
        for (var index = 0; index < rows.Count; index++)
        {
            var row = rows[index];
            if (FindTerminalIndex(row.Id) >= 0)
                throw new TerminalsException("duplicate internal terminal " + JsonSerializer.Serialize(row.Id));
            TerminalIds[index] = row.Id;
            TerminalDefs[index] = new TerminalDef(row.Id, row.Holes, index, HolePrefixes[index]);
            HolePrefixes[index + 1] = HolePrefixes[index] + row.Holes;
        }

        if (HolePrefixes[^1] != HOLE_COUNT)
            throw new TerminalsException("internal terminal table has " + HolePrefixes[^1].ToString(CultureInfo.InvariantCulture) + " holes, expected 392");

        TERMINALS = new ReadOnlyCollection<TerminalDef>(TerminalDefs);
        TERMINAL_IDS = new ReadOnlyCollection<string>(TerminalIds);
        HOLE_PREFIXES = new ReadOnlyCollection<int>(HolePrefixes);
    }

    public static string parseTerminalId(string text)
    {
        if (text is null || FindTerminalIndex(text) < 0)
            throw new TerminalsException("invalid physical terminal " + JsonSerializer.Serialize(text));
        return text;
    }

    public static int terminalIndex(string id)
    {
        var index = id is null ? -1 : FindTerminalIndex(id);
        if (index < 0)
            throw new TerminalsException("invalid physical terminal " + JsonSerializer.Serialize(id));
        return index;
    }

    public static TerminalDef terminalAt(int index)
    {
        if (index < 0 || index >= TERMINAL_COUNT)
            throw new TerminalsException("terminal index out of range: " + index.ToString(CultureInfo.InvariantCulture));
        return TerminalDefs[index];
    }

    public static HoleRef holeAt(string terminal, int hole)
    {
        var def = terminalAt(terminalIndex(terminal));
        if (hole < 1 || hole > def.holes)
        {
            throw new TerminalsException("hole out of range for " + JsonSerializer.Serialize(terminal) + ": " +
                hole.ToString(CultureInfo.InvariantCulture));
        }

        return new HoleRef(
            terminal + "#" + hole.ToString(CultureInfo.InvariantCulture),
            terminal,
            hole,
            def.holePrefix + hole - 1);
    }

    public static HoleRef holeByIndex(int index)
    {
        if (index < 0 || index >= HOLE_COUNT)
            throw new TerminalsException("hole index out of range: " + index.ToString(CultureInfo.InvariantCulture));

        var low = 0;
        var high = TERMINAL_COUNT;
        while (low + 1 < high)
        {
            var middle = low + ((high - low) / 2);
            if (HolePrefixes[middle] <= index)
                low = middle;
            else
                high = middle;
        }

        var def = TerminalDefs[low];
        return holeAt(def.id, index - def.holePrefix + 1);
    }

    public static TerminalWire parseTerminalWire(string text)
    {
        if (text is null)
            throw new TerminalsException("invalid terminal wire null");
        var slash = text.IndexOf('/', StringComparison.Ordinal);
        if (slash <= 0 || slash != text.LastIndexOf('/') || slash == text.Length - 1)
            throw new TerminalsException("invalid terminal wire " + JsonSerializer.Serialize(text));
        return new TerminalWire(parseTerminalId(text[..slash]), parseTerminalId(text[(slash + 1)..]));
    }

    public static HoleRef parseHoleId(string text)
    {
        if (text is null)
            throw new TerminalsException("invalid hole id null");
        var hash = text.IndexOf('#', StringComparison.Ordinal);
        if (hash <= 0 || hash != text.LastIndexOf('#') || hash == text.Length - 1)
            throw new TerminalsException("invalid hole id " + JsonSerializer.Serialize(text));
        var terminal = parseTerminalId(text[..hash]);
        var holeText = text[(hash + 1)..];
        if (!HoleNumber().IsMatch(holeText))
            throw new TerminalsException("invalid hole id " + JsonSerializer.Serialize(text));
        if (!int.TryParse(holeText, NumberStyles.None, CultureInfo.InvariantCulture, out var hole))
        {
            // terminals.ts hands `Number(holeText)` straight to `holeAt`, so a hole number too big
            // for the int index is a RANGE error there, not a syntax error. Report it the same way
            // or the CLI's stderr stops matching byte for byte.
            throw new TerminalsException("hole out of range for " + JsonSerializer.Serialize(terminal) + ": " +
                FormatOversizedHole(holeText));
        }
        var result = holeAt(terminal, hole);
        if (!string.Equals(result.id, text, StringComparison.Ordinal))
            throw new TerminalsException("invalid hole id " + JsonSerializer.Serialize(text));
        return result;
    }

    public static ProgramDesignator parseProgramDesignator(string text)
    {
        if (text is null)
            throw new TerminalsException("invalid program designator null");
        if (FindTerminalIndex(text) >= 0)
            return new ProgramDesignator.Terminal(text);
        if (text == "Ω")
            return new ProgramDesignator.Unspecified();

        var ohms = LiteralResistor().Match(text);
        if (ohms.Success)
            return new ProgramDesignator.Literal(ohms.Groups[1].Value);

        var bias = BiasResistor().Match(text);
        if (bias.Success)
            return new ProgramDesignator.Bias(int.Parse(bias.Groups[1].Value, CultureInfo.InvariantCulture));

        throw new TerminalsException("invalid program designator " + JsonSerializer.Serialize(text));
    }

    public static IReadOnlyList<AllocatedCord> AllocateHoles(IReadOnlyList<TerminalWire> wires)
    {
        ArgumentNullException.ThrowIfNull(wires);
        var used = new int[TERMINAL_COUNT];
        var cords = new AllocatedCord[wires.Count];

        for (var wireIndex = 0; wireIndex < wires.Count; wireIndex++)
        {
            var wire = wires[wireIndex];
            var aIndex = terminalIndex(wire.a);
            var aDef = TerminalDefs[aIndex];
            var aHole = used[aIndex] + 1;
            if (aHole > aDef.holes)
                throw new HoleAllocationException(wireIndex, aDef.id);
            used[aIndex] = aHole;

            var bIndex = terminalIndex(wire.b);
            var bDef = TerminalDefs[bIndex];
            var bHole = used[bIndex] + 1;
            if (bHole > bDef.holes)
                throw new HoleAllocationException(wireIndex, bDef.id);
            used[bIndex] = bHole;

            cords[wireIndex] = new AllocatedCord(wireIndex, holeAt(aDef.id, aHole), holeAt(bDef.id, bHole));
        }

        return Array.AsReadOnly(cords);
    }

    /// <summary>Mirror <c>JSON.stringify(Number(digits))</c> for a hole number too big for the index.</summary>
    private static string FormatOversizedHole(string digits)
    {
        var value = double.Parse(digits, NumberStyles.None, CultureInfo.InvariantCulture);
        if (double.IsInfinity(value))
            return "null";
        if (value < 1e21)
            return value.ToString("F0", CultureInfo.InvariantCulture);
        return value.ToString("R", CultureInfo.InvariantCulture).Replace("E+", "e+", StringComparison.Ordinal);
    }

    private static int FindTerminalIndex(string id)
    {
        for (var i = 0; i < TerminalIds.Length; i++)
        {
            if (string.Equals(TerminalIds[i], id, StringComparison.Ordinal))
                return i;
        }

        return -1;
    }

    [GeneratedRegex(@"^[1-9][0-9]*\z", RegexOptions.CultureInvariant)]
    private static partial Regex HoleNumber();

    [GeneratedRegex(@"^Ω_([1-9][0-9]*)\z", RegexOptions.CultureInvariant)]
    private static partial Regex LiteralResistor();

    [GeneratedRegex(@"^Ω_B([1-6])\z", RegexOptions.CultureInvariant)]
    private static partial Regex BiasResistor();
}
