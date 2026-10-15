using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Godot;
using Xunit;

namespace Minivac.Godot.Tests;

public sealed partial class TactileThemeTests
{
    private static readonly HashSet<string> Tags = new(StringComparer.Ordinal)
    {
        "pinned", "derived", "chosen",
    };

    private static readonly HashSet<string> CameraTokens = new(StringComparer.Ordinal)
    {
        "cameraFovDeg", "cameraWireFovDeg", "cameraElevationDeg", "cameraAzimuthDeg", "cameraDolly",
        "cameraDefaultPose", "cameraDollyMinW", "cameraWireElevationDeg", "cameraWireDollyW",
        "orbitDegPerPixel", "dollyPerWheelNotch", "panWPerPixel",
    };

    private static readonly HashSet<double> ArithmeticLiterals =
    [
        -1, 0, 0.5, 1, 2, 100, 180, 360, 1000, 50_000, 1_000_000,
    ];

    private static readonly string[] ExpectedNames =
    [
        "cordColour", "subViewport", "cordRadius", "dtStep", "convergeSteps", "rebuildEpsilon", "cordGravityWPerStep2", "cordRelaxIterations", "cordDamping", "taperPinStub", "cordSlack", "cordSegments", "tubeSides", "cameraFovDeg", "cameraWireFovDeg", "cameraElevationDeg", "cameraAzimuthDeg", "cameraDolly", "cameraDollyMinW", "cameraDefaultPose", "cameraWireDollyW", "cameraWireElevationDeg", "orbitDegPerPixel", "dollyPerWheelNotch", "panWPerPixel", "taperPinGrey",
        "consoleTeal", "consoleDark", "consoleCream", "consoleRed", "consoleRedLit", "holeHit", "lampLens", "lampBezel", "jewel", "pushbutton", "breaker", "slide", "powerSwitch", "rivet", "relayBody", "knobSquare", "crossbarShift", "dialRotation", "glowIntensity", "holeDiameterToken", "printedRingOD", "knobWedgeRadiusOverInnerCircle", "caseHeight", "caseEdgeRadius", "footCount", "footRadius", "footHeight", "footInset", "plateRecess", "lampLensProud", "lampBezelProud", "jewelBarrelProud", "pushbuttonCapProud", "pushbuttonStroke", "breakerProud", "slideActuatorProud", "crossbarProud", "knobHeight", "glowBloom", "glowHdrThreshold", "lampEmissionMax", "lampColour", "chalkyCore", "bobbinWhite", "springCopper", "chromeMetallic", "chromeRoughness", "frameFinish",
        "jewelBezel", "meshQuality", "footColour", "slideThrow", "knobSurface", "relayForm", "jewelKnurl", "lampSurface", "sceneLighting",
    ];

