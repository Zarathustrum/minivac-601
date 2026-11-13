using System;
using Xunit;

namespace Minivac.Godot.Tests;

// The link rows of docs/plans/godot-chat-pane.md, "The dock's states", over the scripted transport.
public sealed class C3PaneConnectionTests
{
    private const string ReadyFrame = "{\"type\":\"ready\",\"routes\":[\"model-a\",\"model-b\"],\"maxUserChars\":8000}";
    private static readonly PaneLink Link = new("tok-1", 9123, "http://127.0.0.1:5173");

    private readonly FakePaneTransport _fake = new();
    private readonly PaneConnection _link;

    public C3PaneConnectionTests() => _link = new PaneConnection(_fake);

    private void ConnectToReady()
    {
        _link.Connect(Link);
        _fake.Open();
        _fake.Receive(ReadyFrame);
        _link.Poll();
        Assert.Equal(PaneLinkState.Ready, _link.State);
    }

    [Fact]
    public void Starts_not_connected()
    {
        Assert.Equal(PaneLinkState.NotConnected, _link.State);
        Assert.Equal("not connected", _link.StatusText);
        Assert.True(_link.CanConnect);
        Assert.False(_link.IsReady);
        Assert.Empty(_link.Poll());
        Assert.False(_link.Send(new PageMessage.Stop()));
        Assert.Equal(0, _fake.Connects);
    }

    [Fact]
    public void Connect_is_connecting_until_ready_and_sends_hello_on_open()
    {
        _link.Connect(Link);
        Assert.Equal(PaneLinkState.Connecting, _link.State);
        Assert.Equal("connecting…", _link.StatusText);
        Assert.False(_link.CanConnect);
        Assert.Same(Link, _fake.Link);
        Assert.Empty(_fake.Sent);

        _fake.Open();
        Assert.Empty(_link.Poll());
        Assert.Equal(["{\"type\":\"hello\",\"protocol\":3,\"token\":\"tok-1\"}"], _fake.Sent);
        Assert.Equal(PaneLinkState.Connecting, _link.State);

        _fake.Receive(ReadyFrame);
        var ready = Assert.IsType<ServerMessage.Ready>(Assert.Single(_link.Poll()));
        Assert.Equal(PaneLinkState.Ready, _link.State);
        Assert.Equal("connected", _link.StatusText);
        Assert.Equal(["model-a", "model-b"], _link.Routes);
        Assert.Equal(8000, _link.MaxUserChars);
        Assert.Equal(ready.Routes, _link.Routes);
        Assert.False(_link.CanConnect);
    }

    [Fact]
    public void Open_and_ready_in_one_poll_send_hello_first()
    {
        _link.Connect(Link);
        _fake.Open();
        _fake.Receive(ReadyFrame);

        Assert.IsType<ServerMessage.Ready>(Assert.Single(_link.Poll()));
        Assert.Single(_fake.Sent);
        Assert.True(_link.IsReady);
    }

    [Fact]
    public void Connect_is_ignored_while_connecting_or_ready()
    {
        _link.Connect(Link);
        _link.Connect(Link);
        Assert.Equal(1, _fake.Connects);
        _fake.Open();
        _fake.Receive(ReadyFrame);
        _link.Poll();
        _link.Connect(Link);
        Assert.Equal(1, _fake.Connects);
    }

    [Fact]
    public void Close_4001_is_token_refused_in_the_web_wording()
    {
        _link.Connect(Link);
        _fake.Open();
        _fake.CloseFromServer(4001, "bad token");
        _link.Poll();

        Assert.Equal(PaneLinkState.RefusedToken, _link.State);
        Assert.Equal("disconnected: the server refused the token: paste the link the pane server printed last", _link.StatusText);
        Assert.True(_link.CanConnect);
        Assert.Empty(_link.Routes);
    }

    [Fact]
    public void Close_4002_is_another_build_in_the_web_wording()
    {
        _link.Connect(Link);
        _fake.Open();
        _fake.CloseFromServer(4002, "protocol 3 expected");
        _link.Poll();

        Assert.Equal(PaneLinkState.RefusedBuild, _link.State);
        Assert.Equal("disconnected: this build and the pane server are different versions: rebuild this app or restart the pane server", _link.StatusText);
        Assert.True(_link.CanConnect);
    }

    [Fact]
    public void Closed_before_open_names_both_causes()
    {
        _link.Connect(Link);
        _fake.Refuse();
        _link.Poll();

        Assert.Equal(PaneLinkState.CouldNotConnect, _link.State);
        Assert.Contains("127.0.0.1:9123", _link.Reason, StringComparison.Ordinal);
        Assert.Contains("not running", _link.Reason, StringComparison.Ordinal);
        Assert.Contains("does not allow this link's origin (http://127.0.0.1:5173)", _link.Reason, StringComparison.Ordinal);
        Assert.Empty(_fake.Sent);
        Assert.True(_link.CanConnect);
    }

