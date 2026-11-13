using System;
using System.IO;
using System.Text;
using System.Text.Json;
using Minivac.Conformance;
using Minivac.Core;
using Minivac.Hands;

namespace Minivac.HandsTransfer;

/// <summary>
/// `minivac-hands-transfer`: the C# pane engine over stdin and stdout, for the transfer test
/// (test/pane/transfer.spec.ts). Each stdin line is one pane request as JSON; each gets one stdout
/// line, the reply JSON, or an empty line when the request has no reply (an unknown `op`). One
/// engine per process, built on the repo's netlist and the page's two profiles, in the page's
/// order (src/app.ts:42).
/// </summary>
public static class Program
{
    private static readonly string[] Profiles = ["MV601-REF-A", "MV601-IDEAL"];

    public static int Main()
    {
        using var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { NewLine = "\n" };
        using var stderr = new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false)) { NewLine = "\n", AutoFlush = true };
        try
        {
            var source = new FileSystemSource(FindRepositoryRoot(AppContext.BaseDirectory));
            var netlist = Netlist.LoadNetlist(source.ReadAllBytes("data/netlist.json"));
            var profiles = new Profile[Profiles.Length];
            for (var i = 0; i < Profiles.Length; i++)
            {
                using var document = JsonDocument.Parse(source.ReadAllBytes("data/profiles/" + Profiles[i] + ".json"));
                profiles[i] = Profile.LoadProfile(document.RootElement);
            }
            var engine = new PaneEngine(netlist, profiles);
            using var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false, true));
            for (var line = stdin.ReadLine(); line is not null; line = stdin.ReadLine())
            {
                stdout.WriteLine(PaneJson.Answer(engine, line) ?? "");
                stdout.Flush();
            }
            return 0;
        }
        catch (Exception exception)
        {
            stderr.WriteLine("minivac-hands-transfer: " + exception.Message);
            return 1;
        }
    }

    private static string FindRepositoryRoot(string baseDirectory)
    {
        for (var directory = new DirectoryInfo(baseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "data", "netlist.json")) &&
                Directory.Exists(Path.Combine(directory.FullName, "test", "conformance")))
            {
                return directory.FullName;
            }
        }
        throw new InvalidOperationException("cannot locate the repository root");
    }
}
