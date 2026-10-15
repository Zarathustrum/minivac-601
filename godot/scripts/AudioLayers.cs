using System;
using Godot;

namespace Minivac.Godot;

public enum RelaySampleKind
{
    PullIn,
    DropOut,
}

public static class AudioLayers
{
    public const string RoomBusName = "Room";
    public const int RelayPolyphony = 32;
    public const float Relay1PitchOffset = -0.030f;
    public const float Relay2PitchOffset = -0.018f;
    public const float Relay3PitchOffset = -0.006f;
    public const float Relay4PitchOffset = 0.006f;
    public const float Relay5PitchOffset = 0.018f;
    public const float Relay6PitchOffset = 0.030f;

    public static RelaySampleKind SelectRelaySample(RelayCueKind kind) => kind switch
    {
        RelayCueKind.PullIn => RelaySampleKind.PullIn,
        RelayCueKind.DropOut => RelaySampleKind.DropOut,
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "unknown relay cue kind"),
    };

    public static float PitchOffsetForRelay(int relay) => relay switch
    {
        1 => Relay1PitchOffset,
        2 => Relay2PitchOffset,
        3 => Relay3PitchOffset,
        4 => Relay4PitchOffset,
        5 => Relay5PitchOffset,
        6 => Relay6PitchOffset,
        _ => throw new ArgumentOutOfRangeException(nameof(relay), relay, "relay must be in 1..6"),
    };

    public static float PitchScaleForRelay(int relay) => 1.0f + PitchOffsetForRelay(relay);

    public static GodotAudioSink CreateSink(
        AudioStream pullInSample,
        AudioStream dropOutSample,
        AudioStream motorSample)
    {
        ArgumentNullException.ThrowIfNull(pullInSample);
        ArgumentNullException.ThrowIfNull(dropOutSample);
        ArgumentNullException.ThrowIfNull(motorSample);

        var roomBusIndex = EnsureRoomBus();
        var relayPlayer = new AudioStreamPlayer
        {
            Name = "RelayPlayer",
            Stream = pullInSample,
            Bus = RoomBusName,
        };
        var motorPlayer = new AudioStreamPlayer
        {
            Name = "MotorPlayer",
            Stream = motorSample,
            Bus = RoomBusName,
        };
        return new GodotAudioSink(
            relayPlayer,
            motorPlayer,
            pullInSample,
            dropOutSample,
            roomBusIndex);
    }

    private static int EnsureRoomBus()
    {
        var roomBusIndex = AudioServer.GetBusIndex(RoomBusName);
        if (roomBusIndex < 0)
        {
            AudioServer.AddBus(-1);
            AudioServer.SetBusName(AudioServer.BusCount - 1, RoomBusName);
            roomBusIndex = AudioServer.GetBusIndex(RoomBusName);
            if (roomBusIndex < 0)
                throw new InvalidOperationException("audio: Room bus was not created");
            AudioServer.SetBusSend(roomBusIndex, "Master");
        }

        var hasReverb = false;
        for (var effectIndex = 0; effectIndex < AudioServer.GetBusEffectCount(roomBusIndex); effectIndex++)
            hasReverb |= AudioServer.GetBusEffect(roomBusIndex, effectIndex) is AudioEffectReverb;
        if (!hasReverb) AudioServer.AddBusEffect(roomBusIndex, new AudioEffectReverb(), -1);

        return roomBusIndex;
    }
}
