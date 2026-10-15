using System;
using Godot;
using Minivac.Core;

namespace Minivac.Godot;

public sealed class LampGlow
{
    private PopOuts? _popOuts;

    public void Initialize(WorldEnvironment world, PopOuts popOuts)
    {
        ArgumentNullException.ThrowIfNull(world);
        _popOuts = popOuts ?? throw new ArgumentNullException(nameof(popOuts));
        var environment = world.Environment ??
            throw new InvalidOperationException("lamp glow: missing environment");
        environment.GlowEnabled = true;
        environment.GlowIntensity = (float)TactileTheme.GlowIntensity.Value;
        environment.GlowBloom = (float)TactileTheme.GlowBloom.Value;
        environment.GlowHdrThreshold = (float)TactileTheme.GlowHdrThreshold.Value;
    }

    public void Render(State state)
    {
        ArgumentNullException.ThrowIfNull(state);
        var popOuts = _popOuts ?? throw new InvalidOperationException("lamp glow: not initialized");
        var materials = popOuts.LampMaterials;
        if (materials.Count != state.outLamps.Length + state.indLamps.Length)
            throw new InvalidOperationException("lamp glow: lens inventory mismatch");
        for (var index = 0; index < state.outLamps.Length; index++)
            materials[index].EmissionEnergyMultiplier = (float)EmissionEnergy(state.outLamps[index].milli);
        for (var index = 0; index < state.indLamps.Length; index++)
            materials[state.outLamps.Length + index].EmissionEnergyMultiplier =
                (float)EmissionEnergy(state.indLamps[index].milli);
        popOuts.JewelMaterial.EmissionEnergyMultiplier =
            state.railMv > 0 ? (float)TactileTheme.LampEmissionMax.Value : 0;
    }

    public static double EmissionEnergy(int milli) =>
        TactileTheme.LampEmissionMax.Value * milli / 1000;
}
