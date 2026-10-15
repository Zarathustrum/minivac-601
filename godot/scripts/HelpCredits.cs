using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using Godot;

namespace Minivac.Godot;

public sealed record HelpCredit(
    string Id,
    string Heading,
    string Description,
    string Creator,
    string SourcePage,
    string License,
    string LicenseUrl);

public partial class HelpCredits : AcceptDialog
{
    public const string ProfileDisclosure =
        "Both choices are unmeasured simulator profiles. REF-A is the default marginal-behavior profile; IDEAL is the forgiving profile.";
    public const string RedrawLimits =
        "The palette and panel geometry are approximate and photograph-derived. The 1.80 ratio, band boundaries, and placement values are unverified proportions, not physical dimensions. Exact RGB values, typeface, coating, substrate, mounting-disc function, and rotary-knob colour and form remain unresolved. The three-dimensional case, knob, control heights, relay bodies, bezels and patch cords are chosen redraw tokens recorded in the project's open questions; no dimension of the original is known.";
    public const string PowerLimits =
        "The POWER jewel is a binary interface projection: lit when rail voltage is above zero and dark at zero. It is not a modeled lamp-current or intensity result. Lamp glow and every sound other than the relay click are simulated presentation, not evidence about the original; the relay click is the only sound the manuals describe.";

    public const string PrimaryPanelHeading = "Primary panel photograph (PH2)";
    public const string PrimaryPanelDescription =
        "Primary evidence for panel geometry and visual facts. The procedural HTML/CSS/SVG redraw changes the photograph into measured, fixed-geometry shapes without shipping the raster. It is an adaptation, and the panel-art derivative is licensed CC BY-SA 4.0.";
    public const string PowerJewelHeading = "POWER-jewel evidence (PH3)";
    public const string PowerJewelDescription =
        "Corroboration for the factory POWER jewel and unit-to-unit variation only; its oblique geometry was not measured and the raster is not shipped.";
    public const string RelayCueHeading = "Relay simulation cue";
    public const string RelayCueDescription =
        "The shipped attenuated derivative is a simulated operation cue, not an authenticated MINIVAC recording.";
    public const string RotaryLoopHeading = "Rotary drive-wheel simulation loop";
    public const string RotaryLoopDescription =
        "The shipped attenuated, wrap-crossfaded derivative is a simulated motor cue, not an authenticated MINIVAC recording.";
    public const string RelayDropOutHeading = "Relay release simulation";
    public const string RelayDropOutDescription =
        "Both builds include the derivative; the desktop build uses it as a simulated relay drop-out cue. It is not an authenticated MINIVAC recording.";

    public const string LoadWorkflowHeading = "Load";
    public const string PowerWorkflowHeading = "Power";
    public const string OperateWorkflowHeading = "Operate";
    public const string WireWorkflowHeading = "Wire";
    public const string TouchWorkflowHeading = "Momentary Touch";

    private const string LoadWorkflow =
        "Open Library & diagnostics, choose a demo, activate Load demo, then use Reset whenever you want its original state.";
    private const string PowerWorkflow =
        "Use the panel POWER switch. If the circuit breaker trips, remove the fault before resetting it.";
    private const string OperateWorkflow =
        "Use the red pushbuttons, slide switches, relay crossbars, and decimal dial directly on the panel. " +
        "Shift-click a pushbutton to keep it held down; click it again to let it go.";
    private const string WireWorkflow =
        "Choose Add free cord, select end A or B, then choose a jack hole on the panel or in the terminal picker.";
    private const string TouchWorkflow =
        "With a free cord end selected, hold its terminal-picker Touch control. It conducts only while held, occupies no hole, and returns the end to free when released.";

    private Preferences _preferences = null!;
    private Action<string> _onViewModeChanged = _ => { };
    private Action _onClosed = () => { };
    private IReadOnlyList<HelpCredit> _credits = Array.Empty<HelpCredit>();
    private IReadOnlyList<string> _pages = Array.Empty<string>();
    private Control _previousButton = null!;
    private Control _nextButton = null!;
    private Control _sourceButton = null!;
    private Control _licenseButton = null!;
    private Control _reduceMotionButton = null!;
    private Control _viewModeButton = null!;
    private int _pageIndex;
    private bool _initialized;
    private bool _closing;

    public bool InitiallyOpen { get; private set; }
    public bool IsOpen => Visible;
    public int PageIndex => _pageIndex;
    public IReadOnlyList<string> Pages => _pages;
    public IReadOnlyList<HelpCredit> Credits => _credits;
    public Control ReduceMotionControl => _reduceMotionButton;
    public Control ViewModeControl => _viewModeButton;

