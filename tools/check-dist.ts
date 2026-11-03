// The public build carries nothing of the dev-only chat pane (DECISIONS, 2026-11-02, "Public copy"):
// dist/ holds no dev.html, and no file in it names the pane's environment (MINIVAC_LLM), its
// server (hands-pane) or its source (src/pane). `npm run build` runs it after `vite build`
// (package.json postbuild).
//
// Usage: node tools/check-dist.ts [<dist dir>]   exit 1 on any finding

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO = resolve(new URL('..', import.meta.url).pathname);
const PANE_STRINGS = ['MINIVAC_LLM', 'hands-pane', 'src/pane'];

/** Every finding, sorted by path: `dist/<path> is in the build` or `dist/<path> names <string>`. */
export function distProblems(dir: string): string[] {
  const problems: string[] = [];
  const walk = (path: string): void => {
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path)) walk(join(path, entry));
      return;
    }
    const shown = 'dist/' + relative(dir, path);
    if (relative(dir, path) === 'dev.html') problems.push(shown + ' is in the build');
    const bytes = readFileSync(path);
    for (const text of PANE_STRINGS) if (bytes.includes(text)) problems.push(shown + ' names ' + text);
  };
  walk(dir);
  return problems.sort();
}

if (import.meta.main) {
  const dir = resolve(process.argv[2] ?? join(REPO, 'dist'));
  const problems = distProblems(dir);
  for (const problem of problems) process.stderr.write('check-dist: ' + problem + '\n');
  if (problems.length > 0) process.exitCode = 1;
  else process.stdout.write('check-dist: ' + relative(REPO, dir) + ' holds nothing of the chat pane\n');
}
