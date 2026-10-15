using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using Godot;

namespace Minivac.Godot;

public sealed record DemoRenderedSource(
    string Program,
    string Locator,
    string Confidence,
    IReadOnlyList<string> Errata,
    IReadOnlyList<string> Fallbacks);

public sealed record DemoRenderedEntry(
    string Id,
    string Title,
    string Category,
    DemoRenderedSource Source,
    IReadOnlyList<string> Instructions,
    IReadOnlyDictionary<string, string> ControlLabels,
    IReadOnlyList<string> NoticeParagraphs);

public partial class DemoExperience : Control
{
    public const string ReferenceProfileId = "MV601-REF-A";
    public const string IdealProfileId = "MV601-IDEAL";
    public const string ReferenceProfileLabel =
        "REF-A — default marginal-behavior unmeasured simulator profile";
    public const string IdealProfileLabel =
        "IDEAL — forgiving unmeasured simulator profile";
    public const string ProfileDisclosure =
        "Both choices are unmeasured simulator profiles. REF-A is the default marginal-behavior profile; IDEAL is the forgiving profile.";
    public const string SelectedDemoResetLabel = "Reset selected demo";
    public const string BlankPanelResetLabel = "Reset blank panel";

    private readonly List<Button> _demoButtons = [];
    private readonly List<DemoEntryControl> _entryControls = [];
    private readonly List<Control> _entryMounts = [];
    private IReadOnlyList<DemoRenderedEntry> _entries = Array.Empty<DemoRenderedEntry>();
    private Action<string> _onDemoSelect = _ => { };
    private Action _onManual = () => { };
    private Action _onReset = () => { };
    private Action<string> _onProfileSelect = _ => { };
    private Action _onCancel = () => { };
    private Label _blankLabel = null!;
    private Label _profileHeading = null!;
    private RichTextLabel _profileDisclosure = null!;
    private Button _referenceProfile = null!;
    private Button _idealProfile = null!;
    private bool _initialized;
    private float _entryScrollOffset;

    public Button LoadButton { get; private set; } = null!;
    public Button ManualButton { get; private set; } = null!;
    public Button ResetButton { get; private set; } = null!;
    public Button ScrollUpButton { get; private set; } = null!;
    public Button ScrollDownButton { get; private set; } = null!;
    public IReadOnlyList<Button> DemoButtons => _demoButtons.AsReadOnly();
    public IReadOnlyList<DemoRenderedEntry> Entries => _entries;
    public string SelectedDemoId { get; private set; } = "";
    public string ProfileId { get; private set; } = ReferenceProfileId;
    public bool Manual { get; private set; }
    public float EntryScrollOffset => _entryScrollOffset;
    public float SelectedEntryContentHeight => _entryControls[SelectedIndex()].RequiredHeight;
    public float SelectedEntryViewportHeight => _entryMounts[SelectedIndex()].Size.Y;
    internal Rect2 SelectedEntryViewportRect => _entryMounts[SelectedIndex()].GetGlobalRect();

