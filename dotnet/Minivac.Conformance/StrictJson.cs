using System;
using System.Text;
using System.Text.Json;

namespace Minivac.Conformance;

internal static class StrictJson
{
    private static readonly UTF8Encoding FatalUtf8 = new(false, true);

    internal static JsonDocument Read(
        IArtifactSource source,
        string relativePath,
        string where,
        Func<string, Exception>? fail = null) =>
        Read(source.ReadAllBytes(relativePath), where, fail);

    internal static JsonDocument Read(byte[] bytes, string where, Func<string, Exception>? fail = null)
    {
        ArgumentNullException.ThrowIfNull(bytes);
        fail ??= message => new FixtureException(message);
        if (bytes.Length >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf)
            throw fail(where + " has a UTF-8 BOM");
        for (var index = 0; index < bytes.Length; index++)
        {
            if (bytes[index] == 0x0d)
                throw fail(where + " contains CR at byte " + index);
        }

        string text;
        try
        {
            text = FatalUtf8.GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            throw fail(where + " is not valid UTF-8");
        }

        try
        {
            return JsonDocument.Parse(text);
        }
        catch (JsonException)
        {
            throw fail(where + " is not valid JSON");
        }
    }
}