    private static readonly (string Name, object Value, string Tag, string Source, string OpenQuestion)[] ExpectedP6Metadata =
    [
        ("consoleTeal", Color.FromHtml("62979a"), "pinned", "main.css:2", ""),
        ("consoleDark", Color.FromHtml("24241f"), "pinned", "main.css:3", ""),
        ("consoleCream", Color.FromHtml("e6dfc7"), "pinned", "main.css:4", ""),
        ("consoleRed", Color.FromHtml("a9473d"), "pinned", "main.css:5", ""),
        ("consoleRedLit", Color.FromHtml("d65a4b"), "pinned", "main.css:6", ""),
        ("holeHit", .0105, "pinned", "main.css:544-545", ""),
        ("lampLens", .024, "pinned", "main.css:601", ""),
        ("lampBezel", .0038, "pinned", "main.css:594-627", ""),
        ("jewel", .0175, "pinned", "main.css:619", ""),
        ("pushbutton", .034, "pinned", "main.css:632", ""),
        ("breaker", .031, "pinned", "main.css:633", ""),
        ("slide", new Vector2(.032f, .0115f), "pinned", "main.css:640-641", ""),
        ("powerSwitch", new Vector2(.0115f, .032f), "pinned", "main.css:648", ""),
        ("rivet", .008, "pinned", "main.css:651-652", ""),
        ("relayBody", (.095, .058), "pinned", "src/ui/panel-view.ts:104-113", ""),
        ("knobSquare", .085, "pinned", "src/ui/panel-view.ts:104-113", ""),
        ("crossbarShift", 1.6, "pinned", "src/ui/inspector.ts:855", ""),
        ("dialRotation", 1_000_000d, "pinned", "src/ui/inspector.ts:871", ""),
        ("glowIntensity", .3, "derived", "Godot Environment default", ""),
        ("holeDiameterToken", .004, "derived", "PH2 ratio approximately 16 / 4032 (BAND-3, CASE-6), rounded redraw token", ""),
        ("printedRingOD", .006, "derived", "PH2 ratio approximately 24 / 4032 (BAND-3, CASE-6), rounded redraw token", ""),
        ("knobWedgeRadiusOverInnerCircle", .769, "derived", "PH2 ratio 150 / 195, rounded", "O-P12"),
        ("caseHeight", .20, "chosen", "chosen redraw token", "O-P11"),
        ("caseEdgeRadius", .006, "chosen", "chosen redraw token", "O-P11"),
        ("footCount", 4, "chosen", "chosen redraw token", "O-P11"),
        ("footRadius", .012, "chosen", "chosen redraw token", "O-P11"),
        ("footHeight", .006, "chosen", "chosen redraw token", "O-P11"),
        ("footInset", .03, "chosen", "chosen redraw token", "O-P11"),
        ("plateRecess", .004, "chosen", "chosen redraw token", "O-P17"),
        ("lampLensProud", .010, "chosen", "chosen redraw token", "O-P18"),
        ("lampBezelProud", .004, "chosen", "chosen shared bezel proud-height redraw token", "O-P18"),
        ("jewelBarrelProud", .008, "chosen", "chosen redraw token", "O-P18 / O-P5"),
        ("pushbuttonCapProud", .012, "chosen", "chosen redraw token", "O-P15"),
        ("pushbuttonStroke", .006, "chosen", "chosen redraw token", "O-P15"),
        ("breakerProud", new Vector2(.010f, .006f), "chosen", "chosen redraw token", "O-P15"),
        ("slideActuatorProud", .006, "chosen", "chosen redraw token", "O-P15"),
        ("crossbarProud", .008, "chosen", "chosen redraw token", "O-P15"),
        ("knobHeight", .020, "chosen", "chosen redraw token", "O-P12"),
        ("glowBloom", 1d, "chosen", "chosen redraw token", "O-P14"),
        ("glowHdrThreshold", .1, "chosen", "chosen redraw token", "O-P14"),
        ("lampEmissionMax", 2d, "chosen", "chosen redraw token", "O-P14"),
        ("lampColour", Color.FromHtml("d65a4b"), "chosen", "chosen redraw token", "O-P14"),
        ("chalkyCore", Color.FromHtml("d8d2bf"), "chosen", "chosen redraw token", "O-P1"),
        ("bobbinWhite", Color.FromHtml("f2efe6"), "chosen", "chosen redraw token", "O-P16"),
        ("springCopper", Color.FromHtml("b87333"), "chosen", "chosen redraw token", "O-P16"),
        ("chromeMetallic", .9, "chosen", "chosen redraw token", "O-P18"),
        ("chromeRoughness", .3, "chosen", "chosen redraw token", "O-P18"),
        ("frameFinish", .7, "chosen", "chosen redraw token", "O-P18"),
        ("jewelBezel", .0022, "pinned", "main.css:621", ""),
        ("meshQuality", new MeshQualityValue(24, 4), "chosen", "chosen redraw token", "O-P11"),
        ("footColour", Color.FromHtml("24241f"), "chosen", "chosen redraw token", "O-P11"),
        ("slideThrow", .010, "chosen", "chosen redraw token", "O-P15"),
        ("knobSurface", new KnobSurfaceValue(Color.FromHtml("4a2426"), 40, .65), "chosen", "chosen PH2 redraw values", "O-P12"),
        ("relayForm", new RelayFormValue(new Vector2(.030f, .034f), new Vector2(.018f, .032f), new Vector2(.005f, .022f), new Vector2(.035f, .009f), .015, .010, .003, 4, .5, .75, .45), "chosen", "chosen PH2-top-view redraw values", "O-P16"),
        ("jewelKnurl", new JewelKnurlValue(24, .0006), "chosen", "chosen redraw token", "O-P18"),
        ("lampSurface", new LampSurfaceValue(.65, .45), "chosen", "chosen redraw token", "O-P14"),
        ("sceneLighting", new SceneLightingValue(Color.FromHtml("ffffff"), 1.25, new Vector2(-45, -30), .35), "chosen", "chosen neutral presentation illumination", "O-P18"),
    ];

