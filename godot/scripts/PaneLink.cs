using System;
using System.Collections.Generic;
using System.Globalization;

namespace Minivac.Godot;

/// <summary>
/// Where the pane server is, from the URL it prints: <c>http://127.0.0.1:5173/dev.html#t=&lt;token&gt;&amp;port=&lt;n&gt;</c>
/// (tools/hands-pane/server.ts, <c>url</c>). The C# of <c>readPaneLink</c> in src/pane/ui.ts, with the same
/// default port and refusals, plus what a pasted string needs that a browser URL does not. Origin is the
/// link's own origin: Godot sends it as its Origin header, as the page's browser would
/// [verified: C0 run 2026-11-11, docs/STATUS.md]. The app holds the token in memory only (the server's own link file is its business): nothing here logs it,
/// and <see cref="ToString"/> leaves it out.
/// </summary>
public sealed record PaneLink(string Token, int Port, string Origin)
{
    public const string Flag = "--pane-link";

    public override string ToString() => "PaneLink { Port = " + Port.ToString(CultureInfo.InvariantCulture) +
        ", Origin = " + Origin + " }";

    /// <summary>The value after <c>--pane-link</c> in the user args (what follows <c>--</c>); null when the flag is absent.</summary>
    public static string? FromArgs(IReadOnlyList<string> userArgs)
    {
        for (var at = 0; at < userArgs.Count; at++)
        {
            if (userArgs[at] == Flag) return at + 1 < userArgs.Count ? userArgs[at + 1] : "";
        }
        return null;
    }

    /// <summary>The file a running pane server leaves its link in (tools/hands-pane/server.ts, <c>LINK_FILE</c>).</summary>
    public static string FilePath(string home) => home + "/.minivac/pane-link";

    /// <summary>The link in <paramref name="text"/>, or null with <paramref name="problem"/> saying why not.</summary>
    public static PaneLink? Read(string text, out string problem)
    {
        var trimmed = text.Trim();
        var hash = trimmed.IndexOf('#', StringComparison.Ordinal);
        var head = hash < 0 ? trimmed : trimmed[..hash];
        if (!Uri.TryCreate(head, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) || uri.IdnHost.Length == 0)
        {
            problem = "not a link: paste the URL the pane server printed (http://…/dev.html#t=…&port=…)";
            return null;
        }

        // URLSearchParams over the fragment: '&'-separated, '+' is a space, percent-decoded, first one wins.
        string? token = null;
        string? portText = null;
        if (hash >= 0)
        {
            foreach (var pair in trimmed[(hash + 1)..].Split('&'))
            {
                if (pair.Length == 0) continue;
                var equals = pair.IndexOf('=', StringComparison.Ordinal);
                var name = Decode(equals < 0 ? pair : pair[..equals]);
                var value = equals < 0 ? "" : Decode(pair[(equals + 1)..]);
                if (name == "t") token ??= value;
                else if (name == "port") portText ??= value;
            }
        }

        if (string.IsNullOrEmpty(token))
        {
            problem = "the link has no token (#t=…): paste the whole URL the pane server printed";
            return null;
        }
        var port = PaneProtocol.DefaultPort;
        if (portText is not null &&
            (!int.TryParse(portText.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out port) || port < 1 || port > 65535))
        {
            problem = "the link's port is not a whole number from 1 to 65535";
            return null;
        }

        problem = "";
        var host = uri.HostNameType == UriHostNameType.IPv6 ? "[" + uri.IdnHost.Trim('[', ']') + "]" : uri.IdnHost;
        var origin = uri.Scheme + "://" + host + (uri.IsDefaultPort ? "" : ":" + uri.Port.ToString(CultureInfo.InvariantCulture));
        return new PaneLink(token, port, origin);
    }

    private static string Decode(string text) => Uri.UnescapeDataString(text.Replace('+', ' '));
}
