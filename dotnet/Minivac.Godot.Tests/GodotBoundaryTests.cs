using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Xunit;

namespace Minivac.Godot.Tests;

public sealed class GodotBoundaryTests
{
    private enum CoreSurface { None, ContractAndTrace, All }

    private sealed record AllowListRow(
        bool AllGodot,
        CoreSurface Core,
        bool AllConformance,
        string[] GodotApis,
        string[] ConformanceApis,
        string[] LocalLoaderApis);

    // Appendix A's normative live transcription: exactly the scripts that exist.
    private static readonly IReadOnlyDictionary<string, AllowListRow> LiveAllowList =
        new Dictionary<string, AllowListRow>(StringComparer.Ordinal)
        {
            ["Boot.cs"] = new(
                true, CoreSurface.All, false,
                ["GD", "RenderingServer"],
                ["IArtifactSource"],
                ["GodotResourceSource"]),
            ["Session.cs"] = new(
                false, CoreSurface.All, false,
                [], [], []),
            ["DemoLibrary.cs"] = new(
                false, CoreSurface.All, false,
                [], ["IArtifactSource"], []),
            ["SelfTest.cs"] = new(
                true, CoreSurface.All, true,
                ["Engine", "SceneTree", "GD"],
                [], []),
            ["GodotResourceSource.cs"] = new(
                false, CoreSurface.None, false,
                ["FileAccess", "DirAccess", "Error"],
                ["IArtifactSource"],
                ["GodotResourceSource"]),
            ["Loop.cs"] = new(
                false, CoreSurface.ContractAndTrace, false,
                ["Node", "Time"], [], []),
            ["FrameLoop.cs"] = new(
                false, CoreSurface.ContractAndTrace, false,
                [], [], []),
            ["TraceView.cs"] = new(
                false, CoreSurface.ContractAndTrace, false,
                ["RichTextLabel"], [], []),
            ["Acceptance.cs"] = new(
                true, CoreSurface.All, true,
                ["GD"], [], []),
            ["Preferences.cs"] = new(
                false, CoreSurface.None, false,
                ["ConfigFile", "Node"], [], []),
            ["Chrome.cs"] = new(
                false, CoreSurface.None, false,
                ["CanvasLayer", "Control"], [], []),
            ["PanelLayout.cs"] = new(
                false, CoreSurface.None, false,
                ["Vector2"], [], []),
            ["PanelTheme.cs"] = new(
                false, CoreSurface.None, false,
                ["Color", "Vector2"], [], []),
            ["PanelView.cs"] = new(
                false, CoreSurface.None, false,
                ["Control", "Button", "Panel", "Line2D", "TextureRect", "Label", "FontVariation", "SystemFont", "Vector2", "Color"], [], []),
            ["Stage.cs"] = new(
                false, CoreSurface.None, false,
                ["Control", "InputEvent*", "Vector2"], [], []),
            ["Commands.cs"] = new(
                false, CoreSurface.ContractAndTrace, false,
                [], [], []),
            ["Controls.cs"] = new(
                false, CoreSurface.ContractAndTrace, false,
                ["Control", "Button", "Range", "Slider", "InputEvent*", "Vector2"], [], []),
            ["CordModel.cs"] = new(
                false, CoreSurface.ContractAndTrace, false,
                [], [], []),
            ["Cords.cs"] = new(
                false, CoreSurface.ContractAndTrace, false,
                ["Control", "Line2D", "InputEvent*", "Vector2", "Color"], [], []),
            ["CordList.cs"] = new(
                false, CoreSurface.ContractAndTrace, false,
                ["Control", "Button", "Vector2"], [], []),
            ["Picker.cs"] = new(
                false, CoreSurface.ContractAndTrace, false,
                ["Control", "LineEdit", "Button", "Vector2"], [], []),
            ["Lamps.cs"] = new(
                false, CoreSurface.ContractAndTrace, false,
                ["Control", "Color", "Vector2"], [], []),
            ["Toolbar.cs"] = new(
                false, CoreSurface.None, false,
                ["Control", "Button"], [], []),
            ["Drawer.cs"] = new(
                false, CoreSurface.None, false,
                ["Control", "Button"], [], []),
            ["DemoExperience.cs"] = new(
                false, CoreSurface.None, false,
                ["Control", "Button", "Label", "RichTextLabel", "Rect2"], [], []),
            ["Diagnostics.cs"] = new(
                false, CoreSurface.ContractAndTrace, false,
                ["Control", "RichTextLabel", "Label"], [], []),
            ["HelpCredits.cs"] = new(
                false, CoreSurface.None, false,
                ["AcceptDialog", "Control", "OS"], [], []),
            ["AudioSchedule.cs"] = new(
                false, CoreSurface.ContractAndTrace, false,
                [], [], []),
            ["AudioRouter.cs"] = new(
                false, CoreSurface.ContractAndTrace, false,
                ["Node"], [], []),
            ["GodotAudioSink.cs"] = new(
                false, CoreSurface.None, false,
                ["AudioStream", "AudioStreamPlayer", "AudioStreamPolyphonic", "AudioStreamPlaybackPolyphonic", "AudioServer"], [], []),
            ["AudioLayers.cs"] = new(
                false, CoreSurface.None, false,
                ["AudioServer", "AudioStream", "AudioStreamPlayer", "AudioEffectReverb"], [], []),
            ["Stage3D.cs"] = new(
                false, CoreSurface.ContractAndTrace, false,
                ["Node3D", "Camera3D", "WorldEnvironment", "Environment", "MeshInstance3D", "QuadMesh",
                    "SubViewport", "ViewportTexture", "Area3D", "CollisionShape3D", "BoxShape3D", "Viewport",
                    "Vector2I", "Vector2", "Vector3", "Color", "StandardMaterial3D", "DirectionalLight3D"], [], []),
            ["QuadInput.cs"] = new(
                false, CoreSurface.None, false,
                ["Area3D", "Camera3D", "Viewport", "MeshInstance3D", "Mesh", "Transform3D", "Vector2", "Vector3",
                    "Vector2I", "InputEvent*", "MouseButton", "Node"], [], []),
            ["QuadMap.cs"] = new(
                false, CoreSurface.None, false,
                ["Vector2", "Vector2I", "Vector3", "Transform3D"], [], []),
            ["OrbitCamera.cs"] = new(
                false, CoreSurface.None, false,
                ["Camera3D", "Node3D", "InputEvent*", "Input", "Key", "MouseButton", "Vector2", "Vector3"], [], []),
            ["OrbitMath.cs"] = new(
                false, CoreSurface.None, false,
                ["Vector2", "Vector2I", "Vector3", "Transform3D"], [], []),
            ["CordLay.cs"] = new(
                false, CoreSurface.None, false,
                ["Vector2", "Vector3"], [], []),
            ["CordMesh.cs"] = new(
                false, CoreSurface.None, false,
                ["ImmediateMesh", "MeshInstance3D", "Node3D", "StandardMaterial3D", "BaseMaterial3D",
                    "Mesh", "Vector3", "Color"], [], []),
            ["PopOuts.cs"] = new(
                false, CoreSurface.ContractAndTrace, false,
                ["MeshInstance3D", "Node3D", "BaseMaterial3D", "StandardMaterial3D", "Vector2", "Vector3", "Color"], [], []),
            ["Case3D.cs"] = GeometryRow(),
            ["Knob3D.cs"] = GeometryRow(),
            ["Relay3D.cs"] = GeometryRow(),
            ["Bezels.cs"] = GeometryRow(),
            ["LampGlow.cs"] = new(
                false, CoreSurface.ContractAndTrace, false,
                ["BaseMaterial3D", "MeshInstance3D", "WorldEnvironment", "Environment", "Color"], [], []),
            ["TactileTheme.cs"] = new(
                false, CoreSurface.None, false,
                ["Color", "Vector2"], [], []),
        };

