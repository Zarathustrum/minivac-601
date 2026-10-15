using Godot;

namespace Minivac.Godot;

public partial class Preferences : Node
{
    internal const string DefaultPath = "user://minivac.cfg";
    private readonly ConfigFile _file = new();
    private string _path = DefaultPath;

    public bool AudioMuted { get; private set; }
    public bool HelpSeen { get; private set; }
    public bool ReduceMotion { get; private set; }
    public string ViewMode { get; private set; } = "3d";

    internal string StoragePath => _path;

    public void Load(string path = DefaultPath)
    {
        _path = path;
        if ((int)_file.Load(_path) != 0) return;
        AudioMuted = (bool)_file.GetValue("audio", "muted", false);
        HelpSeen = (bool)_file.GetValue("help", "seen", false);
        ReduceMotion = (bool)_file.GetValue("motion", "reduce", false);
        var mode = (string)_file.GetValue("view", "mode", "3d");
        ViewMode = mode == "3d" ? "3d" : "flat";
    }

    public void SetAudioMuted(bool value)
    {
        AudioMuted = value;
        SaveBool("audio", "muted", value);
    }

    public void SetHelpSeen(bool value)
    {
        HelpSeen = value;
        SaveBool("help", "seen", value);
    }

    public void SetReduceMotion(bool value)
    {
        ReduceMotion = value;
        SaveBool("motion", "reduce", value);
    }

    public void SetViewMode(string value)
    {
        ViewMode = value == "3d" ? "3d" : "flat";
        SaveString("view", "mode", ViewMode);
    }

    internal void Reload()
    {
        AudioMuted = false;
        HelpSeen = false;
        ReduceMotion = false;
        ViewMode = "3d";
        _file.Clear();
        Load(_path);
    }

    private void SaveBool(string section, string key, bool value)
    {
        _file.SetValue(section, key, value);
        _ = _file.Save(_path);
    }

    private void SaveString(string section, string key, string value)
    {
        _file.SetValue(section, key, value);
        _ = _file.Save(_path);
    }
}
