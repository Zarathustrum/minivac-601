using System;
using System.Collections.Generic;
using Godot;

namespace Minivac.Godot;

public sealed class GodotAudioSink : IAudioSink, IDisposable
{
    private readonly PriorityQueue<RelayCue, (long DueUs, long Sequence)> _relayQueue = new();
    private readonly List<long> _activeRelays = [];
    private readonly Func<RelayCue, long> _playRelay;
    private readonly AudioStream _pullInSample;
    private readonly AudioStream _dropOutSample;
    private AudioStreamPlaybackPolyphonic? _relayPlayback;
    private long _sequence;
    private int _motorDirection;
    private bool _started;
    private bool _disposed;

    internal GodotAudioSink(
        AudioStreamPlayer relayPlayer,
        AudioStreamPlayer motorPlayer,
        AudioStream pullInSample,
        AudioStream dropOutSample,
        int roomBusIndex)
    {
        ArgumentNullException.ThrowIfNull(relayPlayer);
        ArgumentNullException.ThrowIfNull(motorPlayer);
        ArgumentNullException.ThrowIfNull(pullInSample);
        ArgumentNullException.ThrowIfNull(dropOutSample);
        if (motorPlayer.Stream is null)
            throw new ArgumentException("audio sink: motor player has no stream", nameof(motorPlayer));
        if (roomBusIndex < 0)
            throw new ArgumentOutOfRangeException(nameof(roomBusIndex), roomBusIndex, "Room bus index must be non-negative");

        RelayPlayer = relayPlayer;
        MotorPlayer = motorPlayer;
        RoomBusIndex = roomBusIndex;
        _pullInSample = pullInSample;
        _dropOutSample = dropOutSample;
        MotorPlayer.Stream.Set("loop_mode", 1);
        RelayPlayer.Stream = new AudioStreamPolyphonic { Polyphony = AudioLayers.RelayPolyphony };
        _playRelay = cue => _relayPlayback?.PlayStream(
            SampleFor(cue.Kind),
            0,
            0,
            AudioLayers.PitchScaleForRelay(cue.Relay)) ?? AudioStreamPlaybackPolyphonic.InvalidId;
    }

    public AudioStreamPlayer RelayPlayer { get; }
    public AudioStreamPlayer MotorPlayer { get; }
    public int RelayPolyphony => (RelayPlayer.Stream as AudioStreamPolyphonic)?.Polyphony ?? 0;
    public int RoomBusIndex { get; }
    public int PendingRelayCount => _relayQueue.Count;
    public long DroppedRelayCount { get; private set; }
    public bool MotorLoops => MotorPlayer.Stream.Get("loop_mode").AsInt64() == 1;

    public void Start()
    {
        if (_disposed || _started) return;
        _started = true;
    }

    public void PlayRelay(RelayCue cue)
    {
        if (_disposed) return;
        _relayQueue.Enqueue(cue, (cue.DueUs, _sequence++));
    }

    public void Frame(long nowUs)
    {
        if (_disposed) return;
        RemoveFinishedRelayVoices();
        while (_relayQueue.TryPeek(out var cue, out _) && cue.DueUs <= nowUs)
        {
            _relayQueue.Dequeue();
            if (!_started)
            {
                DroppedRelayCount++;
                continue;
            }
            EnsureRelayPlayback();
            var voice = _playRelay(cue);
            if (voice == AudioStreamPlaybackPolyphonic.InvalidId) DroppedRelayCount++;
            else _activeRelays.Add(voice);
        }
    }

    public bool SetMotor(MotorCue cue)
    {
        if (_disposed || !_started || cue.Direction is not (-1 or 1)) return false;
        if (cue.Rate is < 0.5 or > 2.0) return false;

        MotorPlayer.PitchScale = (float)cue.Rate;
        if (cue.Kind == MotorCueKind.Rate && MotorPlayer.Playing && _motorDirection == cue.Direction)
        {
            return true;
        }

        MotorPlayer.Stop();
        MotorPlayer.Play();
        if (!MotorPlayer.Playing)
        {
            _motorDirection = 0;
            return false;
        }
        _motorDirection = cue.Direction;
        return true;
    }

    public void StopMotor()
    {
        _motorDirection = 0;
        MotorPlayer.Stop();
    }

    public void StopRelayCues()
    {
        _relayQueue.Clear();
        if (_relayPlayback is not null)
        {
            foreach (var voice in _activeRelays)
            {
                if (_relayPlayback.IsStreamPlaying(voice)) _relayPlayback.StopStream(voice);
            }
        }
        _activeRelays.Clear();
    }

    public void Dispose()
    {
        if (_disposed) return;
        StopRelayCues();
        StopMotor();
        RelayPlayer.Stop();
        _relayPlayback?.Dispose();
        _relayPlayback = null;
        _disposed = true;
    }

    private void EnsureRelayPlayback()
    {
        if (_relayPlayback is not null) return;
        RelayPlayer.Play();
        _relayPlayback = RelayPlayer.GetStreamPlayback() as AudioStreamPlaybackPolyphonic ??
            throw new InvalidOperationException("audio sink: polyphonic relay playback unavailable");
    }

    private void RemoveFinishedRelayVoices()
    {
        if (_relayPlayback is null)
        {
            _activeRelays.Clear();
            return;
        }
        _activeRelays.RemoveAll(voice => !_relayPlayback.IsStreamPlaying(voice));
    }

    private AudioStream SampleFor(RelayCueKind kind) => AudioLayers.SelectRelaySample(kind) switch
    {
        RelaySampleKind.PullIn => _pullInSample,
        RelaySampleKind.DropOut => _dropOutSample,
        _ => throw new InvalidOperationException("audio sink: unknown relay sample kind"),
    };

}