    [Fact]
    public void Closed_before_open_keeps_the_transport_reason()
    {
        _link.Connect(Link);
        _fake.CloseFromServer(-1, "could not start: CantConnect");
        _link.Poll();

        Assert.Equal(PaneLinkState.CouldNotConnect, _link.State);
        Assert.Contains("not running", _link.Reason, StringComparison.Ordinal);
        Assert.EndsWith("; could not start: CantConnect", _link.Reason, StringComparison.Ordinal);
    }

    [Fact]
    public void Closed_after_open_before_ready_is_could_not_connect_with_the_code()
    {
        _link.Connect(Link);
        _fake.Open();
        _fake.CloseFromServer(4003, "no hello");
        _link.Poll();

        Assert.Equal(PaneLinkState.CouldNotConnect, _link.State);
        Assert.Contains("before it was ready (code 4003)", _link.Reason, StringComparison.Ordinal);
    }

    [Fact]
    public void Closed_while_ready_is_connection_lost_and_not_retried()
    {
        ConnectToReady();
        _fake.CloseFromServer(1006);
        _link.Poll();

        Assert.Equal(PaneLinkState.Lost, _link.State);
        Assert.StartsWith("disconnected: the pane server connection closed (code 1006)", _link.StatusText, StringComparison.Ordinal);
        Assert.Empty(_link.Routes);
        Assert.Equal(0, _link.MaxUserChars);
        Assert.True(_link.CanConnect);
        Assert.False(_link.Send(new PageMessage.Stop()));
        Assert.Empty(_link.Poll());
        Assert.Equal(1, _fake.Connects);
    }

    [Fact]
    public void A_server_gone_without_a_close_frame_says_so()
    {
        ConnectToReady();
        _fake.CloseFromServer(-1);
        _link.Poll();

        Assert.Equal(PaneLinkState.Lost, _link.State);
        Assert.Contains("closed (no close frame)", _link.Reason, StringComparison.Ordinal);
    }

    // ---------------------------------------------------------------- the connect-to-ready clock (the server's HELLO_MS)

    [Fact]
    public void No_ready_within_ten_seconds_of_connect_is_could_not_connect_and_closes_the_socket()
    {
        Assert.Equal(10, PaneConnection.ReadySeconds);
        _link.Connect(Link);
        _link.Tick(6);
        _link.Tick(3.75);
        Assert.Equal(PaneLinkState.Connecting, _link.State);
        Assert.False(_fake.ClosedByClient);

        _link.Tick(0.25);
        Assert.Equal(PaneLinkState.CouldNotConnect, _link.State);
        Assert.Equal("disconnected: " + PaneConnection.NoAnswerReason, _link.StatusText);
        Assert.Contains("did not answer", PaneConnection.NoAnswerReason, StringComparison.Ordinal);
        Assert.True(_fake.ClosedByClient);
        Assert.True(_link.CanConnect);
        Assert.Equal(1, _fake.Connects);
    }

    [Fact]
    public void A_server_that_takes_hello_and_never_says_ready_times_out_the_same()
    {
        _link.Connect(Link);
        _fake.Open();
        _link.Poll();
        Assert.Single(_fake.Sent);
        _link.Tick(9.5);
        Assert.Equal(PaneLinkState.Connecting, _link.State);
        _link.Tick(0.5);
        Assert.Equal(PaneLinkState.CouldNotConnect, _link.State);
        Assert.Equal(PaneConnection.NoAnswerReason, _link.Reason);
    }

    [Fact]
    public void The_clock_stops_at_ready_and_restarts_at_each_connect()
    {
        _link.Connect(Link);
        _link.Tick(9.5);
        _fake.Open();
        _fake.Receive(ReadyFrame);
        _link.Poll();
        _link.Tick(100);
        Assert.True(_link.IsReady);

        _link.Close();
        _link.Connect(Link);
        _link.Tick(9.5);
        Assert.Equal(PaneLinkState.Connecting, _link.State);
        _link.Tick(0.5);
        Assert.Equal(PaneLinkState.CouldNotConnect, _link.State);
        _link.Tick(100);
        Assert.Equal(PaneLinkState.CouldNotConnect, _link.State);
    }

    [Fact]
    public void Lose_closes_a_live_link_from_this_side_with_the_reason_and_nothing_else()
    {
        _link.Lose("why");
        Assert.Equal(PaneLinkState.NotConnected, _link.State);
        Assert.False(_fake.ClosedByClient);

        ConnectToReady();
        _link.Lose("the server did not answer");
        Assert.Equal(PaneLinkState.Lost, _link.State);
        Assert.Equal("the server did not answer", _link.Reason);
        Assert.True(_fake.ClosedByClient);
        Assert.True(_link.CanConnect);
    }

    [Fact]
    public void Frames_before_a_close_in_the_same_poll_are_handed_up()
    {
        ConnectToReady();
        _fake.Receive("{\"type\":\"ended\",\"run\":\"r-1\"}");
        _fake.CloseFromServer(1006);

        Assert.Equal(new ServerMessage.Ended("r-1", null), Assert.Single(_link.Poll()));
        Assert.Equal(PaneLinkState.Lost, _link.State);
    }

