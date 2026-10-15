using System;
using System.Globalization;

namespace Minivac.Core;

public sealed class PortFlags
{
    public bool nonPortable { get; set; }
}

public static class Ints
{
    private const double Int32Max = 2147483647.0;
    private const double Int32Min = -2147483648.0;
    private const ulong FnvOffsetBasis = 0xcbf29ce484222325UL;
    private const ulong FnvPrime = 0x100000001b3UL;

    public static double roundHalfEven(double x)
    {
        var floor = Math.Floor(x);
        var difference = x - floor;
        if (difference > 0.5) return floor + 1.0;
        var result = difference < 0.5 ? floor : floor % 2.0 == 0.0 ? floor : floor + 1.0;
        return result == 0.0 ? 0.0 : result;
    }

    public static int quantize(double x, double scale, PortFlags flags)
    {
        var scaled = x * scale;
        if (double.IsNaN(scaled) || double.IsPositiveInfinity(scaled) || double.IsNegativeInfinity(scaled))
        {
            flags.nonPortable = true;
            return 0;
        }

        var rounded = roundHalfEven(scaled);
        if (rounded > Int32Max)
        {
            flags.nonPortable = true;
            return int.MaxValue;
        }
        if (rounded < Int32Min)
        {
            flags.nonPortable = true;
            return int.MinValue;
        }

        return (int)rounded;
    }

    public static long idiv(long a, long b) => a / b;

    public static long idivRound(long a, long b)
    {
        var quotient = idiv(a, b);
        var remainder = a - quotient * b;
        if (iabs(remainder) * 2 >= iabs(b))
            return quotient + ((a < 0) != (b < 0) ? -1 : 1);
        return quotient;
    }

    public static long mod(long a, long b)
    {
        var result = a % b;
        return result < 0 ? result + b : result;
    }

    public static long iabs(long a) => a < 0 ? -a : a;

    public static string fnv1a64(byte[] bytes)
    {
        unchecked
        {
            var hash = FnvOffsetBasis;
            for (var i = 0; i < bytes.Length; i++)
            {
                hash ^= bytes[i];
                hash *= FnvPrime;
            }
            return hash.ToString("x16", CultureInfo.InvariantCulture);
        }
    }
}