    public void Initialize(
        IReadOnlyList<Demo> demos,
        string demoId,
        string profileId,
        bool manual,
        Action<string> onDemoSelect,
        Action onManual,
        Action onReset,
        Action<string> onProfileSelect,
        Action onCancel)
    {
        ArgumentNullException.ThrowIfNull(demos);
        ArgumentNullException.ThrowIfNull(onDemoSelect);
        ArgumentNullException.ThrowIfNull(onManual);
        ArgumentNullException.ThrowIfNull(onReset);
        ArgumentNullException.ThrowIfNull(onProfileSelect);
        ArgumentNullException.ThrowIfNull(onCancel);
        if (_initialized) throw new InvalidOperationException("demo experience: already initialized");
        if (demos.Count != 17) throw new InvalidOperationException("demo experience: expected exactly seventeen demos");

        _initialized = true;
        _onDemoSelect = onDemoSelect;
        _onManual = onManual;
        _onReset = onReset;
        _onProfileSelect = onProfileSelect;
        _onCancel = onCancel;
        Name = "DemoExperience";
        MouseFilter = MouseFilterEnum.Stop;

        var rendered = new DemoRenderedEntry[demos.Count];
        for (var index = 0; index < demos.Count; index++)
        {
            var demo = demos[index];
            for (var prior = 0; prior < index; prior++)
            {
                if (string.Equals(demos[prior].Id, demo.Id, StringComparison.Ordinal))
                    throw new InvalidOperationException("demo experience: duplicate demo " + demo.Id);
            }

            rendered[index] = RenderedEntry(demo);
            var selection = new Button
            {
                Name = "Demo_" + demo.Id,
                Text = demo.Title,
                TooltipText = demo.Title + " · " + demo.Category,
                ToggleMode = true,
                FocusMode = FocusModeEnum.All,
            };
            var selectedId = demo.Id;
            selection.Pressed += () => SelectForLoading(selectedId);
            BindCancel(selection);
            AddChild(selection);
            _demoButtons.Add(selection);

            var mount = new Control
            {
                Name = "EntryMount_" + demo.Id,
                ClipContents = true,
                MouseFilter = MouseFilterEnum.Ignore,
            };
            AddChild(mount);
            _entryMounts.Add(mount);
            var entry = new DemoEntryControl();
            mount.AddChild(entry);
            entry.Initialize(rendered[index]);
            _entryControls.Add(entry);
        }
        _entries = Array.AsReadOnly(rendered);

        LoadButton = ActionButton("LoadDemo", "Load demo", LoadSelected);
        ManualButton = ActionButton("BlankPanel", "Blank panel", LoadManual);
        ResetButton = ActionButton("Reset", SelectedDemoResetLabel, Reset);
        ScrollUpButton = ActionButton("EntryScrollUp", "Page up", ScrollUp);
        ScrollDownButton = ActionButton("EntryScrollDown", "Page down", ScrollDown);

        _profileHeading = TextLabel("ProfileHeading", "Simulator profile");
        _referenceProfile = ProfileButton("ReferenceProfile", ReferenceProfileLabel, ReferenceProfileId);
        _idealProfile = ProfileButton("IdealProfile", IdealProfileLabel, IdealProfileId);
        _profileDisclosure = TextBlock("ProfileDisclosure", ProfileDisclosure);
        _profileDisclosure.TooltipText = ProfileDisclosure;
        _blankLabel = TextLabel("BlankPanelNotice", "Blank panel");

        UpdateSelection(demoId, profileId, manual);
        ApplyLayout();
    }

    public void UpdateSelection(string demoId, string profileId, bool manual)
    {
        RequireDemo(demoId);
        RequireProfile(profileId);
        if (SelectedDemoId != demoId || Manual != manual) _entryScrollOffset = 0;
        SelectedDemoId = demoId;
        ProfileId = profileId;
        Manual = manual;

        for (var index = 0; index < _entries.Count; index++)
        {
            var selected = string.Equals(_entries[index].Id, demoId, StringComparison.Ordinal);
            _demoButtons[index].ButtonPressed = selected;
            _entryMounts[index].Visible = !manual && selected;
        }
        _referenceProfile.ButtonPressed = profileId == ReferenceProfileId;
        _idealProfile.ButtonPressed = profileId == IdealProfileId;
        _blankLabel.Visible = manual;
        ScrollUpButton.Visible = !manual;
        ScrollDownButton.Visible = !manual;
        ResetButton.Text = manual ? BlankPanelResetLabel : SelectedDemoResetLabel;
        ResetButton.TooltipText = ResetButton.Text;
        ApplyEntryScroll();
    }

    public override void _Notification(int what)
    {
        if (what == NotificationResized && _initialized) ApplyLayout();
    }

    public IReadOnlyList<DemoRenderedEntry> CaptureRenderedEntries()
    {
        var captured = new DemoRenderedEntry[_entryControls.Count];
        for (var index = 0; index < captured.Length; index++) captured[index] = _entryControls[index].Capture();
        return Array.AsReadOnly(captured);
    }

    private void SelectForLoading(string demoId)
    {
        UpdateSelection(demoId, ProfileId, Manual);
        for (var index = 0; index < _entries.Count; index++)
        {
            if (string.Equals(_entries[index].Id, demoId, StringComparison.Ordinal))
            {
                _demoButtons[index].GrabFocus();
                return;
            }
        }
    }

    private void LoadSelected()
    {
        _onDemoSelect(SelectedDemoId);
        UpdateSelection(SelectedDemoId, ProfileId, false);
        LoadButton.GrabFocus();
    }

    private void LoadManual()
    {
        _onManual();
        UpdateSelection(SelectedDemoId, ProfileId, true);
        ManualButton.GrabFocus();
    }

    private void Reset()
    {
        _onReset();
        ResetButton.GrabFocus();
    }

