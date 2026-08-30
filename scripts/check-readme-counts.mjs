/**
 * The two test counts the README publishes, against the tests on disk.
 *
 * "**204 tests**, 143 of them on the classifier itself" is the first thing a
 * reader is asked to believe about this repository, and nothing checked it.
 * Every other README claim here is pinned to the code -- the worked output is
 * rendered from the same cases the example runs, the pattern audits are named
 * by list, the reason codes are compared with the exported union -- and these
 * two numbers were the pair still resting on whoever last edited them. They
 * drifted the day a test was added.
 *
 * A test cannot count its own suite, so this is a script and a CI step, the
 * same shape the sibling `toolshed` repository uses for the same reason.
 *
 * The counts come from `vitest list`, which COLLECTS without running, so a
 * `.skip`ped test is absent from the list -- which is the point: skipping is
 * how a published count falls while the suite still exits 0.
 *
 * Exits non-zero on any mismatch, and prints every one rather than the first.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const problems = [];

const listed = JSON.parse(
  execFileSync('npx', ['vitest', 'list', '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 32 * 1024 * 1024,
  }),
);
if (!Array.isArray(listed) || listed.length === 0) {
  console.error('vitest listed no tests at all, so this script checked nothing');
  process.exit(1);
}

const total = listed.length;
const classifier = listed.filter((test) => test.file.endsWith('/test/attribution.test.ts')).length;
if (classifier === 0) problems.push('no tests were collected from test/attribution.test.ts');

const claimed = /\*\*(\d+) tests\*\*, (\d+) of them on the classifier itself/.exec(readme);
if (claimed === null) {
  problems.push('README.md no longer publishes "**N tests**, M of them on the classifier itself"');
} else {
  if (Number(claimed[1]) !== total) problems.push(`the suite has ${total} tests; README.md says ${claimed[1]}`);
  if (Number(claimed[2]) !== classifier) {
    problems.push(`test/attribution.test.ts has ${classifier} tests; README.md says ${claimed[2]}`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::README.md is out of date: ${problem}`);
  process.exit(1);
}
console.log(`README.md publishes the suite it has: ${total} tests, ${classifier} of them the classifier's.`);
