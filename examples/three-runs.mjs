/**
 * Four red runs, four verdicts. Run it with:
 *
 *   npm run example
 *
 * which builds the package first and then imports the built artifact, so this
 * exercises exactly what a consumer installs -- the one check in this
 * repository that the published entry point resolves at all.
 *
 * The cases are in `examples/cases.mjs`, which imports nothing, so the same
 * four payloads are also read by `test/readme.test.ts` against `src/`. Each
 * case carries the verdict it expects and this file asserts it, so
 * `npm run example` is a gate rather than a printout: a change to a reason, an
 * explanation or the layer that decides fails here, in CI, and not only in the
 * unit suite.
 *
 * What this file prints is what the README quotes, and `test/readme.test.ts`
 * renders the same block and requires the README to contain it.
 */

import assert from 'node:assert/strict';
import { ciVerdict } from '../dist/index.js';
import { cases } from './cases.mjs';

for (const { title, input, expected } of cases) {
  const verdict = ciVerdict(input);
  console.log(`\n${title}`);
  console.log(`  ${JSON.stringify(verdict, null, 2).split('\n').join('\n  ')}`);
  assert.deepEqual(verdict, expected, title);
}
console.log('');