    [Fact]
    public void Every_token_has_a_valid_tag_and_the_P6_inventory_is_exact()
    {
        Assert.Equal(83, TactileTheme.Tokens.Count);
        Assert.Equal(ExpectedNames, TactileTheme.Tokens.Select(token => token.Name));
        Assert.Equal(83, TactileTheme.Tokens.Select(token => token.Name).Distinct(StringComparer.Ordinal).Count());
        Assert.All(TactileTheme.Tokens, token => Assert.Contains(token.Tag, Tags));
        foreach (var expected in ExpectedP6Metadata)
        {
            var actual = Assert.Single(TactileTheme.Tokens, token => token.Name == expected.Name);
            Assert.Equal(expected.Tag, actual.Tag);
            Assert.Equal(expected.Source, actual.Source);
            Assert.Equal(expected.OpenQuestion, actual.OpenQuestion);
            Assert.True(Equals(expected.Value, actual.UntypedValue), $"{expected.Name} value differs");
        }
        Assert.Equal(.0022, TactileTheme.JewelBezel.Value);
        Assert.Equal(new MeshQualityValue(24, 4), TactileTheme.MeshQuality.Value);
        Assert.Equal(Color.FromHtml("24241f"), TactileTheme.FootColour.Value);
        Assert.Equal(.010, TactileTheme.SlideThrow.Value);
        Assert.Equal(new KnobSurfaceValue(Color.FromHtml("4a2426"), 40, .65), TactileTheme.KnobSurface.Value);
        Assert.Equal(new RelayFormValue(new Vector2(.030f, .034f), new Vector2(.018f, .032f), new Vector2(.005f, .022f), new Vector2(.035f, .009f), .015, .010, .003, 4, .5, .75, .45), TactileTheme.RelayForm.Value);
        Assert.Equal(.5, TactileTheme.RelayForm.Value.SpringFillRatio);
        Assert.Equal(new JewelKnurlValue(24, .0006), TactileTheme.JewelKnurl.Value);
        Assert.Equal(new LampSurfaceValue(.65, .45), TactileTheme.LampSurface.Value);
        Assert.Equal(new SceneLightingValue(Color.FromHtml("ffffff"), 1.25, new Vector2(-45, -30), .35), TactileTheme.SceneLighting.Value);
        Console.WriteLine("tactile-theme: tokens=" + TactileTheme.Tokens.Count);
    }

