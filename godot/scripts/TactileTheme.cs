using System.Collections.Generic;
using Godot;

namespace Minivac.Godot;

public interface ITactileToken
{
    string Name { get; }
    string Tag { get; }
    string Source { get; }
    string OpenQuestion { get; }
    object? UntypedValue { get; }
}

public sealed record TactileToken<T>(
    string Name,
    T Value,
    string Tag,
    string Source,
    string OpenQuestion) : ITactileToken
{
    public object? UntypedValue => Value;
}

public readonly record struct CameraPoseValue(double ElevationDeg, double AzimuthDeg, double DollyW);
public readonly record struct MeshQualityValue(
    int RadialSegments,
    int CaseCornerSegments);

public readonly record struct KnobSurfaceValue(
    Color BodyColour,
    double WedgeAngleDeg,
    double Roughness);

public readonly record struct RelayFormValue(
    Vector2 BobbinSizeW,
    Vector2 CrossbarSizeW,
    Vector2 CrossbarSlotSizeW,
    Vector2 ContactStackSizeW,
    double ContactStackOffsetW,
    double FixedProudW,
    double CrossbarSlotDepthW,
    int SpringsPerStack,
    double SpringFillRatio,
    double SpringMetallic,
    double SpringRoughness);

public readonly record struct JewelKnurlValue(
    int Count,
    double DepthW);

public readonly record struct LampSurfaceValue(
    double Alpha,
    double Roughness);

public readonly record struct SceneLightingValue(
    Color Colour,
    double KeyEnergy,
    Vector2 KeyRotationDeg,
    double AmbientEnergy);