    private static AllowListRow GeometryRow() => new(
        false, CoreSurface.None, false,
        ["MeshInstance3D", "Node3D", "ArrayMesh", "SurfaceTool", "BaseMaterial3D",
            "StandardMaterial3D", "Color", "Vector2", "Vector3", "Mesh"], [], []);

    // The union of Godot API names in Appendix A's forward table. This is deliberately not the
    // live transcription: an API that a new script adds must be detectable before any live row names it.
    private static readonly HashSet<string> ForwardAppendixGodotApis = new(StringComparer.Ordinal)
    {
        "AcceptDialog", "Area3D", "ArrayMesh", "AudioEffectReverb", "AudioServer", "AudioStream",
        "AudioStreamPlaybackPolyphonic", "AudioStreamPlayer",
        "AudioStreamPolyphonic", "BaseMaterial3D", "BoxShape3D", "Button", "Camera3D",
        "CanvasLayer", "CollisionShape3D", "Color", "ConfigFile", "Control", "DirAccess",
        "DirectionalLight3D", "Engine", "Environment", "Error", "FileAccess", "FontVariation", "GD", "ImmediateMesh", "Input",
        "InputEvent*", "Label", "Line2D", "Mesh", "MeshInstance3D", "Node", "Node3D", "OS",
        "Panel", "QuadMesh", "Range", "RichTextLabel", "SceneTree", "Slider",
        "StandardMaterial3D", "SubViewport", "SurfaceTool", "SystemFont", "TextureRect", "Time",
        "Transform3D", "Vector2", "Vector2I", "Vector3", "Viewport", "ViewportTexture",
        "WorldEnvironment",
    };

    private static readonly HashSet<string> DetectionOnlyGodotApis = new(StringComparer.Ordinal)
    {
        "GD", "RenderingServer", "ProjectSettings", "ResourceLoader", "Json", "Resource",
        "RefCounted",
    };

    private static readonly HashSet<string> GodotVocabulary = new(
        ForwardAppendixGodotApis.Select(api => api.TrimEnd('*')).Concat(
        [
            "Node", "Node3D", "Control", "CanvasLayer", "Resource", "RefCounted",
            "GD", "OS", "Time", "Engine", "Input", "AudioServer", "RenderingServer",
            "ResourceLoader", "Json", "FileAccess", "DirAccess", "ProjectSettings",
        ]),
        StringComparer.Ordinal);

    private static readonly HashSet<string> SessionFiles = new(StringComparer.Ordinal)
    {
        "Boot.cs", "Session.cs", "DemoLibrary.cs", "SelfTest.cs", "GodotResourceSource.cs",
        "Acceptance.cs",
    };

    private static readonly HashSet<string> ContractAndTraceCoreApis = new(StringComparer.Ordinal)
    {
        "Contract", "CordEnd", "Command", "CmdResult", "CmdWhy", "ChatterDev", "TraceAnomaly",
        "Note", "Event", "RelayBand", "LampClass", "State", "Machine", "ObservableDef",
        "ObservableContact", "ObservableRelay", "ObservableButton", "ObservableSwitch",
        "ObservableDial", "ObservableLamp", "ObservableSource", "ChatterWorkspace",
        "TraceException", "Trace",
    };

    private static readonly HashSet<string> CoreLoaderMembers = new(StringComparer.Ordinal)
    {
        "LoadNetlist", "LoadProfile", "CreateMachine", "AllocateHoles", "parseTerminalId",
        "terminalIndex", "terminalAt", "holeAt", "holeByIndex", "parseTerminalWire",
        "parseHoleId", "parseProgramDesignator",
    };

    private static readonly HashSet<string> GodotTypeNames = PublicTopLevelTypeNames(
        typeof(global::Godot.Node).Assembly,
        "Godot");

    private static readonly HashSet<string> CoreTypeNames = PublicTopLevelTypeNames(
        typeof(global::Minivac.Core.Contract).Assembly,
        "Minivac.Core");

    private static readonly HashSet<string> ConformanceTypeNames = PublicTopLevelTypeNames(
        typeof(global::Minivac.Conformance.IArtifactSource).Assembly,
        "Minivac.Conformance");