    [Fact]
    public void Appendix_h_rows_match_the_token_registry()
    {
        var plan = File.ReadAllText(Path.Combine(RepoRoot(), "docs", "plans", "phase-4-presentation.md"));
        const string appendixHHeading = "## Appendix H — `TactileTheme` tokens";
        const string appendixIHeading = "## Appendix I — the presentation rule log";
        var appendixH = plan.IndexOf(appendixHHeading, StringComparison.Ordinal);
        var appendixI = plan.IndexOf(appendixIHeading, StringComparison.Ordinal);
        Assert.True(appendixH >= 0, "missing Appendix H heading");
        Assert.True(appendixI > appendixH, "missing Appendix I heading after Appendix H");

        var rows = new List<(string Name, string Value, string Tag, string Source, string Provenance)>();
        foreach (var line in plan[appendixH..appendixI].Split('\n'))
        {
            if (!line.StartsWith("| `", StringComparison.Ordinal)) continue;
            var fields = line.Split('|', StringSplitOptions.None);
            Assert.Equal(8, fields.Length);
            rows.Add((
                fields[1].Trim().Trim('`'),
                fields[2].Trim(),
                PlainCell(fields[3]),
                fields[5].Trim(),
                PlainCell(fields[6])));
        }

        Assert.Equal(83, rows.Count);
        Assert.Equal(83, rows.Select(row => row.Name).Distinct(StringComparer.Ordinal).Count());
        var documented = rows.ToDictionary(row => row.Name, StringComparer.Ordinal);
        var registered = TactileTheme.Tokens.ToDictionary(token => token.Name, StringComparer.Ordinal);
        Assert.Equal(
            registered.Keys.OrderBy(name => name, StringComparer.Ordinal),
            documented.Keys.OrderBy(name => name, StringComparer.Ordinal));
        var uncheckedValues = new List<string>();
        foreach (var token in TactileTheme.Tokens)
        {
            var row = documented[token.Name];
            Assert.Equal(token.Tag, row.Tag);
            Assert.Equal(token.OpenQuestion, row.Provenance);
            Assert.True(SourceMatches(token, row.Source, registered),
                $"{token.Name} Appendix H source/derivation does not match {token.Source}");
            if (TryMatchValue(row.Value, token.UntypedValue, registered, out var valueMatches))
                Assert.True(valueMatches, $"{token.Name} Appendix H value differs: {row.Value}");
            else uncheckedValues.Add(token.Name);
        }
        Assert.Equal(new[] { "crossbarShift", "dialRotation", "relayForm" },
            uncheckedValues.OrderBy(name => name, StringComparer.Ordinal));
        Console.WriteLine(
            $"appendix-h: rows={rows.Count}, values-checked={rows.Count - uncheckedValues.Count}," +
            " intentionally-unchecked=" + string.Join(",", uncheckedValues));

        static string PlainCell(string cell)
        {
            var text = cell.Trim().Replace("**", "", StringComparison.Ordinal);
            return text == "—" ? "" : text;
        }
    }

    private static bool SourceMatches(
        ITactileToken token,
        string documentedSource,
        IReadOnlyDictionary<string, ITactileToken> registered)
    {
        var plain = MarkdownText(documentedSource);
        if (token.Tag == "pinned") return PinnedCitation(plain) == token.Source;
        if (token.Tag == "derived")
        {
            var ignored = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "ratio", "approximately", "from", "the", "of", "rounded", "redraw", "token", "panel", "aspect",
            };
            var anchors = Regex.Matches(token.Source, @"\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9]*")
                .Select(match => match.Value)
                .Where(anchor => !ignored.Contains(anchor))
                .ToArray();
            return anchors.Length > 0 && anchors.All(anchor =>
                plain.Contains(anchor, StringComparison.OrdinalIgnoreCase));
        }