    private void SelectProfile(string profileId)
    {
        _onProfileSelect(profileId);
        UpdateSelection(SelectedDemoId, profileId, Manual);
        if (profileId == ReferenceProfileId) _referenceProfile.GrabFocus();
        else _idealProfile.GrabFocus();
    }

    private void ScrollUp()
    {
        ScrollBy(-1);
        ScrollUpButton.GrabFocus();
    }

    private void ScrollDown()
    {
        ScrollBy(1);
        ScrollDownButton.GrabFocus();
    }

    private void ScrollBy(int direction)
    {
        var index = SelectedIndex();
        var page = Math.Max(80, _entryMounts[index].Size.Y * 0.8f);
        var maximum = Math.Max(0, _entryControls[index].RequiredHeight - _entryMounts[index].Size.Y);
        _entryScrollOffset = Math.Clamp(_entryScrollOffset + direction * page, 0, maximum);
        ApplyEntryScroll();
    }

    private int SelectedIndex()
    {
        for (var index = 0; index < _entries.Count; index++)
            if (_entries[index].Id == SelectedDemoId) return index;
        throw new InvalidOperationException("demo experience: selected demo is missing");
    }

    private void ApplyEntryScroll()
    {
        if (_entryControls.Count == 0) return;
        var selected = SelectedIndex();
        var maximum = Math.Max(0, _entryControls[selected].RequiredHeight - _entryMounts[selected].Size.Y);
        _entryScrollOffset = Math.Clamp(_entryScrollOffset, 0, maximum);
        for (var index = 0; index < _entryControls.Count; index++)
            _entryControls[index].Position = new(0, index == selected ? -_entryScrollOffset : 0);
        ScrollUpButton.Disabled = _entryScrollOffset <= 0;
        ScrollDownButton.Disabled = _entryScrollOffset >= maximum;
    }

    private Button ActionButton(string name, string text, Action action)
    {
        var button = new Button
        {
            Name = name,
            Text = text,
            TooltipText = text,
            FocusMode = FocusModeEnum.All,
        };
        button.Pressed += action;
        BindCancel(button);
        AddChild(button);
        return button;
    }

    private Button ProfileButton(string name, string text, string profileId)
    {
        var button = new Button
        {
            Name = name,
            Text = text,
            TooltipText = text,
            ToggleMode = true,
            FocusMode = FocusModeEnum.All,
        };
        button.Pressed += () => SelectProfile(profileId);
        BindCancel(button);
        AddChild(button);
        return button;
    }

    private void BindCancel(Button button)
    {
        button.GuiInput += input =>
        {
            if (!input.IsActionPressed("ui_cancel")) return;
            _onCancel();
            button.AcceptEvent();
        };
    }

    private Label TextLabel(string name, string text)
    {
        var label = new Label { Name = name, Text = text, MouseFilter = MouseFilterEnum.Ignore };
        AddChild(label);
        return label;
    }

    private RichTextLabel TextBlock(string name, string text)
    {
        var label = new RichTextLabel
        {
            Name = name,
            Text = text,
            FitContent = true,
            ScrollActive = false,
            MouseFilter = MouseFilterEnum.Ignore,
        };
        AddChild(label);
        return label;
    }

    private void RequireDemo(string demoId)
    {
        for (var index = 0; index < _entries.Count; index++)
        {
            if (string.Equals(_entries[index].Id, demoId, StringComparison.Ordinal)) return;
        }
        throw new InvalidOperationException("demo experience: unknown demo " + demoId);
    }

    private static void RequireProfile(string profileId)
    {
        if (profileId != ReferenceProfileId && profileId != IdealProfileId)
            throw new InvalidOperationException("demo experience: unknown profile " + profileId);
    }

