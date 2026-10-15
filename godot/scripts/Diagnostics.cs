using System;
using System.Collections.Generic;
using Godot;
using Minivac.Core;

namespace Minivac.Godot;

/// <summary>Screen-space diagnostics projection; it owns no simulator state or trace history.</summary>
public partial class Diagnostics : Control
{
    private readonly List<Label> _terminalVoltages = [];
    private readonly List<RichTextLabel> _notes = [];
    private readonly List<string> _renderedNoteText = [];
    private readonly Label _voltageHeading = new() { Text = "Terminal voltages" };
    private readonly Label _notesHeading = new() { Text = "Notes" };
    private readonly Control _notesMount = new() { Name = "NotesMount", ClipContents = true, MouseFilter = MouseFilterEnum.Ignore };
    private readonly Control _notesContent = new() { Name = "NotesContent", MouseFilter = MouseFilterEnum.Ignore };
    private int _terminalPage;
    private int _terminalPageSize = 1;
    private float _noteScrollOffset;

    public Label Status { get; } = new() { Name = "Status", Text = "Ready." };
    public TraceView Trace { get; private set; } = null!;
    public IReadOnlyList<Label> TerminalVoltages => _terminalVoltages;
    public IReadOnlyList<RichTextLabel> Notes => _notes;
    public string StatusTitle { get; private set; } = "";
    public bool Portable { get; private set; }
    public int TerminalPage => _terminalPage;
    public int TerminalPageCount => (_terminalVoltages.Count + _terminalPageSize - 1) / _terminalPageSize;
    public float NoteScrollOffset => _noteScrollOffset;
    public float NoteContentHeight => _notesContent.Size.Y;
    public float NoteViewportHeight => _notesMount.Size.Y;
    public float NoteViewportTop => _notesMount.Position.Y;

    public void Initialize(PanelLayout layout, TraceView trace)
    {
        ArgumentNullException.ThrowIfNull(layout);
        ArgumentNullException.ThrowIfNull(trace);
        if (layout.Terminals.Count != 186)
            throw new InvalidOperationException("diagnostics: panel layout must have 186 terminals");
        if (Trace is not null) throw new InvalidOperationException("diagnostics: already initialized");

        Name = "Diagnostics";
        MouseFilter = MouseFilterEnum.Ignore;
        Trace = trace;
        AddChild(Status);
        AddChild(_voltageHeading);
        for (var index = 0; index < layout.Terminals.Count; index++)
        {
            var terminal = layout.Terminals[index];
            var label = new Label
            {
                Name = "TerminalVoltage_" + terminal.Id,
                Text = terminal.Id + ": floating",
                TooltipText = terminal.Id,
            };
            label.SetMeta("terminal", terminal.Id);
            _terminalVoltages.Add(label);
            AddChild(label);
        }
        AddChild(_notesHeading);
        AddChild(_notesMount);
        _notesMount.AddChild(_notesContent);
        AddChild(Trace);
        ApplyLayout();
    }

    /// <summary>FrameLoop render delegate shape.</summary>
    public void Frame(State state) => Render(state);

    public void Render(State state)
    {
        ArgumentNullException.ThrowIfNull(state);
        if (Trace is null) throw new InvalidOperationException("diagnostics: not initialized");
        if (state.terminalMv.Length != _terminalVoltages.Count)
            throw new InvalidOperationException("diagnostics: terminal voltage count does not match the panel");

        for (var index = 0; index < state.terminalMv.Length; index++)
        {
            var millivolts = state.terminalMv[index];
            var terminal = _terminalVoltages[index].GetMeta("terminal").AsString();
            var value = millivolts is null ? "floating" : millivolts + " mV";
            _terminalVoltages[index].Text = terminal + ": " + value;
            _terminalVoltages[index].TooltipText = _terminalVoltages[index].Text;
        }

        var renderedNotes = new List<string>();
        if (state.notes.Length == 0)
        {
            renderedNotes.Add("No steady-state notes.");
        }
        else
        {
            foreach (var note in state.notes) renderedNotes.Add(FormatNote(note));
        }
        if (!NotesMatch(renderedNotes))
        {
            foreach (var note in _notes) note.QueueFree();
            _notes.Clear();
            _renderedNoteText.Clear();
            _renderedNoteText.AddRange(renderedNotes);
            _noteScrollOffset = 0;
            foreach (var note in renderedNotes) AddNote(note);
        }

        Portable = !state.flags.nonPortable;
        Status.SetMeta("portable", Portable);
        StatusTitle = "tick " + state.tick + " · rail " + state.railMv + " mV · supply " + state.supplyUa + " µA";
        Status.TooltipText = StatusTitle;
        ApplyLayout();
    }

    public override void _Notification(int what)
    {
        if (what == NotificationResized) ApplyLayout();
    }

    public void PageTerminals(int direction)
    {
        _terminalPage = Math.Clamp(_terminalPage + Math.Sign(direction), 0, Math.Max(0, TerminalPageCount - 1));
        ApplyLayout();
    }

    public void ScrollNotes(int direction)
    {
        var page = Math.Max(40, _notesMount.Size.Y * 0.8f);
        var maximum = Math.Max(0, _notesContent.Size.Y - _notesMount.Size.Y);
        _noteScrollOffset = Math.Clamp(_noteScrollOffset + Math.Sign(direction) * page, 0, maximum);
        ApplyNoteScroll();
    }