    [Fact]
    public void Server_frames_are_handed_up_in_order_including_ones_not_understood()
    {
        ConnectToReady();
        _fake.Receive("{\"type\":\"started\",\"run\":\"r-1\"}");
        _fake.Receive("{\"type\":\"request\",\"id\":1,\"op\":\"state\"}");
        _fake.Receive("{\"type\":\"bogus\"}");
        _fake.Receive("not json");

        var messages = _link.Poll();

        Assert.Collection(messages,
            message => Assert.Equal(new ServerMessage.Started("r-1"), message),
            message => Assert.Equal(new ServerMessage.Request(1, "state", "{\"type\":\"request\",\"id\":1,\"op\":\"state\"}"), message),
            message => Assert.IsType<ServerMessage.NotUnderstood>(message),
            message => Assert.IsType<ServerMessage.NotUnderstood>(message));
        Assert.True(_link.IsReady);
    }

    [Fact]
    public void Ready_link_sends_client_frames()
    {
        ConnectToReady();

        Assert.True(_link.Send(new PageMessage.User("light lamp 1", "model-a")));
        Assert.True(_link.Send(new PageMessage.Reply(1, "{\"ok\":true}")));
        Assert.True(_link.Send(new PageMessage.Stop()));
        Assert.True(_link.Send(new PageMessage.End()));

        Assert.Equal(
        [
            "{\"type\":\"hello\",\"protocol\":3,\"token\":\"tok-1\"}",
            "{\"type\":\"user\",\"text\":\"light lamp 1\",\"route\":\"model-a\"}",
            "{\"type\":\"reply\",\"id\":1,\"reply\":{\"ok\":true}}",
            "{\"type\":\"stop\"}",
            "{\"type\":\"end\"}",
        ], _fake.Sent);
    }

    [Fact]
    public void Send_is_refused_while_connecting()
    {
        _link.Connect(Link);
        _fake.Open();
        _link.Poll();

        Assert.False(_link.Send(new PageMessage.User("x", "model-a")));
        Assert.Single(_fake.Sent);
    }

    [Fact]
    public void A_failed_hello_is_could_not_connect_and_closes_the_socket()
    {
        _link.Connect(Link);
        _fake.SendFailure = "OutOfMemory";
        _fake.Open();
        _fake.Receive(ReadyFrame);

        Assert.Empty(_link.Poll());
        Assert.Equal(PaneLinkState.CouldNotConnect, _link.State);
        Assert.Contains("could not send hello to the pane server (OutOfMemory)", _link.Reason, StringComparison.Ordinal);
        Assert.True(_fake.ClosedByClient);
    }

    [Fact]
    public void A_failed_send_when_ready_loses_the_link_and_closes_the_socket()
    {
        ConnectToReady();
        _fake.SendFailure = "OutOfMemory";

        Assert.False(_link.Send(new PageMessage.Reply(4, "{\"big\":true}")));
        Assert.Equal(PaneLinkState.Lost, _link.State);
        Assert.Contains("could not send to the pane server (OutOfMemory)", _link.Reason, StringComparison.Ordinal);
        Assert.True(_fake.ClosedByClient);
        Assert.True(_link.CanConnect);
    }

    [Fact]
    public void Close_from_this_side_in_each_live_state_is_not_connected()
    {
        _link.Connect(Link);
        _link.Close();
        Assert.Equal(PaneLinkState.NotConnected, _link.State);
        Assert.True(_fake.ClosedByClient);

        ConnectToReady();
        _link.Close();
        Assert.Equal(PaneLinkState.NotConnected, _link.State);
        Assert.True(_fake.ClosedByClient);
        Assert.Empty(_link.Routes);
        Assert.Empty(_link.Poll());
    }

    [Fact]
    public void Connect_again_after_each_ending_starts_fresh()
    {
        foreach (var end in new Action[]
        {
            () => { _fake.Open(); _fake.CloseFromServer(4001); },
            () => { _fake.Open(); _fake.CloseFromServer(4002); },
            () => _fake.Refuse(),
            () => { _fake.Open(); _fake.Receive(ReadyFrame); _fake.CloseFromServer(1006); },
        })
        {
            _link.Connect(Link);
            end();
            _link.Poll();
            Assert.True(_link.CanConnect);
        }

        _fake.Sent.Clear();
        _link.Connect(Link);
        Assert.Equal(PaneLinkState.Connecting, _link.State);
        Assert.Equal("", _link.Reason);
        _fake.Open();
        _fake.Receive(ReadyFrame);
        _link.Poll();
        Assert.True(_link.IsReady);
        Assert.Equal(["{\"type\":\"hello\",\"protocol\":3,\"token\":\"tok-1\"}"], _fake.Sent);
        Assert.Equal(5, _fake.Connects);
    }
}
