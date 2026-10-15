using System;
using System.Text;
using Xunit;

namespace Minivac.Core.Tests;

public sealed class IntsTests
{
    [Fact]
    public void roundHalfEven_takes_the_even_neighbor_for_both_signs()
    {
        Assert.Equal(0.0, Ints.roundHalfEven(0.5));
        Assert.Equal(2.0, Ints.roundHalfEven(1.5));
        Assert.Equal(2.0, Ints.roundHalfEven(2.5));
        Assert.Equal(4.0, Ints.roundHalfEven(3.5));
        Assert.Equal(0.0, Ints.roundHalfEven(-0.5));
        Assert.Equal(-2.0, Ints.roundHalfEven(-1.5));
        Assert.Equal(-2.0, Ints.roundHalfEven(-2.5));
        Assert.Equal(-4.0, Ints.roundHalfEven(-3.5));
        Assert.Equal(0L, BitConverter.DoubleToInt64Bits(Ints.roundHalfEven(-0.0)));
    }

    [Fact]
    public void quantize_scales_rounds_clamps_and_marks_nonportable_results()
    {
        var ordinary = new PortFlags();
        Assert.Equal(86, Ints.quantize(0.0865, 1000, ordinary));
        Assert.Equal(88, Ints.quantize(0.0875, 1000, ordinary));
        Assert.False(ordinary.nonPortable);

        foreach (var value in new[] { double.NaN, double.PositiveInfinity, double.NegativeInfinity })
        {
            var flags = new PortFlags();
            Assert.Equal(0, Ints.quantize(value, 1000, flags));
            Assert.True(flags.nonPortable);
        }

        var high = new PortFlags();
        Assert.Equal(int.MaxValue, Ints.quantize(3e9, 1, high));
        Assert.True(high.nonPortable);
        var low = new PortFlags();
        Assert.Equal(int.MinValue, Ints.quantize(-3e9, 1, low));
        Assert.True(low.nonPortable);
    }

    [Theory]
    [InlineData(7, 2, 3)]
    [InlineData(-7, 2, -3)]
    [InlineData(7, -2, -3)]
    [InlineData(-7, -2, 3)]
    [InlineData(-1, 3, 0)]
    public void idiv_truncates_toward_zero(long a, long b, long expected) =>
        Assert.Equal(expected, Ints.idiv(a, b));

    [Theory]
    [InlineData(5, 2, 3)]
    [InlineData(-5, 2, -3)]
    [InlineData(5, -2, -3)]
    [InlineData(-5, -2, 3)]
    [InlineData(1, 3, 0)]
    [InlineData(-2, 3, -1)]
    public void idivRound_rounds_halves_away_from_zero(long a, long b, long expected) =>
        Assert.Equal(expected, Ints.idivRound(a, b));

    [Fact]
    public void mod_and_iabs_match_the_integer_contract()
    {
        Assert.Equal(1, Ints.mod(7, 3));
        Assert.Equal(2, Ints.mod(-7, 3));
        Assert.Equal(359, Ints.mod(-1, 360));
        Assert.Equal(2_147_483_648, Ints.iabs(-2_147_483_648));
    }

    [Theory]
    [InlineData("", "cbf29ce484222325")]
    [InlineData("a", "af63dc4c8601ec8c")]
    [InlineData("foobar", "85944171f73967e8")]
    [InlineData("minivac.solver-kat/1", "116d570d8ebdf1dc")]
    public void fnv1a64_matches_standard_and_project_vectors(string text, string expected) =>
        Assert.Equal(expected, Ints.fnv1a64(Encoding.ASCII.GetBytes(text)));
}