public static class TactileTheme
{
    public static readonly TactileToken<Color> CordColour =
        new("cordColour", Color.FromHtml("cf5c4c"), "pinned", "main.css:197", "O-P10");
    public static readonly TactileToken<Vector2> SubViewportSize =
        new("subViewport", new Vector2(2880, 1600), "derived", "1.8:1 ratio from the panel aspect", "");
    public static readonly TactileToken<double> CordRadius =
        new("cordRadius", 0.0025, "derived", "0.625 ratio of holeDiameterToken", "O-P10");
    public static readonly TactileToken<int> DtStep =
        new("dtStep", 240, "chosen", "chosen presentation token", "O-P10");
    public static readonly TactileToken<int> ConvergeSteps =
        new("convergeSteps", 480, "chosen", "chosen presentation token", "O-P10");
    public static readonly TactileToken<double> RebuildEpsilon =
        new("rebuildEpsilon", 0.0001, "chosen", "chosen presentation token", "O-P10");
    public static readonly TactileToken<double> CordGravityWPerStep2 =
        new("cordGravityWPerStep2", 0.00002, "chosen", "chosen presentation token", "O-P10");
    public static readonly TactileToken<int> CordRelaxIterations =
        new("cordRelaxIterations", 4, "chosen", "chosen presentation token", "O-P10");
    public static readonly TactileToken<double> CordDamping =
        new("cordDamping", 1.0, "chosen", "chosen presentation token", "O-P10");
    public static readonly TactileToken<double> TaperPinStub =
        new("taperPinStub", 0.008, "chosen", "chosen presentation token", "O-P10");
    public static readonly TactileToken<double> CordSlack =
        new("cordSlack", 1.15, "chosen", "chosen presentation token", "O-P10");
    public static readonly TactileToken<int> CordSegments =
        new("cordSegments", 16, "chosen", "chosen presentation token", "O-P10");
    public static readonly TactileToken<int> TubeSides =
        new("tubeSides", 6, "chosen", "chosen presentation token", "O-P10");
    public static readonly TactileToken<double> CameraFovDeg =
        new("cameraFovDeg", 45, "chosen", "engineering token", "PR-8");
    public static readonly TactileToken<double> CameraWireFovDeg =
        new("cameraWireFovDeg", 15, "chosen", "engineering token", "PR-8");
    public static readonly TactileToken<Vector2> CameraElevationDeg =
        new("cameraElevationDeg", new Vector2(25, 90), "chosen", "engineering token", "PR-8");
    public static readonly TactileToken<Vector2> CameraAzimuthDeg =
        new("cameraAzimuthDeg", new Vector2(-60, 60), "chosen", "engineering token", "PR-8");
    public static readonly TactileToken<Vector2> CameraDolly =
        new("cameraDolly", new Vector2(0.6f, 2.2f), "chosen", "engineering token", "PR-8");
    public static readonly TactileToken<double> CameraDollyMinW =
        new("cameraDollyMinW", 0.45, "chosen", "engineering token", "PR-8");
    public static readonly TactileToken<CameraPoseValue> CameraDefaultPose =
        new("cameraDefaultPose", new CameraPoseValue(55, 0, 1.6), "chosen", "engineering token", "PR-8");
    public static readonly TactileToken<double> CameraWireDollyW =
        new("cameraWireDollyW", 0.639434, "chosen", "engineering token", "PR-8");
    public static readonly TactileToken<double> CameraWireElevationDeg =
        new("cameraWireElevationDeg", 45, "chosen", "engineering token", "PR-8");
    public static readonly TactileToken<double> OrbitDegPerPixel =
        new("orbitDegPerPixel", 0.25, "chosen", "engineering token", "PR-8");
    public static readonly TactileToken<double> DollyPerWheelNotch =
        new("dollyPerWheelNotch", 0.08, "chosen", "engineering token", "PR-8");
    public static readonly TactileToken<double> PanWPerPixel =
        new("panWPerPixel", 0.0008, "chosen", "engineering token", "PR-8");
    public static readonly TactileToken<Color> TaperPinGrey =
        new("taperPinGrey", Color.FromHtml("8a8f94"), "chosen", "chosen presentation token", "O-P10");
    public static readonly TactileToken<Color> ConsoleTeal =
        new("consoleTeal", Color.FromHtml("62979a"), "pinned", "main.css:2", "");
    public static readonly TactileToken<Color> ConsoleDark =
        new("consoleDark", Color.FromHtml("24241f"), "pinned", "main.css:3", "");
    public static readonly TactileToken<Color> ConsoleCream =
        new("consoleCream", Color.FromHtml("e6dfc7"), "pinned", "main.css:4", "");
    public static readonly TactileToken<Color> ConsoleRed =
        new("consoleRed", Color.FromHtml("a9473d"), "pinned", "main.css:5", "");
    public static readonly TactileToken<Color> ConsoleRedLit =
        new("consoleRedLit", Color.FromHtml("d65a4b"), "pinned", "main.css:6", "");
    public static readonly TactileToken<double> HoleHit =
        new("holeHit", .0105, "pinned", "main.css:544-545", "");
    public static readonly TactileToken<double> LampLens =
        new("lampLens", .024, "pinned", "main.css:601", "");
    public static readonly TactileToken<double> LampBezel =
        new("lampBezel", .0038, "pinned", "main.css:594-627", "");
    public static readonly TactileToken<double> Jewel =
        new("jewel", .0175, "pinned", "main.css:619", "");
    public static readonly TactileToken<double> Pushbutton =
        new("pushbutton", .034, "pinned", "main.css:632", "");
    public static readonly TactileToken<double> Breaker =
        new("breaker", .031, "pinned", "main.css:633", "");
    public static readonly TactileToken<Vector2> Slide =
        new("slide", new Vector2(.032f, .0115f), "pinned", "main.css:640-641", "");
    public static readonly TactileToken<Vector2> PowerSwitch =
        new("powerSwitch", new Vector2(.0115f, .032f), "pinned", "main.css:648", "");
    public static readonly TactileToken<double> Rivet =
        new("rivet", .008, "pinned", "main.css:651-652", "");
    public static readonly TactileToken<(double X, double Y)> RelayBody =
        new("relayBody", (.095, .058), "pinned", "src/ui/panel-view.ts:104-113", "");
    public static readonly TactileToken<double> KnobSquare =
        new("knobSquare", .085, "pinned", "src/ui/panel-view.ts:104-113", "");
    public static readonly TactileToken<double> CrossbarShift =
        new("crossbarShift", 1.6, "pinned", "src/ui/inspector.ts:855", "");
    public static readonly TactileToken<double> DialRotation =
        new("dialRotation", 1_000_000, "pinned", "src/ui/inspector.ts:871", "");
    public static readonly TactileToken<double> GlowIntensity =
        new("glowIntensity", .3, "derived", "Godot Environment default", "");
    public static readonly TactileToken<double> HoleDiameterToken =
        new("holeDiameterToken", .004, "derived", "PH2 ratio approximately 16 / 4032 (BAND-3, CASE-6), rounded redraw token", "");
    public static readonly TactileToken<double> PrintedRingOD =
        new("printedRingOD", .006, "derived", "PH2 ratio approximately 24 / 4032 (BAND-3, CASE-6), rounded redraw token", "");
    public static readonly TactileToken<double> KnobWedgeRadiusOverInnerCircle =
        new("knobWedgeRadiusOverInnerCircle", .769, "derived", "PH2 ratio 150 / 195, rounded", "O-P12");
    public static readonly TactileToken<double> CaseHeight =
        new("caseHeight", .20, "chosen", "chosen redraw token", "O-P11");
    public static readonly TactileToken<double> CaseEdgeRadius =
        new("caseEdgeRadius", .006, "chosen", "chosen redraw token", "O-P11");
    public static readonly TactileToken<int> FootCount =
        new("footCount", 4, "chosen", "chosen redraw token", "O-P11");
    public static readonly TactileToken<double> FootRadius =
        new("footRadius", .012, "chosen", "chosen redraw token", "O-P11");
    public static readonly TactileToken<double> FootHeight =
        new("footHeight", .006, "chosen", "chosen redraw token", "O-P11");
    public static readonly TactileToken<double> FootInset =
        new("footInset", .03, "chosen", "chosen redraw token", "O-P11");
    public static readonly TactileToken<double> PlateRecess =
        new("plateRecess", .004, "chosen", "chosen redraw token", "O-P17");
    public static readonly TactileToken<double> LampLensProud =
        new("lampLensProud", .010, "chosen", "chosen redraw token", "O-P18");
    public static readonly TactileToken<double> LampBezelProud =
        new("lampBezelProud", .004, "chosen", "chosen shared bezel proud-height redraw token", "O-P18");
    public static readonly TactileToken<double> JewelBarrelProud =
        new("jewelBarrelProud", .008, "chosen", "chosen redraw token", "O-P18 / O-P5");
    public static readonly TactileToken<double> PushbuttonCapProud =
        new("pushbuttonCapProud", .012, "chosen", "chosen redraw token", "O-P15");
    public static readonly TactileToken<double> PushbuttonStroke =
        new("pushbuttonStroke", .006, "chosen", "chosen redraw token", "O-P15");
    public static readonly TactileToken<Vector2> BreakerProud =
        new("breakerProud", new Vector2(.010f, .006f), "chosen", "chosen redraw token", "O-P15");
    public static readonly TactileToken<double> SlideActuatorProud =
        new("slideActuatorProud", .006, "chosen", "chosen redraw token", "O-P15");
    public static readonly TactileToken<double> CrossbarProud =
        new("crossbarProud", .008, "chosen", "chosen redraw token", "O-P15");
    public static readonly TactileToken<double> KnobHeight =
        new("knobHeight", .020, "chosen", "chosen redraw token", "O-P12");
    public static readonly TactileToken<double> GlowBloom =
        new("glowBloom", 1, "chosen", "chosen redraw token", "O-P14");
    public static readonly TactileToken<double> GlowHdrThreshold =
        new("glowHdrThreshold", .1, "chosen", "chosen redraw token", "O-P14");
    public static readonly TactileToken<double> LampEmissionMax =
        new("lampEmissionMax", 2, "chosen", "chosen redraw token", "O-P14");
    public static readonly TactileToken<Color> LampColour =
        new("lampColour", Color.FromHtml("d65a4b"), "chosen", "chosen redraw token", "O-P14");
    public static readonly TactileToken<Color> ChalkyCore =
        new("chalkyCore", Color.FromHtml("d8d2bf"), "chosen", "chosen redraw token", "O-P1");
    public static readonly TactileToken<Color> BobbinWhite =
        new("bobbinWhite", Color.FromHtml("f2efe6"), "chosen", "chosen redraw token", "O-P16");
    public static readonly TactileToken<Color> SpringCopper =
        new("springCopper", Color.FromHtml("b87333"), "chosen", "chosen redraw token", "O-P16");
    public static readonly TactileToken<double> ChromeMetallic =
        new("chromeMetallic", .9, "chosen", "chosen redraw token", "O-P18");
    public static readonly TactileToken<double> ChromeRoughness =
        new("chromeRoughness", .3, "chosen", "chosen redraw token", "O-P18");
    public static readonly TactileToken<double> FrameFinish =
        new("frameFinish", .7, "chosen", "chosen redraw token", "O-P18");
    public static readonly TactileToken<double> JewelBezel =
        new("jewelBezel", .0022, "pinned", "main.css:621", "");
    public static readonly TactileToken<MeshQualityValue> MeshQuality =
        new("meshQuality", new(24, 4), "chosen", "chosen redraw token", "O-P11");
    public static readonly TactileToken<Color> FootColour =
        new("footColour", Color.FromHtml("24241f"), "chosen", "chosen redraw token", "O-P11");
    public static readonly TactileToken<double> SlideThrow =
        new("slideThrow", .010, "chosen", "chosen redraw token", "O-P15");
    public static readonly TactileToken<KnobSurfaceValue> KnobSurface =
        new("knobSurface", new(Color.FromHtml("4a2426"), 40, .65), "chosen", "chosen PH2 redraw values", "O-P12");
    public static readonly TactileToken<RelayFormValue> RelayForm =
        new("relayForm", new(
            new Vector2(.030f, .034f), new Vector2(.018f, .032f),
            new Vector2(.005f, .022f), new Vector2(.035f, .009f),
            .015, .010, .003, 4, .5, .75, .45), "chosen", "chosen PH2-top-view redraw values", "O-P16");
    public static readonly TactileToken<JewelKnurlValue> JewelKnurl =
        new("jewelKnurl", new(24, .0006), "chosen", "chosen redraw token", "O-P18");
    public static readonly TactileToken<LampSurfaceValue> LampSurface =
        new("lampSurface", new(.65, .45), "chosen", "chosen redraw token", "O-P14");
    public static readonly TactileToken<SceneLightingValue> SceneLighting =
        new("sceneLighting", new(Color.FromHtml("ffffff"), 1.25, new Vector2(-45, -30), .35), "chosen", "chosen neutral presentation illumination", "O-P18");

