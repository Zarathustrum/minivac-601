using System;
using System.IO;
using System.Text.RegularExpressions;
using Xunit;

namespace Minivac.Godot.Tests;

public sealed class P4Stage3DLifecycleTests
{
    [Fact]
    public void Stage3d_restores_the_root_physics_picking_state_it_replaced()
    {
        var path = Path.Combine(RepoRoot(), "godot", "scripts", "Stage3D.cs");
        Assert.True(File.Exists(path), "missing Stage3D.cs");
        Assert.True(OwnsPhysicsPickingLifecycle(File.ReadAllText(path)));

        const string previousImplementation = "GetViewport().PhysicsObjectPicking = true;";
        Assert.False(OwnsPhysicsPickingLifecycle(previousImplementation));
    }

    private static bool OwnsPhysicsPickingLifecycle(string source) =>
        Regex.IsMatch(source,
            @"_pickingViewport\s*=\s*GetViewport\(\)\s*;.*?_physicsObjectPickingBeforeMount\s*=\s*_pickingViewport\.PhysicsObjectPicking\s*;.*?_pickingViewport\.PhysicsObjectPicking\s*=\s*true\s*;",
            RegexOptions.Singleline) &&
        Regex.IsMatch(source,
            @"public\s+PanelView\s+DetachPanel\(\).*?RestorePhysicsObjectPicking\(\)\s*;.*?return\s+panel\s*;",
            RegexOptions.Singleline) &&
        Regex.IsMatch(source,
            @"public\s+override\s+void\s+_ExitTree\(\)\s*=>\s*RestorePhysicsObjectPicking\(\)\s*;") &&
        Regex.IsMatch(source,
            @"private\s+void\s+RestorePhysicsObjectPicking\(\).*?_pickingViewport\.PhysicsObjectPicking\s*=\s*_physicsObjectPickingBeforeMount\s*;.*?_pickingViewport\s*=\s*null\s*;",
            RegexOptions.Singleline);

    private static string RepoRoot() =>
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../.."));
}