    private void ApplyLayout()
    {
        var width = Math.Max(300, Size.X);
        var height = Math.Max(500, Size.Y);
        var listWidth = Math.Min(220, Math.Max(150, width * 0.31f));
        var listY = 0f;
        for (var index = 0; index < _demoButtons.Count; index++)
        {
            _demoButtons[index].Position = new(0, listY);
            _demoButtons[index].Size = new(listWidth, 30);
            listY += 32;
        }

        LoadButton.Position = new(0, listY + 4);
        LoadButton.Size = new(listWidth, 32);
        ManualButton.Position = new(0, listY + 40);
        ManualButton.Size = new(listWidth, 32);
        ResetButton.Position = new(0, listY + 76);
        ResetButton.Size = new(listWidth, 32);

        var detailX = listWidth + 12;
        var detailWidth = Math.Max(120, width - detailX);
        _profileHeading.Position = new(detailX, 0);
        _profileHeading.Size = new(detailWidth, 24);
        _referenceProfile.Position = new(detailX, 26);
        _referenceProfile.Size = new(detailWidth, 32);
        _idealProfile.Position = new(detailX, 60);
        _idealProfile.Size = new(detailWidth, 32);
        _profileDisclosure.Position = new(detailX, 96);
        _profileDisclosure.Size = new(detailWidth, 66);
        _blankLabel.Position = new(detailX, 170);
        _blankLabel.Size = new(detailWidth, 30);

        for (var index = 0; index < _entryControls.Count; index++)
        {
            var viewportHeight = Math.Max(160, height - 208);
            _entryMounts[index].Position = new(detailX, 170);
            _entryMounts[index].Size = new(detailWidth, viewportHeight);
            _entryControls[index].Size = new(Math.Max(100, detailWidth - 16), _entryControls[index].RequiredHeight);
        }
        var scrollY = 174 + Math.Max(160, height - 208);
        var scrollWidth = Math.Max(58, (detailWidth - 4) / 2);
        ScrollUpButton.Position = new(detailX, scrollY);
        ScrollUpButton.Size = new(scrollWidth, 30);
        ScrollDownButton.Position = new(detailX + scrollWidth + 4, scrollY);
        ScrollDownButton.Size = new(scrollWidth, 30);
        ApplyEntryScroll();
    }

    private static DemoRenderedEntry RenderedEntry(Demo demo)
    {
        var notice = demo.Notice is null
            ? Array.Empty<string>()
            : demo.Notice.Split("\n\n", StringSplitOptions.None);
        if (notice.Length is not (0 or 1 or 3) || Array.Exists(notice, paragraph => paragraph.Length == 0))
            throw new InvalidOperationException("demo experience: notice must contain one or three non-empty paragraphs");

        return new DemoRenderedEntry(
            demo.Id,
            demo.Title,
            demo.Category.ToString(),
            new DemoRenderedSource(
                demo.Source.Program,
                demo.Source.Locator,
                demo.Source.Confidence.ToString(),
                Copy(demo.Source.Errata),
                Copy(demo.Source.Fallbacks)),
            Copy(demo.Instructions),
            Copy(demo.ControlLabels),
            Array.AsReadOnly(notice));
    }

    private static IReadOnlyList<string> Copy(IReadOnlyList<string> values)
    {
        var copy = new string[values.Count];
        for (var index = 0; index < values.Count; index++) copy[index] = values[index];
        return Array.AsReadOnly(copy);
    }

    private static IReadOnlyDictionary<string, string> Copy(IReadOnlyDictionary<string, string> values)
    {
        var copy = new Dictionary<string, string>(values.Count, StringComparer.Ordinal);
        foreach (var pair in values) copy.Add(pair.Key, pair.Value);
        return new ReadOnlyDictionary<string, string>(copy);
    }

    private sealed partial class DemoEntryControl : Control
    {
        private readonly List<Control> _rows = [];

        public float RequiredHeight { get; private set; } = 200;

        public void Initialize(DemoRenderedEntry entry)
        {
            Name = "Entry_" + entry.Id;
            MouseFilter = MouseFilterEnum.Ignore;
            AddRow("Title", entry.Title, true);
            AddRow("Category", entry.Category);
            AddRow("Source", "Source", true);
            AddRow("Program", "Program");
            AddRow("ProgramValue", entry.Source.Program);
            AddRow("Locator", "Locator");
            AddRow("LocatorValue", entry.Source.Locator);
            AddRow("Confidence", "Confidence");
            AddRow("ConfidenceValue", entry.Source.Confidence);
            AddList("Errata", entry.Source.Errata);
            AddList("Fallbacks", entry.Source.Fallbacks);
            AddRow("Instructions", "Instructions", true);
            for (var index = 0; index < entry.Instructions.Count; index++)
                AddRow("Instruction_" + index, entry.Instructions[index], rich: true);
            AddRow("Controls", "Controls", true);
            if (entry.ControlLabels.Count == 0) AddRow("ControlsNone", "None");
            var controlIndex = 0;
            foreach (var pair in entry.ControlLabels)
                AddRow("Control_" + controlIndex++, pair.Key + ": " + pair.Value);
            if (entry.NoticeParagraphs.Count != 0)
            {
                AddRow("Notice", "Notice", true);
                for (var index = 0; index < entry.NoticeParagraphs.Count; index++)
                    AddRow("NoticeParagraph_" + index, entry.NoticeParagraphs[index], rich: true);
            }
            ApplyLayout();
        }