    public static IReadOnlyList<ITactileToken> Tokens { get; } =
    [
        CordColour,
        SubViewportSize,
        CordRadius,
        DtStep,
        ConvergeSteps,
        RebuildEpsilon,
        CordGravityWPerStep2,
        CordRelaxIterations,
        CordDamping,
        TaperPinStub,
        CordSlack,
        CordSegments,
        TubeSides,
        CameraFovDeg,
        CameraWireFovDeg,
        CameraElevationDeg,
        CameraAzimuthDeg,
        CameraDolly,
        CameraDollyMinW,
        CameraDefaultPose,
        CameraWireDollyW,
        CameraWireElevationDeg,
        OrbitDegPerPixel,
        DollyPerWheelNotch,
        PanWPerPixel,
        TaperPinGrey,
        ConsoleTeal,
        ConsoleDark,
        ConsoleCream,
        ConsoleRed,
        ConsoleRedLit,
        HoleHit,
        LampLens,
        LampBezel,
        Jewel,
        Pushbutton,
        Breaker,
        Slide,
        PowerSwitch,
        Rivet,
        RelayBody,
        KnobSquare,
        CrossbarShift,
        DialRotation,
        GlowIntensity,
        HoleDiameterToken,
        PrintedRingOD,
        KnobWedgeRadiusOverInnerCircle,
        CaseHeight,
        CaseEdgeRadius,
        FootCount,
        FootRadius,
        FootHeight,
        FootInset,
        PlateRecess,
        LampLensProud,
        LampBezelProud,
        JewelBarrelProud,
        PushbuttonCapProud,
        PushbuttonStroke,
        BreakerProud,
        SlideActuatorProud,
        CrossbarProud,
        KnobHeight,
        GlowBloom,
        GlowHdrThreshold,
        LampEmissionMax,
        LampColour,
        ChalkyCore,
        BobbinWhite,
        SpringCopper,
        ChromeMetallic,
        ChromeRoughness,
        FrameFinish,
        JewelBezel,
        MeshQuality,
        FootColour,
        SlideThrow,
        KnobSurface,
        RelayForm,
        JewelKnurl,
        LampSurface,
        SceneLighting,
    ];
}
