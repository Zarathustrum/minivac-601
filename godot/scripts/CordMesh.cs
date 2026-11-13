using System;
using System.Collections.Generic;
using Godot;

namespace Minivac.Godot;

public partial class CordMesh : Node3D
{
    private static readonly (float Cos, float Sin)[] TubeRing = BuildTubeRing();
    private readonly Dictionary<int, MeshInstance3D> _instances = [];
    private readonly Dictionary<int, Vector3[]> _builtParticles = [];
    private readonly Dictionary<int, MeshInstance3D> _marks = [];
    private static readonly IReadOnlySet<int> NoMarks = new HashSet<int>();
    private ImmediateMesh _markMesh = null!;
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
        _markMesh = BuildMark();
        BuildTray(tray);
    }

    /// <summary>Lays and draws the cords; <paramref name="marked"/> are the cord ids that carry the chat's mark.</summary>
    internal int Render(IReadOnlyList<CordRecord> records, long nowUs, bool reduceMotion, IReadOnlySet<int>? marked = null)
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
        RenderMarks(marked ?? NoMarks);
        return rebuilt;
    }

    // One ring per marked cord at the midpoint of its laid particles; it follows the cord as the lay settles.
    private void RenderMarks(IReadOnlySet<int> marked)
    {
        foreach (var pair in _instances)
        {
            if (!marked.Contains(pair.Key)) continue;
            if (!_marks.TryGetValue(pair.Key, out var mark))
            {
                mark = new MeshInstance3D { Name = "CordMark_" + pair.Key, Mesh = _markMesh };
                AddChild(mark);
                _marks.Add(pair.Key, mark);
            }
            var particles = _lay.Particles(pair.Key);
            mark.Position = (particles[particles.Count / 2 - 1] + particles[particles.Count / 2]) / 2;
        }
        var obsolete = new List<int>();
        foreach (var pair in _marks)
        {
            if (_instances.ContainsKey(pair.Key) && marked.Contains(pair.Key)) continue;
            pair.Value.Free();
            obsolete.Add(pair.Key);
        }
        foreach (var id in obsolete) _marks.Remove(id);
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
        foreach (var mark in _marks.Values) mark.Free();
        _marks.Clear();
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

    // The chat's cord mark (docs/plans/godot-chat-pane.md, "Cord marks"): a flat ring that always faces the
    // camera, a hole across, in the one presentation token over a dark keyline, drawn over the case and pop-outs
    // so the default pose shows it. Hollow, so the cord's own colour shows through. Static: no motion.
    private static ImmediateMesh BuildMark()
    {
        var mesh = new ImmediateMesh();
        var radius = (float)TactileTheme.CordRadius.Value;
        // A hole across plus a cord on each side: the default pose shows the panel smaller than the flat fit view.
        var outer = (float)TactileTheme.HoleHit.Value + radius * 2;
        var inner = outer - radius * 2;
        EmitRing(mesh, MakeMarkMaterial(TactileTheme.ConsoleDark.Value, 0), inner - radius * 0.5f, outer + radius * 0.5f);
        EmitRing(mesh, MakeMarkMaterial(TactileTheme.CordMarkColour.Value, 1), inner, outer);
        return mesh;
    }

    private static void EmitRing(ImmediateMesh mesh, StandardMaterial3D material, float inner, float outer)
    {
        var segments = TactileTheme.MeshQuality.Value.RadialSegments;
        mesh.SurfaceBegin(Mesh.PrimitiveType.Triangles, material);
        for (var index = 0; index < segments; index++)
        {
            var a = Math.Tau * index / segments;
            var b = Math.Tau * (index + 1) / segments;
            var aIn = new Vector3((float)Math.Cos(a) * inner, (float)Math.Sin(a) * inner, 0);
            var aOut = new Vector3((float)Math.Cos(a) * outer, (float)Math.Sin(a) * outer, 0);
            var bIn = new Vector3((float)Math.Cos(b) * inner, (float)Math.Sin(b) * inner, 0);
            var bOut = new Vector3((float)Math.Cos(b) * outer, (float)Math.Sin(b) * outer, 0);
            EmitTriangle(mesh, aIn, Vector3.Back, aOut, Vector3.Back, bOut, Vector3.Back);
            EmitTriangle(mesh, aIn, Vector3.Back, bOut, Vector3.Back, bIn, Vector3.Back);
        }
        mesh.SurfaceEnd();
    }

    private static StandardMaterial3D MakeMarkMaterial(Color color, int priority) => new()
    {
        AlbedoColor = color,
        ShadingMode = StandardMaterial3D.ShadingModeEnum.Unshaded,
        BillboardMode = BaseMaterial3D.BillboardModeEnum.Enabled,
        CullMode = BaseMaterial3D.CullModeEnum.Disabled,
        NoDepthTest = true,
        RenderPriority = priority,
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
