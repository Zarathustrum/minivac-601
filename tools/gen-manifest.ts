/**
 * `tools/gen-manifest.ts` — rewrite `test/conformance/fixtures/manifest.json` from the fixtures on
 * disk (docs/plans/phase-5-corpus.md, Step 1a).
 *
 *   npm run gen-manifest
 *
 * Run it after adding, editing or retagging a fixture, and read the diff: a suite flip or a new path
 * there is a deliberate change, never a side effect. `suites.spec.ts` fails until the two agree.
 */
import { writeFileSync } from 'node:fs';
import { MANIFEST_PATH, buildManifest, serializeManifest } from '../test/conformance/manifest.ts';

const entries = buildManifest();
writeFileSync(MANIFEST_PATH, serializeManifest(entries));
const printed = entries.filter((entry) => entry.suite === 'printed').length;
process.stdout.write(
  'gen-manifest: ' + entries.length + ' fixtures (' + printed + ' printed, ' +
  (entries.length - printed) + ' speculative)\n',
);
