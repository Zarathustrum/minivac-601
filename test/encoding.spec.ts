/**
 * Determinism rule 17, made a check instead of a hope.
 *
 * Rule 17: "Files are UTF-8, no BOM, LF — all of `data/**` and `test/conformance/**`.
 * `.gitattributes` carries `* -text`; **a repo check fails on any `\r` or BOM in a tracked data or
 * golden file.**" The repo shipped the `.gitattributes` half and not the check. `* -text` only
 * stops git from rewriting line endings on checkout; it does nothing about a file that was
 * *authored* with CRLF or with a BOM, and a C# writer that forgets `new UTF8Encoding(false)` emits
 * exactly that. This is the missing half.
 *
 * `test/conformance/**` does not exist until Phase 1 Wave 3, so the walk covers `data/**` and
 * `test/**` — the two trees that exist and that carry bytes a port has to reproduce.
 *
 * Read as BYTES, never as strings. `readFileSync(path, 'utf8')` would silently strip a BOM and
 * hand back a string in which the offending bytes are invisible, so the check would pass on
 * precisely the files it exists to catch.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const CR = 0x0d;
const LF = 0x0a;
const BOM = [0xef, 0xbb, 0xbf];

/** Every file under `dir`, depth first, in `readdirSync`'s sorted order. Paths are repo-relative. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) out.push(...walk(rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

const FILES = [...walk('data'), ...walk('test'), ...walk('godot/data'), ...walk('godot/conformance')];

describe('determinism rule 17 — UTF-8, no BOM, LF, one trailing newline', () => {
  it('finds files to check at all', () => {
    // Without this the three checks below pass vacuously if the walk ever breaks.
    expect(FILES.length).toBeGreaterThan(5);
    expect(FILES).toContain('data/kat/solver-kat.json');
  });

  for (const rel of FILES) {
    it(rel, () => {
      const bytes = readFileSync(join(ROOT, rel));

      expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes), `${rel} is not valid UTF-8`).not.toThrow();

      // No BOM. UTF-8 needs no byte order mark and rule 17 forbids one; .NET's default
      // `UTF8Encoding` emits it, which is why the rule names `new UTF8Encoding(false)`.
      const bom = bytes.length >= 3 && bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2];
      expect(bom, `${rel} starts with a UTF-8 BOM`).toBe(false);

      // No CR anywhere — not just no CRLF. A bare CR is the worse case: it survives a naive
      // `\r\n` -> `\n` normalisation and changes an FNV-1a hash over the file bytes.
      const cr = bytes.indexOf(CR);
      expect(cr, `${rel} contains a \\r at byte ${cr}`).toBe(-1);

      // Exactly one trailing newline: the last byte is LF and the one before it is not.
      expect(bytes.length, `${rel} is empty`).toBeGreaterThan(0);
      expect(bytes[bytes.length - 1], `${rel} does not end with a newline`).toBe(LF);
      expect(bytes[bytes.length - 2], `${rel} ends with a blank line`).not.toBe(LF);
    });
  }
});
