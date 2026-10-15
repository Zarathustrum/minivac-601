using Godot;

namespace Minivac.Godot;

public partial class Loop : Node
{
    public FrameLoop? Current;

    public override void _Process(double delta) => Current?.Frame((long)Time.GetTicksUsec());
}
