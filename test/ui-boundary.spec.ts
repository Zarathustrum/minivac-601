import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { CONTRACT } from '../src/core/contract.ts';

const UI = new URL('../src/ui/', import.meta.url);

function imports(source: string): string[] {
  const found: string[] = [];
  const file = ts.createSourceFile('boundary.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (node.arguments.length !== 1 || argument === undefined) {
        throw new Error('boundary: dynamic import target must be a static literal');
      }
      if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
        found.push(argument.text);
      } else {
        throw new Error('boundary: dynamic import target must be a static literal');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

describe('Wave 7 adapter boundary and frozen versions', () => {
  it('sees static, side-effect, dynamic imports and re-exports', () => {
    expect(imports(
      "import type { A } from './static.ts';\n" +
      "import './effect.ts';\n" +
      "void import('./dynamic.ts');\n" +
      "void import(\`./template.ts\`);\n" +
      "export { B } from './exported.ts';\n",
    )).toEqual(['./static.ts', './effect.ts', './dynamic.ts', './template.ts', './exported.ts']);
    expect(() => imports("void import('./' + 'joined.ts');"))
      .toThrow('boundary: dynamic import target must be a static literal');
  });

  it('keeps src/ui on contract and trace only, with no test or loader import', () => {
    const allowedCore = new Set(['../core/contract.ts', '../core/trace.ts']);
    const coreImports = new Set<string>();
    for (const name of readdirSync(UI).filter((entry) => entry.endsWith('.ts')).sort()) {
      const source = readFileSync(new URL(name, UI), 'utf8');
      for (const target of imports(source)) {
        expect(target.startsWith('./') || allowedCore.has(target), name + ': ' + target).toBe(true);
        if (target.startsWith('../core/')) coreImports.add(target);
        expect(target.includes('/test/') || target.includes('conformance')).toBe(false);
        expect(target).not.toMatch(/(?:netlist|profile)\.ts$/u);
      }
      expect(source).not.toMatch(/\b(?:AudioContext|moveEnd|session)\b/u);
    }
    expect([...coreImports].sort()).toEqual([...allowedCore].sort());
  });

  it('keeps the composition root on the exact ruled loaders, factory, data and inspector', () => {
    const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(imports(source).sort()).toEqual([
      '../data/demo-library.json',
      '../data/netlist.json?raw',
      '../data/profiles/MV601-IDEAL.json',
      '../data/profiles/MV601-REF-A.json',
      '../data/public-assets.json',
      './core/machine.ts',
      './core/netlist.ts',
      './core/profile.ts',
      './demo-library.ts',
      './session.ts',
      './ui/audio-router.ts',
      './ui/demo-experience.ts',
      './ui/help-credits.ts',
      './ui/inspector.ts',
      './web-audio.ts',
    ]);
    expect(source).toContain("window.addEventListener('pagehide', (event) => {");
    expect(source).toContain('if (!event.persisted) {');
    expect(source).toContain('help.dispose();');
    expect(source).toContain('audio.dispose();');
    expect(source).not.toContain("window.addEventListener('pagehide', () => audio.dispose(), { once: true });");
    expect(source).toContain("const MANUAL_SESSION = Object.freeze({ id: 'MANUAL', commands: Object.freeze([]) });");
    expect(source).toContain('startWithFreeCord: !manual,');
  });

  it('binds the inspector to PanelView identities without legacy terminal-order grouping', () => {
    const source = readFileSync(new URL('../src/ui/inspector.ts', import.meta.url), 'utf8');
    expect(imports(source)).toContain('./panel-view.ts');
    expect(source).toContain('createPeriodPanel(document, netlist)');
    expect(source).toContain('panelSection(button.dataset.section)');
    expect(source).toContain('panelSection(slide.dataset.section)');
    expect(source).toContain('panelSection(relay.dataset.section)');
    expect(source).not.toMatch(/\b(?:GROUP_LABELS|groupIndex|groupTerminals)\b/u);
  });

  it('does not bump the core contract, fixture schema or trace format', () => {
    const schema = JSON.parse(readFileSync(
      new URL('./conformance/fixture.schema.json', import.meta.url),
      'utf8',
    )) as { $id: string; properties: { contract: { const: string } } };
    const golden = readFileSync(
      new URL('./conformance/golden/A/MM-RLY-CHECK.trace', import.meta.url),
      'utf8',
    );
    expect(CONTRACT).toBe('1.1.0');
    expect(schema.$id).toBe('minivac.fixture/1');
    expect(schema.properties.contract.const).toBe('1.1.0');
    expect(golden.startsWith('#!mv601-trace 1\n')).toBe(true);
  });
});