    private static readonly Regex JsonResourceLoad = Pattern(
        @"\b(?:(?:GD|ResourceLoader)\s*\.\s*(?:Load|LoadThreadedRequest)|Json\s*\.\s*Parse)\b");
    private static readonly Regex SessionIdentifier = Pattern(@"\bSession\b");
    private static readonly Regex BankerRounding = Pattern(@"\bMath\s*\.\s*Round\b");
    private static readonly Regex AmbientInput = Pattern(@"\b(?:DateTime|Random|Stopwatch)\b|\bTime\s*\.");
    private static readonly Regex SystemIo = Pattern(
        @"\b(?:global\s*::\s*)?System\s*\.\s*IO\b|\b(?:File|Directory|FileInfo|DirectoryInfo|Path|FileStream|StreamReader|StreamWriter|BinaryReader|BinaryWriter)\s*(?:\.|\()");
    private static readonly Regex Identifier = Pattern(@"\b[A-Za-z_]\w*\b");

    [Fact]
    public void Scripts_never_load_json_as_a_resource() =>
        Assert.Empty(AllViolations(FindJsonResourceLoads));

    [Fact]
    public void Presentation_scripts_do_not_name_session_or_conformance()
    {
        var violations = AllViolations((fileName, source) =>
        {
            var executable = MaskCommentsAndLiterals(source);
            var sessionViolations = SessionFiles.Contains(fileName)
                ? []
                : Matches(fileName, executable, SessionIdentifier, "rule 2 Session");
            return sessionViolations.Concat(
                FindConformanceViolations(fileName, executable, LiveAllowList));
        });

        Assert.Empty(violations);
    }

    [Fact]
    public void Presentation_scripts_do_not_name_the_core_loaders()
    {
        var violations = AllViolations((fileName, source) => FindCoreBoundaryViolations(
            fileName,
            MaskCommentsAndLiterals(source),
            LiveAllowList));

        Assert.Empty(violations);
    }

    [Fact]
    public void Scripts_never_use_banker_rounding() =>
        Assert.Empty(AllViolations((fileName, source) =>
            Matches(fileName, MaskCommentsAndLiterals(source), BankerRounding, "rule 5 Math.Round")));

    [Fact]
    public void Scripts_read_no_ambient_input_outside_the_loop()
    {
        var permitted = new HashSet<string>(StringComparer.Ordinal) { "Loop.cs", "Acceptance.cs" };
        var violations = AllViolations((fileName, source) =>
            permitted.Contains(fileName)
                ? []
                : Matches(fileName, MaskCommentsAndLiterals(source), AmbientInput, "rule 6 ambient input"));

        Assert.Empty(violations);
    }

    [Fact]
    public void Every_script_has_an_allow_list_row()
    {
        var violations = ScriptFiles()
            .Select(path => Path.GetFileName(path)!)
            .Where(fileName => !LiveAllowList.ContainsKey(fileName))
            .Select(fileName => $"{fileName}: rule 7 has no allow-list row")
            .ToArray();

        Assert.Empty(violations);
    }

    [Fact]
    public void Every_named_godot_api_appears_in_its_files_row()
    {
        var violations = AllViolations((fileName, source) =>
            FindAllowListViolations(fileName, source, LiveAllowList)).ToArray();

        Assert.True(violations.Length == 0, string.Join(Environment.NewLine, violations));
    }

    [Fact]
    public void No_transcribed_row_names_a_missing_file()
    {
        var files = ScriptFiles().Select(path => Path.GetFileName(path)!).ToHashSet(StringComparer.Ordinal);
        var violations = LiveAllowList.Keys
            .Where(fileName => !files.Contains(fileName))
            .Select(fileName => $"{fileName}: rule 7 transcribed row names a missing file")
            .ToArray();

        Assert.Empty(violations);
    }

    [Fact]
    public void Transcribed_row_count_equals_script_count() =>
        Assert.Equal(ScriptFiles().Count, LiveAllowList.Count);

    [Fact]
    public void Every_vocabulary_member_is_named_by_some_forward_appendix_a_row()
    {
        var gaps = GodotVocabulary
            .Except(DetectionOnlyGodotApis)
            .Where(api => !IsPermittedApi(api, ForwardAppendixGodotApis))
            .Order(StringComparer.Ordinal)
            .Select(api => $"Appendix A: rule 7 vocabulary member {api} has no forward row")
            .ToArray();

        Assert.Empty(gaps);
    }

