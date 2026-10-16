using Godot;

namespace Minivac.Godot;

public static class PanelTheme
{
    public static Color ConsoleTeal => TactileTheme.ConsoleTeal.Value;
    public static Color ConsoleDark => TactileTheme.ConsoleDark.Value;
    public static Color ConsoleCream => TactileTheme.ConsoleCream.Value;
    public static Color ConsoleRed => TactileTheme.ConsoleRed.Value;
    public static Color ConsoleRedLit => TactileTheme.ConsoleRedLit.Value;
    public static readonly Color FocusBlue = Color.FromHtml("79c9ff");

    public static double RelayWidth => TactileTheme.RelayBody.Value.X;
    public static double RelayHeight => TactileTheme.RelayBody.Value.Y;
    public static double DialDiameter => TactileTheme.KnobSquare.Value;
    public const double ArtworkScale = 1000;
    public static readonly Vector2 Arrowhead = new(6, 4);
    public const double BracketTickDepth = 0.006;
    public const double TwoLineLegendWidth = 0.05;
    public const double LogotypeTracking = -0.06;
    public static double RelayCrossbarShift(int travel) =>
        travel * TactileTheme.CrossbarShift.Value / 1000 - TactileTheme.CrossbarShift.Value / 2;
    public static double DialPointerDegrees(long udeg) => udeg / TactileTheme.DialRotation.Value;

    public static double HoleDiameter => TactileTheme.HoleHit.Value;
    public static double LampDiameter => TactileTheme.LampLens.Value;
    public static double PowerJewelDiameter => TactileTheme.Jewel.Value;
    public static double PowerJewelBezel => TactileTheme.JewelBezel.Value;
    public static double PushbuttonDiameter => TactileTheme.Pushbutton.Value;
    public static double BreakerDiameter => TactileTheme.Breaker.Value;
    public static Vector2 SlideSize => TactileTheme.Slide.Value;
    public static Vector2 PowerSwitchSize => TactileTheme.PowerSwitch.Value;
    public static double RivetDiameter => TactileTheme.Rivet.Value;
    public const double FocusOutline = 0.0022;
    public const double FocusOffset = 0.0018;
}