        if (plain.Contains(token.Source, StringComparison.OrdinalIgnoreCase)) return true;
        if (Regex.IsMatch(token.Source, @"^chosen (?:presentation|redraw) token$", RegexOptions.IgnoreCase) &&
            Regex.IsMatch(plain, @"\bchosen (?:presentation|redraw) token\b", RegexOptions.IgnoreCase)) return true;
        var alias = Regex.Match(documentedSource, @"^as\s+`(?<name>[^`]+)`", RegexOptions.IgnoreCase);
        if (alias.Success && registered.TryGetValue(alias.Groups["name"].Value, out var referenced) &&
            referenced.Source == token.Source && referenced.OpenQuestion == token.OpenQuestion) return true;
        var generic = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "chosen", "redraw", "token", "values", "presentation",
        };
        var chosenAnchors = Regex.Matches(token.Source, @"[A-Za-z0-9]+")
            .Select(match => match.Value)
            .Where(anchor => !generic.Contains(anchor))
            .ToArray();
        return chosenAnchors.Length > 0 && chosenAnchors.All(anchor =>
            plain.Contains(anchor, StringComparison.OrdinalIgnoreCase));
    }

    private static string PinnedCitation(string source)
    {
        var match = Regex.Match(
            source.Replace('–', '-'),
            @"(?<file>main\.css|src/ui/(?:panel-view|inspector)\.ts)(?::|\s+)(?<start>\d+)(?:-(?<end>\d+))?");
        Assert.True(match.Success, "missing pinned citation in Appendix H: " + source);
        return match.Groups["file"].Value + ":" + match.Groups["start"].Value +
            (match.Groups["end"].Success ? "-" + match.Groups["end"].Value : "");
    }

    private static bool TryMatchValue(
        string documentedValue,
        object? actual,
        IReadOnlyDictionary<string, ITactileToken> registered,
        out bool matches)
    {
        var plain = MarkdownText(documentedValue).Replace('−', '-');
        var numbers = Regex.Matches(plain, @"(?<![A-Za-z0-9])[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?![A-Za-z0-9])")
            .Select(match => double.Parse(match.Value, CultureInfo.InvariantCulture))
            .ToArray();
        switch (actual)
        {
            case Color colour:
                matches = TryDocumentedColour(plain, registered, out var documentedColour) &&
                    documentedColour == colour;
                return true;
            case int integer when LeadingNumber(plain, out var scalar):
                matches = scalar == integer;
                return true;
            case double number when LeadingNumber(plain, out var scalar):
                matches = scalar == number;
                return true;
            case double number when numbers.Length == 1:
                matches = numbers[0] == number;
                return true;
            case Vector2 vector when plain.Contains('±') && numbers.Length == 1:
                matches = vector == new Vector2((float)-numbers[0], (float)numbers[0]);
                return true;
            case Vector2 vector when numbers.Length >= 2:
                matches = vector == new Vector2((float)numbers[0], (float)numbers[1]);
                return true;
            case ValueTuple<double, double> pair when numbers.Length >= 2:
                matches = numbers[0] == pair.Item1 && numbers[1] == pair.Item2;
                return true;
            case CameraPoseValue pose when numbers.Length >= 3:
                matches = numbers[0] == pose.ElevationDeg && numbers[1] == pose.AzimuthDeg &&
                    numbers[2] == pose.DollyW;
                return true;
            case MeshQualityValue quality when numbers.Length >= 2:
                matches = numbers[0] == quality.RadialSegments && numbers[1] == quality.CaseCornerSegments;
                return true;
            case KnobSurfaceValue surface when numbers.Length >= 2:
                matches = TryDocumentedColour(plain, registered, out var bodyColour) &&
                    bodyColour == surface.BodyColour && numbers[0] == surface.WedgeAngleDeg &&
                    numbers[1] == surface.Roughness;
                return true;
            case JewelKnurlValue knurl when numbers.Length >= 2:
                matches = numbers[0] == knurl.Count && numbers[1] == knurl.DepthW;
                return true;
            case LampSurfaceValue surface when numbers.Length >= 2:
                matches = numbers[0] == surface.Alpha && numbers[1] == surface.Roughness;
                return true;
            case SceneLightingValue lighting when numbers.Length >= 4:
                matches = TryDocumentedColour(plain, registered, out var lightColour) &&
                    lightColour == lighting.Colour && numbers[0] == lighting.KeyEnergy &&
                    numbers[1] == lighting.KeyRotationDeg.X && numbers[2] == lighting.KeyRotationDeg.Y &&
                    numbers[3] == lighting.AmbientEnergy;
                return true;
            default:
                matches = false;
                return false;
        }
    }

    private static bool LeadingNumber(string text, out double value)
    {
        var match = Regex.Match(text, @"^[+-]?(?:\d+(?:\.\d+)?|\.\d+)");
        value = match.Success ? double.Parse(match.Value, CultureInfo.InvariantCulture) : 0;
        return match.Success;
    }

    private static bool TryDocumentedColour(
        string text,
        IReadOnlyDictionary<string, ITactileToken> registered,
        out Color colour)
    {
        var hex = Regex.Match(text, @"#[0-9a-fA-F]{6}");
        if (hex.Success)
        {
            colour = Color.FromHtml(hex.Value);
            return true;
        }
        var reference = text.Trim();
        if (registered.TryGetValue(reference, out var token) && token.UntypedValue is Color referencedColour)
        {
            colour = referencedColour;
            return true;
        }
        colour = default;
        return false;
    }

    private static string MarkdownText(string text) =>
        text.Replace("**", "", StringComparison.Ordinal).Replace("`", "", StringComparison.Ordinal).Trim();

    [Fact]
    public void Pinned_tokens_name_an_allowed_source_line()
    {
        var pinned = TactileTheme.Tokens.Where(token => token.Tag == "pinned").ToArray();
        Assert.NotEmpty(pinned);
        Assert.All(pinned, token => Assert.Matches(
            @"^(main\.css|src/ui/(panel-view|inspector)\.ts):\d+(?:-\d+)?$",
            token.Source));
    }

    [Fact]
    public void Derived_tokens_name_their_derivation()
    {
        var derived = TactileTheme.Tokens.Where(token => token.Tag == "derived").ToArray();
        Assert.NotEmpty(derived);
        Assert.All(derived, token =>
            Assert.True(token.Source.Contains("ratio", StringComparison.OrdinalIgnoreCase) ||
                token.Source.Contains("default", StringComparison.OrdinalIgnoreCase), token.Name));
    }

    [Fact]
    public void Chosen_tokens_name_only_the_permitted_open_question_or_PR8()
    {
        var chosen = TactileTheme.Tokens.Where(token => token.Tag == "chosen").ToArray();
        Assert.NotEmpty(chosen);
        Assert.All(chosen, token =>
        {
            if (CameraTokens.Contains(token.Name)) Assert.Equal("PR-8", token.OpenQuestion);
            else Assert.Matches(@"^O-P(?:1[0-8]|[1-9])(?: / O-P[1-9]+)?$", token.OpenQuestion);
        });
        Assert.Equal(CameraTokens, chosen.Where(token => token.OpenQuestion == "PR-8")
            .Select(token => token.Name).ToHashSet(StringComparer.Ordinal));
    }

    [Fact]
    public void Token_names_and_sources_contain_no_physical_unit_words()
    {
        Assert.All(TactileTheme.Tokens, token =>
        {
            Assert.DoesNotMatch(UnitWord(), token.Name);
            Assert.DoesNotMatch(UnitWord(), token.Source);
        });
    }

    [Fact]
    public void P6_consumers_exist_and_contain_only_the_closed_arithmetic_literal_set()
    {
        foreach (var name in new[]
        {
            "Stage3D.cs", "OrbitCamera.cs", "OrbitMath.cs", "QuadMap.cs", "CordLay.cs", "CordMesh.cs",
            "Case3D.cs", "Knob3D.cs", "Relay3D.cs", "Bezels.cs", "PopOuts.cs", "LampGlow.cs",
        })
        {
            var path = Path.Combine(RepoRoot(), "godot", "scripts", name);
            Assert.True(File.Exists(path), "missing P6 consumer " + name);
            var source = MaskCommentsAndLiterals(File.ReadAllText(path));
            foreach (Match match in NumericLiteral().Matches(source))
            {
                if (IsArrayIndex(source, match)) continue;
                var text = match.Value.TrimEnd('f', 'F', 'd', 'D', 'm', 'M').Replace("_", "", StringComparison.Ordinal);
                var value = double.Parse(text, NumberStyles.Float, CultureInfo.InvariantCulture);
                Assert.True(ArithmeticLiterals.Contains(value), $"{name}:{LineAt(source, match.Index)} numeric literal {match.Value}");
            }
        }
    }

    [Fact]
    public void Panel_theme_delegates_every_shared_appendix_h_value()
    {
        var source = MaskCommentsAndLiterals(File.ReadAllText(Path.Combine(RepoRoot(), "godot", "scripts", "PanelTheme.cs")));
        foreach (var (member, expectedExpression) in new[]
        {
            ("ConsoleTeal", "TactileTheme.ConsoleTeal.Value"),
            ("ConsoleDark", "TactileTheme.ConsoleDark.Value"),
            ("ConsoleCream", "TactileTheme.ConsoleCream.Value"),
            ("ConsoleRed", "TactileTheme.ConsoleRed.Value"),
            ("ConsoleRedLit", "TactileTheme.ConsoleRedLit.Value"),
            ("RelayWidth", "TactileTheme.RelayBody.Value.X"),
            ("RelayHeight", "TactileTheme.RelayBody.Value.Y"),
            ("DialDiameter", "TactileTheme.KnobSquare.Value"),
            ("RelayCrossbarShift", "travel * TactileTheme.CrossbarShift.Value / 1000 - TactileTheme.CrossbarShift.Value / 2"),
            ("DialPointerDegrees", "udeg / TactileTheme.DialRotation.Value"),
            ("HoleDiameter", "TactileTheme.HoleHit.Value"),
            ("LampDiameter", "TactileTheme.LampLens.Value"),
            ("PowerJewelDiameter", "TactileTheme.Jewel.Value"),
            ("PowerJewelBezel", "TactileTheme.JewelBezel.Value"),
            ("PushbuttonDiameter", "TactileTheme.Pushbutton.Value"),
            ("BreakerDiameter", "TactileTheme.Breaker.Value"),
            ("SlideSize", "TactileTheme.Slide.Value"),
            ("PowerSwitchSize", "TactileTheme.PowerSwitch.Value"),
            ("RivetDiameter", "TactileTheme.Rivet.Value"),
        })
        {
            Assert.Equal(expectedExpression, ExtractPanelThemeExpression(source, member));
        }
        Assert.Equal(Color.FromHtml("62979a"), PanelTheme.ConsoleTeal);
        Assert.Equal(Color.FromHtml("24241f"), PanelTheme.ConsoleDark);
        Assert.Equal(Color.FromHtml("e6dfc7"), PanelTheme.ConsoleCream);
        Assert.Equal(Color.FromHtml("a9473d"), PanelTheme.ConsoleRed);
        Assert.Equal(Color.FromHtml("d65a4b"), PanelTheme.ConsoleRedLit);
        Assert.Equal((.095, .058), TactileTheme.RelayBody.Value);
        Assert.Equal(.085, TactileTheme.KnobSquare.Value);
        Assert.Equal(1.6, TactileTheme.CrossbarShift.Value);
        Assert.Equal(1_000_000, TactileTheme.DialRotation.Value);
        Assert.Equal(.0022, TactileTheme.JewelBezel.Value);
        Assert.Equal(.095, PanelTheme.RelayWidth);
        Assert.Equal(.058, PanelTheme.RelayHeight);
        Assert.Equal(.085, PanelTheme.DialDiameter);
        Assert.Equal(.0105, PanelTheme.HoleDiameter);
        Assert.Equal(.024, PanelTheme.LampDiameter);
        Assert.Equal(.0175, PanelTheme.PowerJewelDiameter);
        Assert.Equal(.0022, PanelTheme.PowerJewelBezel);
        Assert.Equal(.034, PanelTheme.PushbuttonDiameter);
        Assert.Equal(.031, PanelTheme.BreakerDiameter);
        Assert.Equal(new Vector2(.032f, .0115f), PanelTheme.SlideSize);
        Assert.Equal(new Vector2(.0115f, .032f), PanelTheme.PowerSwitchSize);
        Assert.Equal(.008, PanelTheme.RivetDiameter);
        for (var travel = 0; travel <= 1000; travel++)
            Assert.Equal(travel * 1.6 / 1000 - .8, PanelTheme.RelayCrossbarShift(travel));
        Assert.Equal(90, PanelTheme.DialPointerDegrees(90_000_000));
    }

    [Fact]
    public void Panel_theme_expression_extraction_rejects_comments_and_duplicate_literals()
    {
        const string source = "public static double HoleDiameter => /* TactileTheme.HoleHit.Value */ .0105;\n" +
            "public static double Unused => TactileTheme.HoleHit.Value;";
        Assert.Equal(".0105", ExtractPanelThemeExpression(MaskCommentsAndLiterals(source), "HoleDiameter"));
    }

    private static string ExtractPanelThemeExpression(string source, string member)
    {
        var property = Regex.Match(source, $@"public\s+static(?:\s+readonly)?\s+[\w<>]+\s+{member}\s*=>\s*(?<expression>[^;]+);");
        if (property.Success) return NormalizeExpression(property.Groups["expression"].Value);
        var method = Regex.Match(source, $@"public\s+static\s+[\w<>]+\s+{member}\s*\([^)]*\)\s*=>\s*(?<expression>[^;]+);");
        Assert.True(method.Success, "missing PanelTheme member " + member);
        return NormalizeExpression(method.Groups["expression"].Value);
    }

    private static string NormalizeExpression(string expression) =>
        Regex.Replace(expression, @"\s+", " ").Trim();

    private static bool IsArrayIndex(string source, Match match)
    {
        var before = match.Index - 1;
        while (before >= 0 && char.IsWhiteSpace(source[before])) before--;
        var after = match.Index + match.Length;
        while (after < source.Length && char.IsWhiteSpace(source[after])) after++;
        return before >= 0 && after < source.Length && source[before] == '[' && source[after] == ']';
    }

    private static int LineAt(string source, int index) =>
        source.AsSpan(0, index).Count('\n') + 1;

    private static string RepoRoot() =>
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../.."));

    private static string MaskCommentsAndLiterals(string source)
    {
        var chars = source.ToCharArray();
        foreach (var literal in LiteralExtractor.Extract(source))
            for (var index = literal.Offset; index < literal.Offset + literal.Length; index++)
                if (chars[index] != '\n') chars[index] = ' ';
        var masked = new string(chars);
        masked = BlockComment().Replace(masked, match => new string(match.Value.Select(ch => ch == '\n' ? '\n' : ' ').ToArray()));
        masked = LineComment().Replace(masked, match => new string(' ', match.Length));
        return masked;
    }

    [GeneratedRegex(@"\b(inch|inches|mm|millimet|centimet|cm|metre|meter|pound|lb|lbs)\b", RegexOptions.IgnoreCase)]
    private static partial Regex UnitWord();

    [GeneratedRegex(@"(?<![\w.])[-+]?(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d+)(?:[fFdDmM])?(?![\w.])")]
    private static partial Regex NumericLiteral();

    [GeneratedRegex(@"/\*.*?\*/", RegexOptions.Singleline)]
    private static partial Regex BlockComment();

    [GeneratedRegex(@"//[^\r\n]*")]
    private static partial Regex LineComment();
}
