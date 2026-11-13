using System.Collections.Generic;
using System.Globalization;

namespace Minivac.Godot;

public enum PaneLinkState { NotConnected, Connecting, Ready, RefusedToken, RefusedBuild, CouldNotConnect, Lost }

/// <summary>
/// The link to the pane server above the transport seam: connect, <c>hello</c>, <c>ready</c>, and how it ends.
/// It decides the dock's link rows (docs/plans/godot-chat-pane.md, "The dock's states"): not connected,
/// connecting, refused, ready, connection lost. Sessions and turns are the dock's: every server frame is
/// handed up from <see cref="Poll"/>. A lost link is not retried; Connect is pressed again. The token is
/// kept only until <c>hello</c> is sent.
/// </summary>
public sealed class PaneConnection
{
    // The web pane's two refusals (src/pane/ui.ts, CLOSE_REASONS), reworded for a desktop app: there is no
    // page to reload and no URL to open. A test holds their meaning to the web's.
    public const string BadTokenReason = "the server refused the token: paste the link the pane server printed last";
    public const string BadProtocolReason =
        "this build and the pane server are different versions: rebuild this app or restart the pane server";
    /// <summary>The server's own <c>HELLO_MS</c> (tools/hands-pane/server.ts): from Connect to <c>ready</c>.</summary>
    public const double ReadySeconds = 10;
    public const string NoAnswerReason =
        "the pane server did not answer within 10 s: check that it is running and that the link is its latest, then press Connect";

    private readonly IPaneTransport _transport;
    private string? _token;
    private bool _opened;
    private int _port;
    private string _origin = "";
    private double _connectingSeconds;

    public PaneConnection(IPaneTransport transport) => _transport = transport;

    public PaneLinkState State { get; private set; } = PaneLinkState.NotConnected;
    /// <summary>Why the link is refused, could not connect, or was lost; empty otherwise.</summary>
    public string Reason { get; private set; } = "";
    /// <summary>From <c>ready</c>: the routes, the default first, and the message box's cap.</summary>
    public IReadOnlyList<string> Routes { get; private set; } = [];
    public int MaxUserChars { get; private set; }

    public bool IsReady => State == PaneLinkState.Ready;
    public bool CanConnect => State is not (PaneLinkState.Connecting or PaneLinkState.Ready);

    public string StatusText => State switch
    {
        PaneLinkState.NotConnected => "not connected",
        PaneLinkState.Connecting => "connecting…",
        PaneLinkState.Ready => "connected",
        _ => "disconnected: " + Reason,
    };

    public void Connect(PaneLink link)
    {
        if (!CanConnect) return;
        Reset(PaneLinkState.Connecting, "");
        _token = link.Token;
        _port = link.Port;
        _origin = link.Origin;
        _transport.Connect(link);
    }

    /// <summary>Call once a frame: advances the link and returns every server frame that arrived, in order.</summary>
    public IReadOnlyList<ServerMessage> Poll()
    {
        if (State is not (PaneLinkState.Connecting or PaneLinkState.Ready)) return [];
        var messages = new List<ServerMessage>();
        foreach (var happened in _transport.Poll())
        {
            if (State is not (PaneLinkState.Connecting or PaneLinkState.Ready)) break;
            switch (happened)
            {
                case PaneTransportEvent.Opened:
                    _opened = true;
                    var failure = _transport.Send(PaneProtocol.Serialize(new PageMessage.Hello(_token ?? "")));
                    _token = null;
                    if (failure is not null) Fail(PaneLinkState.CouldNotConnect, "could not send hello to the pane server (" + failure + ")");
                    break;
                case PaneTransportEvent.Received received:
                    var message = PaneProtocol.Parse(received.Text);
                    if (message is ServerMessage.Ready ready)
                    {
                        State = PaneLinkState.Ready;
                        Routes = ready.Routes;
                        MaxUserChars = ready.MaxUserChars;
                    }
                    messages.Add(message);
                    break;
                case PaneTransportEvent.Closed closed:
                    OnClosed(closed.Code, closed.Reason);
                    break;
            }
        }
        return messages;
    }

    /// <summary>
    /// Advances the connect clock by the caller's frame time (no wall clock here). A link still connecting
    /// <see cref="ReadySeconds"/> after Connect, whether the socket never opened or <c>ready</c> never came,
    /// is closed and could not connect. It is not retried; Connect is pressed again.
    /// </summary>
    public void Tick(double seconds)
    {
        if (State != PaneLinkState.Connecting || seconds <= 0) return;
        _connectingSeconds += seconds;
        if (_connectingSeconds >= ReadySeconds) Fail(PaneLinkState.CouldNotConnect, NoAnswerReason);
    }

    /// <summary>Closes a live link from this side as lost, with <paramref name="reason"/>; nothing when not live.</summary>
    public void Lose(string reason)
    {
        if (State is PaneLinkState.Connecting or PaneLinkState.Ready) Fail(PaneLinkState.Lost, reason);
    }

    /// <summary>
    /// Sends one frame once the link is ready; false when it is not ready or the send failed. A failed send
    /// closes the link: a frame the server never gets (a reply above all) would leave it waiting.
    /// </summary>
    public bool Send(PageMessage message)
    {
        if (State != PaneLinkState.Ready) return false;
        var failure = _transport.Send(PaneProtocol.Serialize(message));
        if (failure is null) return true;
        Fail(PaneLinkState.Lost, "could not send to the pane server (" + failure + "); press Connect to connect again");
        return false;
    }

    /// <summary>Closes the link from this side; the server marks any live run invalid.</summary>
    public void Close()
    {
        if (State is PaneLinkState.Connecting or PaneLinkState.Ready) _transport.Close();
        Reset(PaneLinkState.NotConnected, "");
    }

    private void OnClosed(int code, string reason)
    {
        // Godot reports -1 when no close frame came: a killed server, a dropped socket.
        var codeText = code < 0 ? "no close frame" : "code " + code.ToString(CultureInfo.InvariantCulture);
        if (code == PaneProtocol.CloseBadToken) Reset(PaneLinkState.RefusedToken, BadTokenReason);
        else if (code == PaneProtocol.CloseBadProtocol) Reset(PaneLinkState.RefusedBuild, BadProtocolReason);
        else if (State == PaneLinkState.Ready)
            Reset(PaneLinkState.Lost, "the pane server connection closed (" + codeText + "); press Connect to connect again");
        else if (_opened)
            Reset(PaneLinkState.CouldNotConnect, "the pane server closed the connection before it was ready (" + codeText + ")");
        else
            Reset(PaneLinkState.CouldNotConnect, "could not connect to 127.0.0.1:" + _port.ToString(CultureInfo.InvariantCulture) +
                ": the pane server is not running, or it does not allow this link's origin (" + _origin + ")" +
                (reason.Length > 0 ? "; " + reason : ""));
    }

    private void Fail(PaneLinkState state, string reason)
    {
        _transport.Close();
        Reset(state, reason);
    }

    private void Reset(PaneLinkState state, string reason)
    {
        State = state;
        Reason = reason;
        Routes = [];
        MaxUserChars = 0;
        _opened = false;
        _token = null;
        _connectingSeconds = 0;
    }
}