    public void Initialize(
        byte[] publicAssetsJson,
        Preferences preferences,
        Action<string> onViewModeChanged,
        Action? onClosed = null)
    {
        ArgumentNullException.ThrowIfNull(publicAssetsJson);
        ArgumentNullException.ThrowIfNull(preferences);
        ArgumentNullException.ThrowIfNull(onViewModeChanged);
        if (_initialized) throw new InvalidOperationException("help credits: already initialized");
        _initialized = true;
        _preferences = preferences;
        _onViewModeChanged = onViewModeChanged;
        _onClosed = onClosed ?? (() => { });
        _credits = ReadCredits(publicAssetsJson);
        _pages = BuildPages(_credits);
        InitiallyOpen = !preferences.HelpSeen;

        Name = "HelpCredits";
        Title = "MINIVAC 601 help";
        Exclusive = true;
        Unresizable = false;
        MinSize = new(640, 520);

        var ok = GetOkButton();
        ok.Text = "Close help";
        ok.TooltipText = "Close help";

        var previous = AddButton("Previous", false, "previous");
        previous.Pressed += PreviousPage;
        _previousButton = previous;
        var next = AddButton("Next", true, "next");
        next.Pressed += NextPage;
        _nextButton = next;

        var source = AddButton("Open source", false, "source");
        source.Pressed += OpenCurrentSource;
        _sourceButton = source;
        var license = AddButton("Open license", true, "license");
        license.Pressed += OpenCurrentLicense;
        _licenseButton = license;

        var reduceMotion = AddButton("", false, "reduce-motion");
        reduceMotion.Pressed += ToggleReduceMotion;
        _reduceMotionButton = reduceMotion;
        var viewMode = AddButton("", true, "view-mode");
        viewMode.Pressed += ToggleViewMode;
        _viewModeButton = viewMode;

        Confirmed += FinishClose;
        Canceled += FinishClose;
        CloseRequested += Close;
        RenderPage();
        if (InitiallyOpen && IsInsideTree()) Open();
    }

    public override void _Ready()
    {
        if (_initialized && InitiallyOpen && !Visible) Open();
    }

    public void Open()
    {
        if (!_initialized || Visible) return;
        _pageIndex = 0;
        RenderPage();
        PopupCenteredRatio(0.82f);
    }

    public void Close()
    {
        if (!_initialized || _closing) return;
        _closing = true;
        MarkSeen();
        Hide();
        _onClosed();
        _closing = false;
    }

    public void PreviousPage()
    {
        if (_pageIndex == 0) return;
        _pageIndex--;
        RenderPage();
    }

    public void NextPage()
    {
        if (_pageIndex >= _pages.Count - 1) return;
        _pageIndex++;
        RenderPage();
    }

    public void ToggleReduceMotion()
    {
        _preferences.SetReduceMotion(!_preferences.ReduceMotion);
        RenderPage();
    }

    public void ToggleViewMode()
    {
        var mode = _preferences.ViewMode == "flat" ? "3d" : "flat";
        _preferences.SetViewMode(mode);
        _onViewModeChanged(mode);
        RenderPage();
    }

    public void OpenCurrentSource()
    {
        var credit = CurrentCredit();
        if (credit is not null) _ = OS.ShellOpen(credit.SourcePage);
    }

    public void OpenCurrentLicense()
    {
        var credit = CurrentCredit();
        if (credit is not null) _ = OS.ShellOpen(credit.LicenseUrl);
    }

    public static string LicenseName(string id) => id switch
    {
        "CC-BY-SA-4.0" => "CC BY-SA 4.0",
        "CC-BY-2.0" => "CC BY 2.0",
        "CC0-1.0" => "CC0 1.0",
        _ => throw new InvalidOperationException("help credits: unsupported license " + id),
    };

    private void MarkSeen()
    {
        if (!_initialized) return;
        _preferences.SetHelpSeen(true);
    }

    private void FinishClose()
    {
        MarkSeen();
        _onClosed();
    }

    private void RenderPage()
    {
        DialogText = _pages.Count == 0 ? "" : _pages[_pageIndex];
        _previousButton.Set("disabled", _pageIndex == 0);
        _nextButton.Set("disabled", _pageIndex == _pages.Count - 1);

        var credit = CurrentCredit();
        var creditPage = credit is not null;
        _sourceButton.Visible = creditPage;
        _licenseButton.Visible = creditPage;
        _reduceMotionButton.Visible = _pageIndex == 0;
        _viewModeButton.Visible = _pageIndex == 0;
        _reduceMotionButton.Set(
            "text",
            "Reduce motion: " + (_preferences.ReduceMotion ? "on" : "off"));
        _viewModeButton.Set(
            "text",
            "View: " + (_preferences.ViewMode == "3d" ? "3D" : "flat"));
        if (credit is null) return;
        _sourceButton.TooltipText = credit.SourcePage;
        _licenseButton.TooltipText = credit.LicenseUrl;
        _licenseButton.Set("text", "Open " + LicenseName(credit.License));
    }