    [Fact]
    public void Scanner_flags_an_inline_json_resource_load()
    {
        var sources = new[]
        {
            "GD.Load(\"res://data/netlist.json\");",
            "GD.Load<Resource>(\"res://data/netlist.json\");",
            "ResourceLoader.Load<Resource>(\"res://data/netlist.json\");",
            "GD.Load<Resource>(/* payload */ \"res://data/netlist.json\");",
            "ResourceLoader.Load<Resource>(/* payload */ \"res://data/netlist.json\");",
            "GD.Load/* call */<Resource>(\"res://data/netlist.json\");",
            "GD.Load<Resource>/* call */(\"res://data/netlist.json\");",
            "ResourceLoader.Load/* call */<Resource>(\"res://data/netlist.json\");",
            "ResourceLoader.Load<Resource>/* call */(\"res://data/netlist.json\");",
            "GD/* call */.Load<Resource>(\"res://data/netlist.json\");",
            "GD./* call */Load<Resource>(\"res://data/netlist.json\");",
            "ResourceLoader/* call */.Load<Resource>(\"res://data/netlist.json\");",
            "GD.Load<Resource>(path: \"res://data/netlist.json\");",
            "ResourceLoader.Load<Resource>(path: \"res://data/netlist.json\");",
            "GD.Load<Resource>(typeHint: \"\", path: \"res://data/netlist.json\");",
            "ResourceLoader.Load<Resource>(typeHint: \"\", path: \"res://data/netlist.json\");",
            "GD.Load<Resource>(@path: \"res://data/netlist.json\");",
            "ResourceLoader.Load<Resource>(@path: \"res://data/netlist.json\");",
            "ResourceLoader.Load<Resource>(typeHint: Make(1, 2), path: \"res://data/netlist.json\");",
            "ResourceLoader.Load<Resource>(condition: 1 < 2, path: \"res://data/netlist.json\");",
        };

        foreach (var source in sources)
        {
            var violation = Assert.Single(FindJsonResourceLoads("Probe.cs", source));
            Assert.Contains("Probe.cs", violation, StringComparison.Ordinal);
            Assert.Contains("JSON-as-resource", violation, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Scanner_allows_a_non_json_resource_load()
    {
        foreach (var source in new[]
        {
            "GD.Load(\"res://models/case.tscn\");",
            "ResourceLoader.Load<Resource>(typeHint: \"\", path: \"res://models/case.tscn\");",
            "ResourceLoader.Load<Resource>(typeHint: Make(1, \"res://data/netlist.json\"), path: \"res://models/case.tscn\");",
            "ResourceLoader.Load<Resource>(typeHint: \"\"); var path = \"res://data/netlist.json\";",
        })
        {
            Assert.Empty(FindJsonResourceLoads("Probe.cs", source));
        }
    }

    [Fact]
    public void Scanner_masks_session_in_comments_and_string_literals()
    {
        var source = "// Session\nvar text = \"Session\"; /* Session */";

        Assert.DoesNotMatch(SessionIdentifier, MaskCommentsAndLiterals(source));
    }

    [Fact]
    public void Scanner_flags_a_file_with_no_allow_list_row()
    {
        var violations = FindAllowListViolations("Missing.cs", "class Missing {}", LiveAllowList);

        var violation = Assert.Single(violations);
        Assert.Contains("Missing.cs", violation, StringComparison.Ordinal);
        Assert.Contains("no allow-list row", violation, StringComparison.Ordinal);
    }

    [Fact]
    public void Scanner_flags_a_bare_godot_api_absent_from_the_files_row()
    {
        IReadOnlyDictionary<string, AllowListRow> rows =
            new Dictionary<string, AllowListRow>(StringComparer.Ordinal)
            {
                ["Probe.cs"] = new(
                    false, CoreSurface.ContractAndTrace, false,
                    ["Node"], [], []),
            };

        var violations = FindAllowListViolations("Probe.cs", "class Probe : Area3D {}", rows);

        var violation = Assert.Single(violations);
        Assert.Contains("Probe.cs", violation, StringComparison.Ordinal);
        Assert.Contains("Area3D", violation, StringComparison.Ordinal);
    }

    [Fact]
    public void Scanner_rejects_non_contract_core_apis_from_presentation_files()
    {
        foreach (var api in new[] { "Graph", "Solve", "Profile" })
        {
            foreach (var source in new[]
            {
                $"using Minivac.Core; class Probe {{ {api}? value; }}",
                $"using Minivac.Core; class Probe {{ List<{api}>? values; }}",
                $"using Minivac.Core; class Probe {{ ({api}, int)? value; }}",
            })
            {
                var violations = FindCoreBoundaryViolations(
                    "TraceView.cs",
                    source,
                    LiveAllowList);

                Assert.Contains(violations, violation =>
                    violation.Contains("TraceView.cs", StringComparison.Ordinal) &&
                    violation.Contains(api, StringComparison.Ordinal));
            }
        }
    }

    [Fact]
    public void Scanner_rejects_system_io_from_godot_scripts()
    {
        var violations = FindCoreBoundaryViolations(
            "TraceView.cs",
            "using System.IO; class Probe { string Read() => File.ReadAllText(\"x\"); }",
            LiveAllowList);

        Assert.Contains(violations, violation =>
            violation.Contains("TraceView.cs", StringComparison.Ordinal) &&
            violation.Contains("System.IO", StringComparison.Ordinal));
    }

    [Fact]
    public void Scanner_enforces_per_file_conformance_permissions()
    {
        var probes = new[]
        {
            ("Session.cs", "using Minivac.Conformance; class Probe { IArtifactSource? source; }", "IArtifactSource"),
            ("DemoLibrary.cs", "using Minivac.Conformance; class Probe { TraceRunner? runner; }", "TraceRunner"),
            ("DemoLibrary.cs", "using Minivac.Conformance; class Probe { List<TraceRunner>? runners; }", "TraceRunner"),
            ("DemoLibrary.cs", "using Minivac.Conformance; class Probe { (TraceRunner, int)? runner; }", "TraceRunner"),
            ("Boot.cs", "using Minivac.Conformance; class Probe { FileSystemSource? source; }", "FileSystemSource"),
        };

        foreach (var (fileName, source, api) in probes)
        {
            var violations = FindConformanceViolations(fileName, source, LiveAllowList);
            Assert.Contains(violations, violation =>
                violation.Contains(fileName, StringComparison.Ordinal) &&
                violation.Contains(api, StringComparison.Ordinal));
        }

        var localLoaderViolation = Assert.Single(FindCoreBoundaryViolations(
            "Session.cs",
            "class Probe { GodotResourceSource? source; }",
            LiveAllowList));
        Assert.Contains("GodotResourceSource", localLoaderViolation, StringComparison.Ordinal);
    }

    [Fact]
    public void Scanner_preserves_narrow_conformance_allowances()
    {
        Assert.Empty(FindConformanceViolations(
            "Boot.cs",
            "using Minivac.Conformance; class Probe { IArtifactSource? source; }",
            LiveAllowList));
        Assert.Empty(FindConformanceViolations(
            "DemoLibrary.cs",
            "using Minivac.Conformance; class Probe { IArtifactSource? source; }",
            LiveAllowList));
        Assert.Empty(FindConformanceViolations(
            "GodotResourceSource.cs",
            "using Minivac.Conformance; class Probe { IArtifactSource? source; }",
            LiveAllowList));
        Assert.Empty(FindCoreBoundaryViolations(
            "Boot.cs",
            "class Probe { GodotResourceSource? source; }",
            LiveAllowList));
    }

    [Fact]
    public void Scanner_applies_input_event_wildcards_only_to_permitting_rows()
    {
        IReadOnlyDictionary<string, AllowListRow> permitted =
            new Dictionary<string, AllowListRow>(StringComparer.Ordinal)
            {
                ["Probe.cs"] = new(
                    false, CoreSurface.ContractAndTrace, false,
                    ["InputEvent*"], [], []),
            };
        IReadOnlyDictionary<string, AllowListRow> denied =
            new Dictionary<string, AllowListRow>(StringComparer.Ordinal)
            {
                ["Probe.cs"] = new(
                    false, CoreSurface.ContractAndTrace, false,
                    ["Node"], [], []),
            };
        const string source = "using Godot; class Probe { InputEventMouseButton? input; }";

        Assert.Empty(FindAllowListViolations("Probe.cs", source, permitted));
        var violation = Assert.Single(FindAllowListViolations("Probe.cs", source, denied));
        Assert.Contains("InputEventMouseButton", violation, StringComparison.Ordinal);
    }

    [Fact]
    public void Scanner_rejects_godot_types_absent_from_the_fixed_plan_vocabulary()
    {
        Assert.Contains("AnimationPlayer", GodotTypeNames);
        Assert.DoesNotContain("AnimationPlayer", ForwardAppendixGodotApis);
        IReadOnlyDictionary<string, AllowListRow> rows =
            new Dictionary<string, AllowListRow>(StringComparer.Ordinal)
            {
                ["Probe.cs"] = new(
                    false, CoreSurface.ContractAndTrace, false,
                    ["Node"], [], []),
            };

        foreach (var source in new[]
        {
            "using Godot; class Probe : AnimationPlayer {}",
            "using Godot; class Probe { object Make() => new AnimationPlayer(); }",
            "using Godot; class Probe { List<AnimationPlayer>? players; }",
            "using Godot; class Probe { (AnimationPlayer, int)? player; }",
            "using Godot; class Probe { object Cast(object value) => (AnimationPlayer)value; }",
            "class Probe : Godot.AnimationPlayer {}",
            "class Probe : global::Godot.AnimationPlayer {}",
            "using G = Godot; class Probe : G.AnimationPlayer {}",
        })
        {
            var violation = Assert.Single(FindAllowListViolations("Probe.cs", source, rows));
            Assert.Contains("AnimationPlayer", violation, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Later_visual_subtrees_never_name_pickable_types()
    {
        var forbidden = Pattern(@"\b(?:CollisionShape3D|CollisionObject3D|Area3D)\b");
        var names = new[] { "PopOuts.cs", "CordMesh.cs", "Case3D.cs", "Knob3D.cs", "Relay3D.cs", "Bezels.cs" };
        var existingNames = ScriptFiles().Select(Path.GetFileName).ToHashSet(StringComparer.Ordinal);
        Assert.All(names, name => Assert.Contains(name, existingNames));
        var violations = ScriptFiles()
            .Where(path => names.Contains(Path.GetFileName(path), StringComparer.Ordinal))
            .SelectMany(path => Matches(
                Path.GetFileName(path),
                MaskCommentsAndLiterals(ReadText(path)),
                forbidden,
                "gate 3.2.20 pickable type"))
            .ToArray();

        Assert.Empty(violations);
    }

    private static IReadOnlyList<string> AllViolations(
        Func<string, string, IEnumerable<string>> scan) =>
        ScriptFiles()
            .SelectMany(path => scan(Path.GetFileName(path), ReadText(path)))
            .ToArray();

    private static IEnumerable<string> FindJsonResourceLoads(string fileName, string source)
    {
        var executable = MaskCommentsAndLiterals(source);
        foreach (Match match in JsonResourceLoad.Matches(executable))
        {
            if (!TryFindCallArgument(executable, match.Index + match.Length, out var argumentAt))
                continue;
            foreach (var candidateAt in TopLevelArgumentStarts(executable, argumentAt))
            {
                if (!TryReadStringLiteral(source, candidateAt, out var value) ||
                    !value.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                yield return Describe(fileName, executable, match.Index, "rule 1 JSON-as-resource");
                break;
            }
        }
    }

    private static IEnumerable<string> FindConformanceViolations(
        string fileName,
        string executable,
        IReadOnlyDictionary<string, AllowListRow> rows)
    {
        if (!rows.TryGetValue(fileName, out var row))
            yield break;

        if (row.AllConformance)
            yield break;

        var permitted = row.ConformanceApis.ToHashSet(StringComparer.Ordinal);
        foreach (var api in FindNamespaceApiNames(
            executable,
            "Minivac.Conformance",
            ConformanceTypeNames))
        {
            if (!permitted.Contains(api))
                yield return $"{fileName}: rule 3 Minivac.Conformance API {api} is absent from its allow-list row";
        }

        if (permitted.Count == 0 && ImportsNamespace(executable, "Minivac.Conformance"))
            yield return $"{fileName}: rule 3 Minivac.Conformance namespace is absent from its allow-list row";
    }

    private static IEnumerable<string> FindCoreBoundaryViolations(
        string fileName,
        string executable,
        IReadOnlyDictionary<string, AllowListRow> rows)
    {
        if (!rows.TryGetValue(fileName, out var row))
            yield break;

        foreach (Match match in SystemIo.Matches(executable))
            yield return Describe(fileName, executable, match.Index, "rule 4 System.IO access");

        if (row.Core != CoreSurface.All)
        {
            var permitted = row.Core == CoreSurface.ContractAndTrace
                ? ContractAndTraceCoreApis
                : [];
            foreach (var api in FindNamespaceApiNames(executable, "Minivac.Core", CoreTypeNames))
            {
                if (!permitted.Contains(api))
                    yield return $"{fileName}: rule 4 Minivac.Core API {api} is absent from its allow-list row";
            }

            foreach (Match match in Identifier.Matches(executable))
            {
                if (CoreLoaderMembers.Contains(match.Value))
                    yield return Describe(fileName, executable, match.Index, $"rule 4 core loader {match.Value}");
            }

            if (row.Core == CoreSurface.None && ImportsNamespace(executable, "Minivac.Core"))
                yield return $"{fileName}: rule 4 Minivac.Core namespace is absent from its allow-list row";
        }

        var permittedLocalLoaders = row.LocalLoaderApis.ToHashSet(StringComparer.Ordinal);
        foreach (Match match in Identifier.Matches(executable))
        {
            if (match.Value == "GodotResourceSource" && !permittedLocalLoaders.Contains(match.Value))
                yield return Describe(fileName, executable, match.Index, "rule 4 local loader GodotResourceSource");
        }
    }

    private static IEnumerable<string> FindAllowListViolations(
        string fileName,
        string source,
        IReadOnlyDictionary<string, AllowListRow> rows)
    {
        if (!rows.TryGetValue(fileName, out var row))
        {
            yield return $"{fileName}: rule 7 has no allow-list row";
            yield break;
        }

        var executable = MaskCommentsAndLiterals(source);
        if (row.AllGodot) yield break;

        if (row.GodotApis.Length == 0 && ImportsNamespace(executable, "Godot"))
            yield return $"{fileName}: rule 7 using Godot is absent from its Engine-free row";

        var named = FindNamespaceApiNames(executable, "Godot", GodotTypeNames)
            .Concat(FindFixedVocabularyNames(executable, "Godot", GodotVocabulary))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal);
        foreach (var api in named.Where(api => !IsPermittedApi(api, row.GodotApis)))
            yield return $"{fileName}: rule 7 Godot API {api} is absent from its allow-list row";
    }

    private static IEnumerable<string> FindNamespaceApiNames(
        string executable,
        string namespaceName,
        IReadOnlySet<string> apiNames)
    {
        var importsNamespace = ImportsNamespace(executable, namespaceName);
        var aliases = NamespaceAliases(executable, namespaceName);
        return Identifier.Matches(executable)
            .Where(match => apiNames.Contains(match.Value) &&
                (IsQualifiedByNamespaceOrAlias(executable, match.Index, namespaceName, aliases) ||
                 (importsNamespace && IsBare(executable, match.Index) &&
                  LooksLikeTypeReference(executable, match.Index, match.Length))))
            .Select(match => match.Value)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal);
    }

    private static IEnumerable<string> FindFixedVocabularyNames(
        string executable,
        string namespaceName,
        IReadOnlySet<string> apiNames)
    {
        var aliases = NamespaceAliases(executable, namespaceName);
        return Identifier.Matches(executable)
            .Where(match => apiNames.Contains(match.Value) &&
                (IsBare(executable, match.Index) ||
                 IsQualifiedByNamespaceOrAlias(executable, match.Index, namespaceName, aliases)))
            .Select(match => match.Value)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal);
    }

    private static bool ImportsNamespace(string executable, string namespaceName) =>
        Regex.IsMatch(
            executable,
            @"\busing\s+" + Regex.Escape(namespaceName).Replace("\\.", @"\s*\.\s*") + @"\s*;",
            RegexOptions.CultureInvariant);

    private static IReadOnlyList<string> NamespaceAliases(string executable, string namespaceName)
    {
        var qualifiedNamespace = Regex.Escape(namespaceName).Replace("\\.", @"\s*\.\s*");
        return Regex.Matches(
                executable,
                @"\busing\s+(?<alias>[A-Za-z_]\w*)\s*=\s*(?:global\s*::\s*)?" +
                    qualifiedNamespace + @"\s*;",
                RegexOptions.CultureInvariant)
            .Select(match => match.Groups["alias"].Value)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
    }

    private static bool IsQualifiedByNamespaceOrAlias(
        string source,
        int identifierAt,
        string namespaceName,
        IReadOnlyList<string> aliases) =>
        IsQualifiedBy(source, identifierAt, namespaceName) ||
        aliases.Any(alias => IsQualifiedBy(source, identifierAt, alias));

    private static bool IsBare(string source, int identifierAt)
    {
        var before = PreviousNonWhitespace(source, identifierAt - 1);
        return before < 0 || source[before] != '.';
    }

    private static bool LooksLikeTypeReference(string source, int identifierAt, int identifierLength)
    {
        var before = PreviousNonWhitespace(source, identifierAt - 1);
        if (before >= 0 && source[before] is ':' or '<' or ',')
            return true;
        if (PreviousIdentifier(source, before) is "new" or "typeof" or "is" or "as" or "default" or "sizeof")
            return true;

        var after = identifierAt + identifierLength;
        while (after < source.Length && char.IsWhiteSpace(source[after])) after++;
        if (after >= source.Length)
            return false;
        if (before >= 0 && source[before] == '(' && source[after] == ')')
            return true;
        if (before >= 0 && source[before] is '(' or ',' && source[after] is ',' or ')')
            return true;
        if (source[after] is '?' or '[' or '<' or '.')
            return true;
        return char.IsLetter(source[after]) || source[after] == '_';
    }

    private static string PreviousIdentifier(string source, int at)
    {
        var end = at + 1;
        while (at >= 0 && (char.IsLetterOrDigit(source[at]) || source[at] == '_')) at--;
        return source[(at + 1)..end];
    }

    private static bool IsQualifiedBy(string source, int identifierAt, string namespaceName)
    {
        var at = PreviousNonWhitespace(source, identifierAt - 1);
        if (at < 0 || source[at] != '.')
            return false;
        at--;

        var segments = namespaceName.Split('.');
        for (var segment = segments.Length - 1; segment >= 0; segment--)
        {
            at = PreviousNonWhitespace(source, at);
            var end = at + 1;
            while (at >= 0 && (char.IsLetterOrDigit(source[at]) || source[at] == '_')) at--;
            if (!source.AsSpan(at + 1, end - at - 1).SequenceEqual(segments[segment]))
                return false;
            if (segment == 0)
                break;
            at = PreviousNonWhitespace(source, at);
            if (at < 0 || source[at] != '.')
                return false;
            at--;
        }

        at = PreviousNonWhitespace(source, at);
        if (at >= 1 && source[at] == ':' && source[at - 1] == ':')
        {
            at = PreviousNonWhitespace(source, at - 2);
            var end = at + 1;
            while (at >= 0 && (char.IsLetterOrDigit(source[at]) || source[at] == '_')) at--;
            if (!source.AsSpan(at + 1, end - at - 1).SequenceEqual("global"))
                return false;
        }

        return at < 0 || (source[at] != '.' &&
            !char.IsLetterOrDigit(source[at]) && source[at] != '_');
    }

    private static int PreviousNonWhitespace(string source, int at)
    {
        while (at >= 0 && char.IsWhiteSpace(source[at])) at--;
        return at;
    }

    private static bool IsPermittedApi(string api, IEnumerable<string> permitted) =>
        permitted.Any(pattern => pattern.EndsWith('*')
            ? api.StartsWith(pattern[..^1], StringComparison.Ordinal)
            : string.Equals(api, pattern, StringComparison.Ordinal));

    private static HashSet<string> PublicTopLevelTypeNames(
        System.Reflection.Assembly assembly,
        string namespaceName) =>
        assembly.GetTypes()
            .Where(type => type.IsPublic && type.DeclaringType is null &&
                string.Equals(type.Namespace, namespaceName, StringComparison.Ordinal))
            .Select(type => type.Name.Split('`')[0])
            .ToHashSet(StringComparer.Ordinal);

    private static bool TryFindCallArgument(string source, int at, out int argumentAt)
    {
        at = SkipMaskedTrivia(source, at);
        if (at < source.Length && source[at] == '<')
        {
            var depth = 0;
            for (; at < source.Length; at++)
            {
                if (source[at] == '<') depth++;
                if (source[at] != '>') continue;
                depth--;
                if (depth == 0)
                {
                    at++;
                    break;
                }
            }
            if (depth != 0)
            {
                argumentAt = 0;
                return false;
            }
            at = SkipMaskedTrivia(source, at);
        }

        if (at >= source.Length || source[at] != '(')
        {
            argumentAt = 0;
            return false;
        }

        argumentAt = at + 1;
        return true;
    }

    private static int SkipMaskedTrivia(string source, int at)
    {
        while (at < source.Length && (char.IsWhiteSpace(source[at]) || source[at] == '\0')) at++;
        return at;
    }

    private static IEnumerable<int> TopLevelArgumentStarts(string source, int firstArgumentAt)
    {
        yield return firstArgumentAt;
        var parentheses = 0;
        var brackets = 0;
        var braces = 0;
        for (var at = firstArgumentAt; at < source.Length; at++)
        {
            switch (source[at])
            {
                case '(':
                    parentheses++;
                    break;
                case ')':
                    if (parentheses == 0 && brackets == 0 && braces == 0)
                        yield break;
                    if (parentheses > 0) parentheses--;
                    break;
                case '[':
                    brackets++;
                    break;
                case ']':
                    if (brackets > 0) brackets--;
                    break;
                case '{':
                    braces++;
                    break;
                case '}':
                    if (braces > 0) braces--;
                    break;
                case ',':
                    if (parentheses == 0 && brackets == 0 && braces == 0)
                        yield return at + 1;
                    break;
            }
        }
    }

    private static IEnumerable<string> Matches(
        string fileName,
        string executable,
        Regex pattern,
        string violation)
    {
        foreach (Match match in pattern.Matches(executable))
            yield return Describe(fileName, executable, match.Index, violation);
    }

    private static bool TryReadStringLiteral(string source, int at, out string value)
    {
        at = SkipTrivia(source, at);
        var identifierAt = at < source.Length && source[at] == '@' ? at + 1 : at;
        if (identifierAt < source.Length &&
            (char.IsLetter(source[identifierAt]) || source[identifierAt] == '_'))
        {
            var afterName = identifierAt + 1;
            while (afterName < source.Length &&
                (char.IsLetterOrDigit(source[afterName]) || source[afterName] == '_'))
            {
                afterName++;
            }
            afterName = SkipTrivia(source, afterName);
            if (afterName < source.Length && source[afterName] == ':')
                at = SkipTrivia(source, afterName + 1);
        }
        var verbatim = at + 1 < source.Length && source[at] == '@' && source[at + 1] == '"';
        if (verbatim) at++;
        if (at >= source.Length || source[at] != '"')
        {
            value = "";
            return false;
        }

        var quoteCount = QuoteRun(source, at);
        if (quoteCount >= 3)
        {
            var content = at + quoteCount;
            var close = source.IndexOf(new string('"', quoteCount), content, StringComparison.Ordinal);
            value = close < 0 ? "" : source[content..close];
            return close >= 0;
        }

        var result = new StringBuilder();
        for (at++; at < source.Length; at++)
        {
            if (source[at] == '"')
            {
                if (verbatim && at + 1 < source.Length && source[at + 1] == '"')
                {
                    result.Append('"');
                    at++;
                    continue;
                }
                value = result.ToString();
                return true;
            }

            if (!verbatim && source[at] == '\\' && at + 1 < source.Length)
            {
                result.Append(source[++at]);
                continue;
            }
            result.Append(source[at]);
        }

        value = "";
        return false;
    }

    private static int SkipTrivia(string source, int at)
    {
        while (at < source.Length)
        {
            while (at < source.Length && char.IsWhiteSpace(source[at])) at++;
            if (at + 1 >= source.Length || source[at] != '/')
                return at;
            if (source[at + 1] == '/')
            {
                var newline = source.IndexOf('\n', at + 2);
                at = newline < 0 ? source.Length : newline + 1;
                continue;
            }
            if (source[at + 1] == '*')
            {
                var close = source.IndexOf("*/", at + 2, StringComparison.Ordinal);
                at = close < 0 ? source.Length : close + 2;
                continue;
            }
            return at;
        }
        return at;
    }

    private static Regex Pattern(string expression) =>
        new(expression, RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static IReadOnlyList<string> ScriptFiles()
    {
        var directory = new DirectoryInfo(Path.Combine(FindRepositoryRoot(), "godot", "scripts"));
        return directory.GetFiles("*.cs", SearchOption.AllDirectories)
            .Select(entry => entry.FullName)
            .Order(StringComparer.Ordinal)
            .ToArray();
    }

    private static FileStream OpenRead(string path) =>
        new(path, FileMode.Open, FileAccess.Read, FileShare.Read);

    private static string ReadText(string path)
    {
        using var stream = OpenRead(path);
        using var reader = new StreamReader(stream, new UTF8Encoding(false, true));
        return reader.ReadToEnd();
    }

    private static string MaskCommentsAndLiterals(string source)
    {
        var masked = new char[source.Length];
        Array.Fill(masked, ' ');
        for (var at = 0; at < source.Length; at++)
        {
            if (source[at] == '\n')
                masked[at] = '\n';
        }

        CopyCode(source, masked, 0, source.Length);
        return new string(masked);
    }

    private static int CopyCode(string source, char[] masked, int at, int end)
    {
        while (at < end)
        {
            if (at + 1 < end && source[at] == '/' && source[at + 1] == '/')
            {
                at = source.IndexOf('\n', at + 2);
                if (at < 0 || at >= end)
                    return end;
                continue;
            }

            if (at + 1 < end && source[at] == '/' && source[at + 1] == '*')
            {
                var close = source.IndexOf("*/", at + 2, StringComparison.Ordinal);
                at = close < 0 || close >= end ? end : close + 2;
                continue;
            }

            var interpolated = InterpolatedLiteralAt(source, at);
            if (interpolated is not null)
            {
                at = CopyInterpolatedLiteral(source, masked, interpolated.Value);
                continue;
            }

            var literalEnd = PlainLiteralEnd(source, at);
            if (literalEnd >= 0)
            {
                at = literalEnd;
                continue;
            }

            masked[at] = source[at];
            at++;
        }

        return at;
    }

    private static (int Content, int QuoteCount, int BraceCount, bool Verbatim)? InterpolatedLiteralAt(
        string source,
        int at)
    {
        var dollars = 0;
        while (at + dollars < source.Length && source[at + dollars] == '$')
            dollars++;
        if (dollars > 0)
        {
            var quotes = QuoteRun(source, at + dollars);
            if (quotes >= 3)
                return (at + dollars + quotes, quotes, dollars, false);
        }

        if (at + 1 < source.Length && source[at] == '$' && source[at + 1] == '"')
            return (at + 2, 1, 1, false);
        if (at + 2 < source.Length &&
            ((source[at] == '$' && source[at + 1] == '@') ||
             (source[at] == '@' && source[at + 1] == '$')) &&
            source[at + 2] == '"')
            return (at + 3, 1, 1, true);
        return null;
    }

    private static int CopyInterpolatedLiteral(
        string source,
        char[] masked,
        (int Content, int QuoteCount, int BraceCount, bool Verbatim) literal)
    {
        var raw = literal.QuoteCount >= 3;
        for (var at = literal.Content; at < source.Length;)
        {
            if (raw && QuoteRun(source, at) >= literal.QuoteCount)
                return at + literal.QuoteCount;

            if (!raw && source[at] == '"')
            {
                if (literal.Verbatim && at + 1 < source.Length && source[at + 1] == '"')
                {
                    at += 2;
                    continue;
                }
                return at + 1;
            }

            if (!raw && !literal.Verbatim && source[at] == '\\')
            {
                at += Math.Min(2, source.Length - at);
                continue;
            }

            var braces = CharRun(source, at, '{');
            if (braces >= literal.BraceCount)
            {
                if (!raw && braces >= 2)
                {
                    at += 2;
                    continue;
                }

                at = CopyInterpolationExpression(source, masked, at + literal.BraceCount, literal.BraceCount);
                continue;
            }

            at++;
        }

        return source.Length;
    }

    private static int CopyInterpolationExpression(string source, char[] masked, int at, int closingBraceCount)
    {
        var nestedBraces = 0;
        while (at < source.Length)
        {
            if (at + 1 < source.Length && source[at] == '/' && source[at + 1] == '/')
            {
                at = source.IndexOf('\n', at + 2);
                if (at < 0)
                    return source.Length;
                continue;
            }

            if (at + 1 < source.Length && source[at] == '/' && source[at + 1] == '*')
            {
                var close = source.IndexOf("*/", at + 2, StringComparison.Ordinal);
                at = close < 0 ? source.Length : close + 2;
                continue;
            }

            var interpolated = InterpolatedLiteralAt(source, at);
            if (interpolated is not null)
            {
                at = CopyInterpolatedLiteral(source, masked, interpolated.Value);
                continue;
            }

            var literalEnd = PlainLiteralEnd(source, at);
            if (literalEnd >= 0)
            {
                at = literalEnd;
                continue;
            }

            if (source[at] == '{')
            {
                nestedBraces++;
                masked[at++] = '{';
                continue;
            }

            if (source[at] == '}')
            {
                if (nestedBraces == 0 && CharRun(source, at, '}') >= closingBraceCount)
                    return at + closingBraceCount;
                if (nestedBraces > 0)
                    nestedBraces--;
            }

            masked[at] = source[at];
            at++;
        }

        return at;
    }

    private static int PlainLiteralEnd(string source, int at)
    {
        var quotes = QuoteRun(source, at);
        if (quotes >= 3)
        {
            var close = source.IndexOf(new string('"', quotes), at + quotes, StringComparison.Ordinal);
            return close < 0 ? source.Length : close + quotes;
        }

        if (source[at] == '@' && at + 1 < source.Length && source[at + 1] == '"')
            return FindQuotedLiteralEnd(source, at + 1, '"', verbatim: true);
        if (source[at] is '\'' or '"')
            return FindQuotedLiteralEnd(source, at, source[at], verbatim: false);
        return -1;
    }

    private static int FindQuotedLiteralEnd(string source, int start, char quote, bool verbatim)
    {
        for (var at = start + 1; at < source.Length; at++)
        {
            if (source[at] != quote)
                continue;
            if (verbatim && at + 1 < source.Length && source[at + 1] == quote)
            {
                at++;
                continue;
            }
            if (!verbatim && IsEscaped(source, at))
                continue;
            return at + 1;
        }

        return source.Length;
    }

    private static int QuoteRun(string source, int at) => CharRun(source, at, '"');

    private static int CharRun(string source, int at, char value)
    {
        var end = at;
        while (end < source.Length && source[end] == value)
            end++;
        return end - at;
    }

    private static bool IsEscaped(string source, int at)
    {
        var slashes = 0;
        for (var index = at - 1; index >= 0 && source[index] == '\\'; index--)
            slashes++;
        return (slashes & 1) != 0;
    }

    private static string Describe(string path, string source, int index, string violation)
    {
        var line = 1;
        for (var at = 0; at < index; at++)
        {
            if (source[at] == '\n')
                line++;
        }

        return $"{Path.GetFileName(path)}:{line}: forbidden {violation}";
    }

    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (directory.GetFiles("package.json", SearchOption.TopDirectoryOnly).Length == 1 &&
                directory.GetDirectories("data", SearchOption.TopDirectoryOnly).Length == 1 &&
                directory.GetDirectories("dotnet", SearchOption.TopDirectoryOnly).Length == 1)
                return directory.FullName;
        }

        throw new InvalidOperationException("repository root not found");
    }
}
