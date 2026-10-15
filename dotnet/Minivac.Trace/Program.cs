using System;
using System.Globalization;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text;
using Minivac.Conformance;

[assembly: InternalsVisibleTo("Minivac.Core.Tests")]

namespace Minivac.TraceCli;

public static class Program
{
    private const string Usage =
        "usage: minivac-trace <fixture.json> | minivac-trace --list-fallbacks";

    public static void Main(string[] args)
    {
        Environment.ExitCode = Execute(
            args,
            AppContext.BaseDirectory,
            Console.OpenStandardOutput(),
            Console.OpenStandardError());
    }

    internal static int Execute(
        string[] args,
        string baseDirectory,
        Stream standardOutput,
        Stream standardError,
        Func<string, byte[]>? fixtureReader = null)
    {
        using var stdout = Writer(standardOutput);
        using var stderr = Writer(standardError);
        try
        {
            if (args.Length != 1) throw new InvalidOperationException(Usage);
            var repositoryRoot = FindRepositoryRoot(baseDirectory);
            var source = new FileSystemSource(repositoryRoot);
            if (string.Equals(args[0], "--list-fallbacks", StringComparison.Ordinal))
            {
                stdout.Write(Fallbacks.Format(Fallbacks.List(source)));
            }
            else
            {
                var fixtureBytes = (fixtureReader ?? File.ReadAllBytes)(args[0]);
                var result = TraceRunner.RunFixture(source, args[0], fixtureBytes);
                stdout.Write(result.trace);
                foreach (var failure in result.failures)
                {
                    stderr.WriteLine(
                        "minivac-trace: assertion failed at script[" + F(failure.scriptIndex) + "] " +
                        failure.dev + ": expected " + failure.expected + ", got " + failure.actual);
                }
                if (result.failures.Count > 0) return 1;
            }
            return 0;
        }
        catch (Exception exception)
        {
            stderr.WriteLine("minivac-trace: " + exception.Message);
            return 1;
        }
    }

    private static StreamWriter Writer(Stream stream) => new(
        stream,
        new UTF8Encoding(false),
        bufferSize: 1024,
        leaveOpen: true)
    {
        NewLine = "\n",
        AutoFlush = true,
    };

    private static string FindRepositoryRoot(string baseDirectory)
    {
        for (var directory = new DirectoryInfo(baseDirectory);
             directory is not null;
             directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "data", "netlist.json")) &&
                Directory.Exists(Path.Combine(directory.FullName, "test", "conformance")))
            {
                return directory.FullName;
            }
        }
        throw new InvalidOperationException("cannot locate the repository root");
    }

    private static string F(int value) => value.ToString(CultureInfo.InvariantCulture);
}