    private HelpCredit? CurrentCredit()
    {
        var index = _pageIndex - 2;
        return index >= 0 && index < _credits.Count ? _credits[index] : null;
    }

    private static IReadOnlyList<HelpCredit> ReadCredits(byte[] bytes)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(bytes);
        }
        catch (JsonException)
        {
            throw new InvalidOperationException("help credits: public assets is not valid JSON");
        }

        using (document)
        {
            if (!document.RootElement.TryGetProperty("records", out var records) ||
                records.ValueKind != JsonValueKind.Array)
            {
                throw new InvalidOperationException("help credits: public assets records must be an array");
            }

            var headings = new Dictionary<string, (string Heading, string Description)>(StringComparer.Ordinal)
            {
                ["panel-ph2-primary"] = (PrimaryPanelHeading, PrimaryPanelDescription),
                ["panel-ph3-corroboration"] = (PowerJewelHeading, PowerJewelDescription),
                ["relay-cue"] = (RelayCueHeading, RelayCueDescription),
                ["rotary-drive-loop"] = (RotaryLoopHeading, RotaryLoopDescription),
                ["relay-drop-out-cue"] = (RelayDropOutHeading, RelayDropOutDescription),
            };
            var found = new Dictionary<string, HelpCredit>(StringComparer.Ordinal);
            foreach (var record in records.EnumerateArray())
            {
                if (!record.TryGetProperty("id", out var idValue) || idValue.ValueKind != JsonValueKind.String)
                    continue;
                var id = idValue.GetString()!;
                if (!headings.TryGetValue(id, out var copy)) continue;
                if (found.ContainsKey(id))
                    throw new InvalidOperationException("help credits: duplicate public asset " + id);
                var license = Required(record, "license", id);
                _ = LicenseName(license);
                found.Add(id, new HelpCredit(
                    id,
                    copy.Heading,
                    copy.Description,
                    Required(record, "creator", id),
                    Required(record, "sourcePage", id),
                    license,
                    Required(record, "licenseUrl", id)));
            }

            var ids = new[]
            {
                "panel-ph2-primary",
                "panel-ph3-corroboration",
                "relay-cue",
                "rotary-drive-loop",
                "relay-drop-out-cue",
            };
            var result = new HelpCredit[ids.Length];
            for (var index = 0; index < ids.Length; index++)
            {
                if (!found.TryGetValue(ids[index], out var credit))
                    throw new InvalidOperationException("help credits: missing public asset " + ids[index]);
                result[index] = credit;
            }
            return Array.AsReadOnly(result);
        }
    }

    private static string Required(JsonElement record, string key, string id)
    {
        if (!record.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.String ||
            string.IsNullOrEmpty(value.GetString()))
        {
            throw new InvalidOperationException("help credits: " + id + "." + key + " must be a string");
        }
        return value.GetString()!;
    }

    private static IReadOnlyList<string> BuildPages(IReadOnlyList<HelpCredit> credits)
    {
        var pages = new string[credits.Count + 2];
        pages[0] =
            "Five steps\n\n" +
            LoadWorkflowHeading + "\n" + LoadWorkflow + "\n\n" +
            PowerWorkflowHeading + "\n" + PowerWorkflow + "\n\n" +
            OperateWorkflowHeading + "\n" + OperateWorkflow + "\n\n" +
            WireWorkflowHeading + "\n" + WireWorkflow + "\n\n" +
            TouchWorkflowHeading + "\n" + TouchWorkflow + "\n\n" +
            "Simulator profiles\n" + ProfileDisclosure;
        pages[1] = "Redraw and simulation limits\n\n" + RedrawLimits + "\n\n" + PowerLimits;
        for (var index = 0; index < credits.Count; index++)
        {
            var credit = credits[index];
            var text = new StringBuilder();
            text.Append("Credits\n\n");
            text.Append(credit.Heading).Append(" — ").Append(credit.Creator).Append(".\n\n");
            text.Append(credit.Description).Append("\n\n");
            text.Append(credit.Heading).Append(" source\n").Append(credit.SourcePage).Append("\n\n");
            text.Append(LicenseName(credit.License)).Append("\n").Append(credit.LicenseUrl);
            pages[index + 2] = text.ToString();
        }
        return Array.AsReadOnly(pages);
    }
}
