using System;
using System.Collections.Generic;
using Godot;
using Minivac.Core;

namespace Minivac.Godot;

public partial class Stage3D : Node3D
{
    private PanelView? _panel;
    private Viewport? _pickingViewport;
    private bool _physicsObjectPickingBeforeMount;

    public OrbitCamera Camera { get; private set; } = null!;
    public WorldEnvironment World { get; private set; } = null!;
    public MeshInstance3D PanelQuad { get; private set; } = null!;
    public SubViewport PanelViewport { get; private set; } = null!;
    public QuadInput InputSurface { get; private set; } = null!;
    public CordMesh CordMeshes { get; private set; } = null!;
    public Node3D Tray { get; private set; } = null!;
    public Node3D Case { get; private set; } = null!;
    public PopOuts PopOuts { get; private set; } = null!;
    public DirectionalLight3D KeyLight { get; private set; } = null!;
    public LampGlow Glow { get; private set; } = null!;
    public PanelView Surface => _panel ?? throw new InvalidOperationException("stage3d: not initialized");

    public void Initialize(PanelView panel, Action toggleView)
    {
        if (_panel is not null) throw new InvalidOperationException("stage3d: already initialized");
        _panel = panel ?? throw new ArgumentNullException(nameof(panel));
        ArgumentNullException.ThrowIfNull(toggleView);
        Name = "Stage3D";
        _pickingViewport = GetViewport();
        _physicsObjectPickingBeforeMount = _pickingViewport.PhysicsObjectPicking;
        _pickingViewport.PhysicsObjectPicking = true;

        Camera = new OrbitCamera();
        AddChild(Camera);

        var environment = new global::Godot.Environment();
        var lighting = TactileTheme.SceneLighting.Value;
        environment.AmbientLightSource = global::Godot.Environment.AmbientSource.Color;
        environment.AmbientLightColor = lighting.Colour;
        environment.AmbientLightEnergy = (float)lighting.AmbientEnergy;
        World = new WorldEnvironment { Name = "WorldEnvironment", Environment = environment };
        AddChild(World);

        KeyLight = new DirectionalLight3D
        {
            Name = "KeyLight",
            LightColor = lighting.Colour,
            LightEnergy = (float)lighting.KeyEnergy,
            RotationDegrees = new Vector3(lighting.KeyRotationDeg.X, lighting.KeyRotationDeg.Y, 0),
        };
        AddChild(KeyLight);

        var mesh = new QuadMesh { Size = new(1, 1 / (float)PanelLayout.PanelAspect) };
        PanelQuad = new MeshInstance3D { Name = "PanelQuad" };
        PanelQuad.Mesh = mesh;
        AddChild(PanelQuad);

        PanelViewport = new SubViewport
        {
            Name = "SubViewport",
            Size = new Vector2I((int)TactileTheme.SubViewportSize.Value.X, (int)TactileTheme.SubViewportSize.Value.Y),
            UseHdr2D = true,
        };
        PanelQuad.AddChild(PanelViewport);
        PanelViewport.AddChild(panel);
        panel.Position = default;
        panel.Scale = new(1, 1);
        panel.PivotOffset = default;
        panel.Rotation = 0;
        panel.Size = TactileTheme.SubViewportSize.Value;

        var material = new StandardMaterial3D
        {
            AlbedoTexture = PanelViewport.GetTexture(),
            ShadingMode = StandardMaterial3D.ShadingModeEnum.Unshaded,
        };
        mesh.Material = material;

        InputSurface = new QuadInput();
        PanelQuad.AddChild(InputSurface);
        InputSurface.Initialize(
            PanelQuad, PanelViewport, mesh.Size, () => PanelViewport.Size, () => Camera.GestureActive);
        var collider = new CollisionShape3D
        {
            Name = "CollisionShape3D",
            Shape = new BoxShape3D
            {
                Size = new Vector3(mesh.Size.X, mesh.Size.Y, (float)TactileTheme.TaperPinStub.Value),
            },
        };
        InputSurface.AddChild(collider);

        Case = Case3D.Build(panel.Layout);
        AddChild(Case);
        PopOuts = new PopOuts();
        PopOuts.Initialize(panel.Layout);
        AddChild(PopOuts);
        Glow = new LampGlow();
        Glow.Initialize(World, PopOuts);

        Tray = new Node3D { Name = "Tray" };
        AddChild(Tray);
        CordMeshes = new CordMesh();
        AddChild(CordMeshes);
        CordMeshes.Initialize(Tray);
        Camera.Initialize(
            () => PanelViewport.GuiGetFocusOwner() is not null,
            key => PanelViewport.PushInput(key),
            () => PanelViewport.GuiGetFocusOwner()?.ReleaseFocus(),
            toggleView);
    }

    internal int RenderCords(IReadOnlyList<CordRecord> records, long nowUs, bool reduceMotion) =>
        CordMeshes.Render(records, nowUs, reduceMotion);

    internal void RenderPresentation(State state, Controls controls)
    {
        PopOuts.Render(state, controls);
        Glow.Render(state);
    }

    internal void ResetCords() => CordMeshes.Reset();

    public PanelView DetachPanel()
    {
        var panel = Surface;
        PanelViewport.RemoveChild(panel);
        _panel = null;
        RestorePhysicsObjectPicking();
        return panel;
    }

    public override void _ExitTree() => RestorePhysicsObjectPicking();

    public void SetView(string view)
    {
        if (view == "fit") Camera.ResetPose();
        else if (view == "wire") Camera.WirePose();
        else throw new InvalidOperationException("stage3d: unknown view " + view);
    }

    public void ZoomBy(double factor) => Camera.DollyBy(factor < 1 ? 1 : -1);

    public void PanBy(float x, float y) => Camera.PanBy(new(x, y));

    private void RestorePhysicsObjectPicking()
    {
        if (_pickingViewport is null) return;
        _pickingViewport.PhysicsObjectPicking = _physicsObjectPickingBeforeMount;
        _pickingViewport = null;
    }
}
