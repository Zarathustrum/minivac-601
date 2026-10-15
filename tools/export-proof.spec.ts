import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { verifyExport } from './export-proof.ts';

function file(path: string, mode: number): void {
  writeFileSync(path, 'fixture');
  chmodSync(path, mode);
}

it('verifies a Universal 2 app bundle', () => {
  const root = mkdtempSync(join(tmpdir(), 'minivac-export-proof-'));
  const app = join(root, 'Minivac.app');
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(app, 'Contents', 'Resources', 'data_Minivac.Godot_macos_arm64'), { recursive: true });
  mkdirSync(join(app, 'Contents', 'Resources', 'data_Minivac.Godot_macos_x86_64'));
  file(join(app, 'Contents', 'MacOS', 'MINIVAC 601'), 0o755);

  expect(verifyExport('macOS Universal 2', app)).toBe(
    'export proof preset=macOS Universal 2 executable=MINIVAC 601 payloads=data_Minivac.Godot_macos_arm64,data_Minivac.Godot_macos_x86_64 mode=755',
  );
});

it('rejects a macOS bundle missing one architecture payload', () => {
  const root = mkdtempSync(join(tmpdir(), 'minivac-export-proof-'));
  const app = join(root, 'Minivac.app');
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(app, 'Contents', 'Resources', 'data_Minivac.Godot_macos_arm64'), { recursive: true });
  file(join(app, 'Contents', 'MacOS', 'MINIVAC 601'), 0o755);

  expect(() => verifyExport('macOS Universal 2', app)).toThrow(/expected arm64 and x86_64 macOS payloads/);
});

it('keeps Linux executable-mode enforcement', () => {
  const root = mkdtempSync(join(tmpdir(), 'minivac-export-proof-'));
  const output = join(root, 'Minivac.x86_64');
  file(output, 0o644);
  mkdirSync(join(root, 'data_Minivac.Godot_linuxbsd_x86_64'));

  expect(() => verifyExport('Linux', output)).toThrow(/exported binary has no executable mode bit/);
});

it('keeps Windows non-executable output valid when its console wrapper is present', () => {
  const root = mkdtempSync(join(tmpdir(), 'minivac-export-proof-'));
  const output = join(root, 'Minivac.exe');
  file(output, 0o644);
  file(join(root, 'Minivac.console.exe'), 0o644);
  mkdirSync(join(root, 'data_Minivac.Godot_windows_x86_64'));

  expect(verifyExport('Windows Desktop', output)).toBe(
    'export proof preset=Windows Desktop payload=data_Minivac.Godot_windows_x86_64 mode=644',
  );
});

it('rejects a Windows export without its console wrapper', () => {
  const root = mkdtempSync(join(tmpdir(), 'minivac-export-proof-'));
  const output = join(root, 'Minivac.exe');
  file(output, 0o644);
  mkdirSync(join(root, 'data_Minivac.Godot_windows_x86_64'));

  expect(() => verifyExport('Windows Desktop', output)).toThrow(
    /expected exactly one Windows console wrapper named Minivac\.console\.exe/,
  );
});

it('rejects extra or incorrectly named Windows console wrappers', () => {
  const root = mkdtempSync(join(tmpdir(), 'minivac-export-proof-'));
  const output = join(root, 'Minivac.exe');
  file(output, 0o644);
  file(join(root, 'Minivac.console.exe'), 0o644);
  file(join(root, 'Other.console.exe'), 0o644);
  mkdirSync(join(root, 'data_Minivac.Godot_windows_x86_64'));

  expect(() => verifyExport('Windows Desktop', output)).toThrow(/expected exactly one Windows console wrapper/);
});

it('rejects a Windows export beside a Linux payload', () => {
  const root = mkdtempSync(join(tmpdir(), 'minivac-export-proof-'));
  const output = join(root, 'Minivac.exe');
  file(output, 0o644);
  file(join(root, 'Minivac.console.exe'), 0o644);
  mkdirSync(join(root, 'data_Minivac.Godot_linuxbsd_x86_64'));

  expect(() => verifyExport('Windows Desktop', output)).toThrow(/payload does not match Windows Desktop/);
});

it('rejects a Linux export beside a Windows payload', () => {
  const root = mkdtempSync(join(tmpdir(), 'minivac-export-proof-'));
  const output = join(root, 'Minivac.x86_64');
  file(output, 0o755);
  mkdirSync(join(root, 'data_Minivac.Godot_windows_x86_64'));

  expect(() => verifyExport('Linux', output)).toThrow(/payload does not match Linux/);
});

it.each(['Linux', 'Windows Desktop'])('rejects a directory output for the %s preset', (preset) => {
  const root = mkdtempSync(join(tmpdir(), 'minivac-export-proof-'));
  const output = join(root, preset === 'Linux' ? 'Minivac.x86_64' : 'Minivac.exe');
  mkdirSync(output);
  mkdirSync(join(root, preset === 'Linux' ? 'data_Minivac.Godot_linuxbsd_x86_64' : 'data_Minivac.Godot_windows_x86_64'));

  expect(() => verifyExport(preset, output)).toThrow(/exported binary is not a file/);
});
