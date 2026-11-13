using System.Collections.Generic;

namespace Minivac.Godot;

/// <summary>
/// The seam under the pane connection: one text socket to the pane server. <see cref="PaneSocket"/> is the
/// real one; <see cref="FakePaneTransport"/> scripts the server for tests. Events come only from
/// <see cref="Poll"/>, called once a frame.
/// </summary>
public interface IPaneTransport
{
    /// <summary>Starts connecting to the link's port with the link's origin; what happens comes from <see cref="Poll"/>.</summary>
    void Connect(PaneLink link);

    /// <summary>Sends one text frame: null when it went out, otherwise why it did not.</summary>
    string? Send(string text);

    /// <summary>What happened since the last poll, in order: opened, frames received, closed.</summary>
    IReadOnlyList<PaneTransportEvent> Poll();

    /// <summary>Closes the socket from this side; no events follow.</summary>
    void Close();
}

public abstract record PaneTransportEvent
{
    public sealed record Opened : PaneTransportEvent;

    public sealed record Received(string Text) : PaneTransportEvent;

    /// <summary>The socket closed. Godot reports -1 when it closed before it opened.</summary>
    public sealed record Closed(int Code, string Reason) : PaneTransportEvent;
}

/// <summary>A scripted pane server: queue what the server does, read what the client sent.</summary>
public sealed class FakePaneTransport : IPaneTransport
{
    private readonly List<PaneTransportEvent> _pending = [];

    public List<string> Sent { get; } = [];
    public PaneLink? Link { get; private set; }
    public int Connects { get; private set; }
    public bool ClosedByClient { get; private set; }
    /// <summary>When set, every send fails with this text, as Godot's <c>SendText</c> can (C0: OutOfMemory).</summary>
    public string? SendFailure { get; set; }

    public void Connect(PaneLink link)
    {
        Link = link;
        Connects++;
        ClosedByClient = false;
        _pending.Clear();
    }

    public string? Send(string text)
    {
        if (SendFailure is not null) return SendFailure;
        Sent.Add(text);
        return null;
    }

    public IReadOnlyList<PaneTransportEvent> Poll()
    {
        var events = _pending.ToArray();
        _pending.Clear();
        return events;
    }

    public void Close()
    {
        ClosedByClient = true;
        _pending.Clear();
    }

    public void Open() => _pending.Add(new PaneTransportEvent.Opened());

    public void Receive(string frame) => _pending.Add(new PaneTransportEvent.Received(frame));

    public void CloseFromServer(int code, string reason = "") => _pending.Add(new PaneTransportEvent.Closed(code, reason));

    /// <summary>Closed before open: a refused Origin and no server at all look the same [verified: C0 run 2026-11-11].</summary>
    public void Refuse() => CloseFromServer(-1);
}