        public DemoRenderedEntry Capture()
        {
            RequireRowText("Source", "Source");
            RequireRowText("Program", "Program");
            RequireRowText("Locator", "Locator");
            RequireRowText("Confidence", "Confidence");
            RequireRowText("Errata", "Errata");
            RequireRowText("Fallbacks", "Fallbacks");
            RequireRowText("Instructions", "Instructions");
            RequireRowText("Controls", "Controls");

            var controls = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var value in RowTexts("Control_"))
            {
                var separator = value.IndexOf(": ", StringComparison.Ordinal);
                if (separator < 0) throw new InvalidOperationException("demo experience: malformed rendered control label");
                controls.Add(value[..separator], value[(separator + 2)..]);
            }
            if (controls.Count == 0) RequireRowText("ControlsNone", "None");
            var noticeParagraphs = RowTexts("NoticeParagraph_");
            if (noticeParagraphs.Count != 0) RequireRowText("Notice", "Notice");

            var id = Name.ToString();
            const string prefix = "Entry_";
            if (!id.StartsWith(prefix, StringComparison.Ordinal))
                throw new InvalidOperationException("demo experience: malformed rendered entry id");
            return new DemoRenderedEntry(
                id[prefix.Length..],
                RowText("Title"),
                RowText("Category"),
                new DemoRenderedSource(
                    RowText("ProgramValue"),
                    RowText("LocatorValue"),
                    RowText("ConfidenceValue"),
                    CaptureList("Errata"),
                    CaptureList("Fallbacks")),
                RowTexts("Instruction_"),
                new ReadOnlyDictionary<string, string>(controls),
                noticeParagraphs);
        }

        public override void _Notification(int what)
        {
            if (what == NotificationResized) ApplyLayout();
        }

        private void AddList(string label, IReadOnlyList<string> values)
        {
            AddRow(label, label);
            if (values.Count == 0)
            {
                AddRow(label + "None", "None");
                return;
            }
            for (var index = 0; index < values.Count; index++)
                AddRow(label + "_" + index, values[index], rich: true);
        }

        private void AddRow(string name, string text, bool heading = false, bool rich = false)
        {
            Control row;
            if (rich)
            {
                row = new RichTextLabel
                {
                    Name = name,
                    Text = text,
                    FitContent = true,
                    ScrollActive = false,
                    MouseFilter = MouseFilterEnum.Ignore,
                    TooltipText = text,
                };
            }
            else
            {
                row = new Label
                {
                    Name = name,
                    Text = text,
                    MouseFilter = MouseFilterEnum.Ignore,
                    TooltipText = text,
                };
            }
            if (heading) row.Set("theme_override_font_sizes/font_size", 17);
            AddChild(row);
            _rows.Add(row);
        }

        private void ApplyLayout()
        {
            var y = 0f;
            foreach (var row in _rows)
            {
                var height = row is RichTextLabel ? 108f : 24f;
                row.Position = new(0, y);
                row.Size = new(Math.Max(100, Size.X), height);
                y += height + 3;
            }
            RequiredHeight = Math.Max(200, y);
            CustomMinimumSize = new(Math.Max(100, Size.X), RequiredHeight);
        }

        private string RowText(string name)
        {
            foreach (var row in _rows)
                if (row.Name == name) return Text(row);
            throw new InvalidOperationException("demo experience: missing rendered row " + name);
        }

        private IReadOnlyList<string> RowTexts(string prefix)
        {
            var values = new List<string>();
            foreach (var row in _rows)
                if (row.Name.ToString().StartsWith(prefix, StringComparison.Ordinal)) values.Add(Text(row));
            return Array.AsReadOnly(values.ToArray());
        }

        private IReadOnlyList<string> CaptureList(string label)
        {
            var values = RowTexts(label + "_");
            if (values.Count == 0) RequireRowText(label + "None", "None");
            return values;
        }

        private void RequireRowText(string name, string expected)
        {
            if (RowText(name) != expected)
                throw new InvalidOperationException("demo experience: rendered row " + name + " does not match frozen copy");
        }

        private static string Text(Control row) => row switch
        {
            Label label => label.Text,
            RichTextLabel rich => rich.Text,
            _ => throw new InvalidOperationException("demo experience: rendered row has no text"),
        };
    }
}
