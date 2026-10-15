using System;
using System.Collections.Generic;
using Godot;

namespace Minivac.Godot;

public partial class CordMesh : Node3D
{
    private static readonly (float Cos, float Sin)[] TubeRing = BuildTubeRing();
    private readonly Dictionary<int, MeshInstance3D> _instances = [];
    private readonly Dictionary<int, Vector3[]> _builtParticles = [];
    private CordLay _lay = new();
    private StandardMaterial3D _cordMaterial = null!;
    private StandardMaterial3D _pinMaterial = null!;

    internal CordLay Lay => _lay;

    internal void Initialize(Node3D tray)
    {
        ArgumentNullException.ThrowIfNull(tray);
        Name = "CordMeshes";
        _cordMaterial = MakeMaterial(TactileTheme.CordColour.Value);
        _pinMaterial = MakeMaterial(TactileTheme.TaperPinGrey.Value);
        BuildTray(tray);
    }

    internal int Render(IReadOnlyList<CordRecord> records, long nowUs, bool reduceMotion)
    {
        _lay.Reconcile(records);
        if (reduceMotion) _lay.SettleNow();
        else _lay.Step(nowUs);

        var live = new HashSet<int>();
        var rebuilt = 0;
        foreach (var record in records)
        {
            live.Add(record.Id);
            var particles = _lay.Particles(record.Id);
            if (!Moved(record.Id, particles)) continue;
            Rebuild(record.Id);
            rebuilt++;
        }

        var obsolete = new List<int>();
        foreach (var pair in _instances)
        {
            if (live.Contains(pair.Key)) continue;
            pair.Value.Free();
            obsolete.Add(pair.Key);
        }
        foreach (var id in obsolete)
        {
            _instances.Remove(id);
            _builtParticles.Remove(id);
        }
        return rebuilt;
    }

    internal void Reset()
    {
        ClearAll();
        _lay = new CordLay();
    }

    public void Rebuild(int cordId)
    {
        var particles = _lay.Particles(cordId);
        if (!_instances.TryGetValue(cordId, out var instance))
        {
            instance = new MeshInstance3D { Name = "Cord_" + cordId };
            AddChild(instance);
            _instances.Add(cordId, instance);
        }

        var mesh = instance.Mesh as ImmediateMesh ?? new ImmediateMesh();
        instance.Mesh = mesh;
        mesh.ClearSurfaces();
        mesh.SurfaceBegin(Mesh.PrimitiveType.Triangles, _cordMaterial);
        for (var index = 0; index < particles.Count - 1; index++)
            EmitTubeSegment(mesh, particles[index], particles[index + 1], (float)TactileTheme.CordRadius.Value);
        mesh.SurfaceEnd();

        mesh.SurfaceBegin(Mesh.PrimitiveType.Triangles, _pinMaterial);
        var first = particles[0];
        var last = particles[^1];
        EmitTubeSegment(mesh, new Vector3(first.X, first.Y, 0), first, (float)(TactileTheme.CordRadius.Value * 0.5));
        EmitTubeSegment(mesh, new Vector3(last.X, last.Y, 0), last, (float)(TactileTheme.CordRadius.Value * 0.5));
        mesh.SurfaceEnd();
        _builtParticles[cordId] = Copy(particles);
    }

    public void ClearAll()
    {
        foreach (var instance in _instances.Values) instance.Free();
        _instances.Clear();
        _builtParticles.Clear();
    }

    private bool Moved(int cordId, IReadOnlyList<Vector3> particles)
    {
        if (!_builtParticles.TryGetValue(cordId, out var previous) || previous.Length != particles.Count)
            return true;
        var epsilonSquared = (float)(TactileTheme.RebuildEpsilon.Value * TactileTheme.RebuildEpsilon.Value);
        for (var index = 0; index < particles.Count; index++)
            if (previous[index].DistanceSquaredTo(particles[index]) > epsilonSquared) return true;
        return false;
    }

    private static void EmitTubeSegment(ImmediateMesh mesh, Vector3 a, Vector3 b, float radius)
    {
        var tangent = (b - a).Normalized();
        if (tangent == Vector3.Zero) return;
        var side = tangent.Cross(Vector3.Back);
        if (side == Vector3.Zero) side = tangent.Cross(Vector3.Up);
        side = side.Normalized();
        var up = side.Cross(tangent).Normalized();
        var sides = TactileTheme.TubeSides.Value;
        for (var radial = 0; radial < sides; radial++)
        {
            var ringA = TubeRing[radial];
            var ringB = TubeRing[radial + 1];
            var normalA = side * ringA.Cos + up * ringA.Sin;
            var normalB = side * ringB.Cos + up * ringB.Sin;
            var aA = a + normalA * radius;
            var bA = b + normalA * radius;
            var bB = b + normalB * radius;
            var aB = a + normalB * radius;
            EmitTriangle(mesh, aA, normalA, bA, normalA, bB, normalB);
            EmitTriangle(mesh, aA, normalA, bB, normalB, aB, normalB);
        }
    }

    private static (float Cos, float Sin)[] BuildTubeRing()
    {
        var sides = TactileTheme.TubeSides.Value;
        var ring = new (float Cos, float Sin)[sides + 1];
        for (var radial = 0; radial <= sides; radial++)
        {
            var angle = Math.Tau * radial / sides;
            ring[radial] = ((float)Math.Cos(angle), (float)Math.Sin(angle));
        }
        return ring;
    }

    private static void EmitTriangle(
        ImmediateMesh mesh,
        Vector3 a,
        Vector3 normalA,
        Vector3 b,
        Vector3 normalB,
        Vector3 c,
        Vector3 normalC)
    {
        mesh.SurfaceSetNormal(normalA);
        mesh.SurfaceAddVertex(a);
        mesh.SurfaceSetNormal(normalB);
        mesh.SurfaceAddVertex(b);
        mesh.SurfaceSetNormal(normalC);
        mesh.SurfaceAddVertex(c);
    }

    private static StandardMaterial3D MakeMaterial(Color color) => new()
    {
        AlbedoColor = color,
        ShadingMode = StandardMaterial3D.ShadingModeEnum.Unshaded,
    };

    private static void BuildTray(Node3D tray)
    {
        var mesh = new ImmediateMesh();
        var radius = (float)TactileTheme.CordRadius.Value;
        var y = (float)((0 - 0.5) / PanelLayout.PanelAspect) + radius;
        var z = radius * 0.5f;
        var left = new Vector3(0 - 0.5f, y - radius, z);
        var right = new Vector3(0.5f, y - radius, z);
        var upperLeft = new Vector3(0 - 0.5f, y + radius, z);
        var upperRight = new Vector3(0.5f, y + radius, z);
        mesh.SurfaceBegin(Mesh.PrimitiveType.Triangles, MakeMaterial(TactileTheme.TaperPinGrey.Value));
        EmitTriangle(mesh, left, Vector3.Back, right, Vector3.Back, upperRight, Vector3.Back);
        EmitTriangle(mesh, left, Vector3.Back, upperRight, Vector3.Back, upperLeft, Vector3.Back);
        mesh.SurfaceEnd();
        tray.AddChild(new MeshInstance3D { Name = "TrayStrip", Mesh = mesh });
    }

    private static Vector3[] Copy(IReadOnlyList<Vector3> particles)
    {
        var copy = new Vector3[particles.Count];
        for (var index = 0; index < particles.Count; index++) copy[index] = particles[index];
        return copy;
    }
}
