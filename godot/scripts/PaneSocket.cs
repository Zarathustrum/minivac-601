using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Godot;

namespace Minivac.Godot;

/// <summary>
/// The real pane transport: Godot's <see cref="WebSocketPeer"/>, set up as the C0 probes proved it
/// [verified: C0 run 2026-11-11, docs/STATUS.md]. The Origin header is the link's origin, and both
/// buffers are the server's 4 MiB <c>maxPayload</c>, all set before <c>ConnectToUrl</c>: at the default
/// 65535 bytes a larger outbound frame is refused and a larger inbound one closes the socket 1009.
/// The host is always 127.0.0.1, as the web page connects (src/pane/ui.ts, <c>connect</c>).
/// </summary>
public sealed class PaneSocket : IPaneTransport
{
    private WebSocketPeer? _peer;
    private bool _opened;
    private PaneTransportEvent? _failed;

    public void Connect(PaneLink link)
    {
        Close();
        _failed = null;
        var peer = new WebSocketPeer
        {
            HandshakeHeaders = ["Origin: " + link.Origin],
            InboundBufferSize = PaneProtocol.MaxFrameBytes,
            OutboundBufferSize = PaneProtocol.MaxFrameBytes,
        };
        var started = peer.ConnectToUrl("ws://127.0.0.1:" + link.Port.ToString(CultureInfo.InvariantCulture) + "/");
        if (started == Error.Ok) _peer = peer;
        else _failed = new PaneTransportEvent.Closed(-1, "could not start: " + started);
    }

    public string? Send(string text)
    {
        if (_peer is null || _peer.GetReadyState() != WebSocketPeer.State.Open) return "not open";
        var sent = _peer.SendText(text);
        return sent == Error.Ok ? null : sent.ToString();
    }

    public IReadOnlyList<PaneTransportEvent> Poll()
    {
        if (_failed is { } failed)
        {
            _failed = null;
            return [failed];
        }
        if (_peer is null) return [];

        _peer.Poll();
        var state = _peer.GetReadyState();
        var events = new List<PaneTransportEvent>();
        if (!_opened && (state == WebSocketPeer.State.Open || _peer.GetAvailablePacketCount() > 0))
        {
            _opened = true;
            events.Add(new PaneTransportEvent.Opened());
        }
        while (_peer.GetAvailablePacketCount() > 0)
        {
            events.Add(new PaneTransportEvent.Received(Encoding.UTF8.GetString(_peer.GetPacket())));
        }
        if (state == WebSocketPeer.State.Closed)
        {
            events.Add(new PaneTransportEvent.Closed(_peer.GetCloseCode(), _peer.GetCloseReason()));
            _peer = null;
            _opened = false;
        }
        return events;
    }

    /// <summary>
    /// The peer is never polled again, so a plain close would leave the TCP connection half-open until the
    /// server's close timeout: send the close frame, flush it with one poll, then drop the connection.
    /// </summary>
    public void Close()
    {
        if (_peer is not null)
        {
            _peer.Close(1000, "closed by the client");
            _peer.Poll();
            _peer.Close(-1);
        }
        _peer = null;
        _opened = false;
        _failed = null;
    }
}