    private void AddNote(string text)
    {
        var label = new RichTextLabel
        {
            Name = "Note_" + _notes.Count,
            Text = text,
            FitContent = false,
            ScrollActive = false,
            MouseFilter = MouseFilterEnum.Ignore,
            TooltipText = text,
        };
        _notes.Add(label);
        _notesContent.AddChild(label);
    }

    private bool NotesMatch(IReadOnlyList<string> notes)
    {
        if (_renderedNoteText.Count != notes.Count) return false;
        for (var index = 0; index < notes.Count; index++)
        {
            if (!string.Equals(_renderedNoteText[index], notes[index], StringComparison.Ordinal)) return false;
        }
        return true;
    }

    private static string FormatNote(Note note) => note switch
    {
        Note.LampInCoilPath lamp => "Relay " + lamp.relay + "'s indicator lamp is in series with its coil and drops " + lamp.lampMv + " mV.",
        Note.CoilStarved coil => "Relay " + coil.relay + " needs " + coil.needsUa + " µA and has " + coil.coilUa +
            " µA. Largest drops: " + FormatDrops(coil.drops) + ".",
        _ => throw new InvalidOperationException("diagnostics: unknown steady-state note " + note.k),
    };

    private static string FormatDrops(IReadOnlyList<Note.Drop> drops)
    {
        if (drops.Count == 0) return "none";
        var text = drops[0].el + " " + drops[0].mv + " mV";
        for (var index = 1; index < drops.Count; index++) text += "; " + drops[index].el + " " + drops[index].mv + " mV";
        return text;
    }

    private void ApplyLayout()
    {
        if (Size.X <= 0 || Size.Y <= 0) return;
        Status.Position = default;
        Status.Size = new(Size.X, 22);
        _voltageHeading.Position = new(0, 26);
        _voltageHeading.Size = new(Size.X, 20);
        const float cellHeight = 16;
        const float traceHeight = 96;
        var noteViewportHeight = Math.Clamp(Size.Y * 0.2f, 80, 120);
        var noteHeights = new float[_notes.Count];
        var noteHeight = 0f;
        for (var index = 0; index < _notes.Count; index++)
        {
            _notes[index].Size = new(Size.X, 1000);
            noteHeights[index] = Math.Max(24, _notes[index].GetContentHeight() + 4);
            noteHeight += noteHeights[index];
        }
        var availableGridHeight = Math.Max(cellHeight, Size.Y - 50 - 24 - noteViewportHeight - traceHeight);
        var maximumRows = Math.Max(1, (int)(availableGridHeight / cellHeight));
        var columns = Math.Max(1, (int)(Size.X / 110));
        _terminalPageSize = Math.Max(1, columns * maximumRows);
        _terminalPage = Math.Clamp(_terminalPage, 0, Math.Max(0, TerminalPageCount - 1));
        var firstTerminal = _terminalPage * _terminalPageSize;
        var visibleCount = Math.Min(_terminalPageSize, _terminalVoltages.Count - firstTerminal);
        var rows = (visibleCount + columns - 1) / columns;
        var cellWidth = Size.X / columns;
        for (var index = 0; index < _terminalVoltages.Count; index++)
        {
            var visibleIndex = index - firstTerminal;
            var visible = visibleIndex >= 0 && visibleIndex < visibleCount;
            _terminalVoltages[index].Visible = visible;
            if (!visible) continue;
            var row = visibleIndex / columns;
            var column = visibleIndex % columns;
            _terminalVoltages[index].Position = new(column * cellWidth, 50 + row * cellHeight);
            _terminalVoltages[index].Size = new(cellWidth, cellHeight);
            _terminalVoltages[index].Set("theme_override_font_sizes/font_size", 10);
        }
        _voltageHeading.Text = "Terminal voltages · page " + (_terminalPage + 1) + "/" + TerminalPageCount;
        var notesY = 54 + rows * cellHeight;
        _notesHeading.Position = new(0, notesY);
        _notesHeading.Size = new(Size.X, 20);
        _notesMount.Position = new(0, notesY + 24);
        _notesMount.Size = new(Size.X, noteViewportHeight);
        var noteY = 0f;
        for (var index = 0; index < _notes.Count; index++)
        {
            _notes[index].Position = new(0, noteY);
            _notes[index].Size = new(Size.X, noteHeights[index]);
            noteY += noteHeights[index];
        }
        _notesContent.Size = new(Size.X, noteHeight);
        ApplyNoteScroll();
        if (Trace is null) return;
        var traceY = _notesMount.Position.Y + _notesMount.Size.Y;
        Trace.Position = new(0, traceY);
        Trace.Size = new(Size.X, Math.Max(64, Size.Y - traceY));
    }

    private void ApplyNoteScroll()
    {
        var maximum = Math.Max(0, _notesContent.Size.Y - _notesMount.Size.Y);
        _noteScrollOffset = Math.Clamp(_noteScrollOffset, 0, maximum);
        _notesContent.Position = new(0, -_noteScrollOffset);
    }
}
