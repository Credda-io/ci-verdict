/**
 * Four red runs, four verdicts. Run it with:
 *
 *   npm run example
 *
 * which builds the package first and then imports the built artifact, so this
 * exercises exactly what a consumer installs.
 *
 * The payloads are hand-written from the field lists GitHub publishes for the
 * `workflow_run` webhook and for a jobs listing, read on 2026-08-25 and cited
 * in `src/attribution.ts`. Nothing here has ever spoken to GitHub.
 *
 * Each case carries the verdict it expects and this file asserts it, so
 * `npm run example` is a gate rather than a printout: a change to a reason, an
 * explanation or the layer that decides fails here, in CI, and not only in the
 * unit suite. The first three cases are also asserted in `test/verdict.test.ts`
 * -- that duplication is deliberate, since it is what keeps the README's worked
 * output and the library's behaviour pinned to each other from both sides.
 */

import assert from 'node:assert/strict';
import { ciVerdict } from '../dist/index.js';

const repository = { full_name: 'acme/widgets', default_branch: 'main' };

const run = (overrides = {}) => ({
  action: 'completed',
  repository,
  workflow_run: {
    id: 10_500_400_300,
    name: 'CI',
    path: '.github/workflows/ci.yml',
    head_branch: 'main',
    head_sha: '3f2a1c9d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39',
    event: 'push',
    status: 'completed',
    conclusion: 'failure',
    html_url: 'https://github.com/acme/widgets/actions/runs/10500400300',
    ...overrides,
  },
});

const jobs = (...entries) => ({ total_count: entries.length, jobs: entries });

const step = (number, name, conclusion) => ({
  name,
  number,
  status: 'completed',
  conclusion,
});

const cases = [
  {
    title: 'A genuine test failure — a vitest assertion on the default branch',
    input: {
      workflowRun: run(),
      jobs: jobs({
        name: 'unit (node 22)',
        conclusion: 'failure',
        steps: [
          step(1, 'Set up job', 'success'),
          step(2, 'Checkout', 'success'),
          step(3, 'Install dependencies', 'success'),
          step(4, 'pnpm test', 'failure'),
        ],
      }),
      log: [
        '2026-08-24T09:21:31.1000000Z ##[group]Run pnpm test',
        '2026-08-24T09:21:41.2000000Z  FAIL  src/total.test.ts > rounds a half up',
        '2026-08-24T09:21:41.2000000Z AssertionError: expected 3 to equal 4',
        '2026-08-24T09:21:41.3000000Z  at Object.<anonymous> (src/total.ts:12:5)',
        '2026-08-24T09:21:44.0000000Z ##[error]Process completed with exit code 1.',
      ].join('\n'),
    },
    expected: { attributable: true },
  },
  {
    title: 'A cancelled run — somebody pressed the button',
    input: {
      workflowRun: run({ conclusion: 'cancelled' }),
      jobs: jobs({ name: 'unit (node 22)', conclusion: 'cancelled', steps: [] }),
    },
    expected: {
      attributable: false,
      reason: 'RUN_CANCELLED',
      explanation:
        'the run was cancelled, which says a person or a policy stopped it and nothing about the code',
      layer: 'documented',
      evidence: 'cancelled',
    },
  },
  {
    title: 'An infrastructure failure — the npm registry answered 503 during install',
    input: {
      workflowRun: run(),
      jobs: jobs({
        name: 'unit (node 22)',
        conclusion: 'failure',
        steps: [
          step(1, 'Set up job', 'success'),
          step(2, 'Checkout', 'success'),
          step(3, 'Install dependencies', 'failure'),
        ],
      }),
      log: [
        '2026-08-24T09:15:02.1000000Z ##[group]Run pnpm install --frozen-lockfile',
        '2026-08-24T09:15:31.4000000Z  WARN  GET https://registry.npmjs.org/left-pad error (503)',
        '2026-08-24T09:15:44.9000000Z ERR_PNPM_FETCH_503  GET https://registry.npmjs.org/left-pad: Service Unavailable',
        '2026-08-24T09:15:45.0000000Z ##[error]Process completed with exit code 1.',
      ].join('\n'),
    },
    expected: {
      attributable: false,
      reason: 'FAILING_STEP_IS_INFRASTRUCTURE',
      explanation:
        'the step that failed sets up the job rather than exercising the code -- a checkout, a toolchain install, a cache or an artifact transfer -- so the break is in the pipeline rather than in the repository',
      layer: 'heuristic',
      evidence: 'Install dependencies',
    },
  },
  {
    title: 'An infrastructure failure — a self-hosted runner died mid-suite, log only',
    input: {
      workflowRun: run(),
      log: [
        '2026-08-24T10:41:02.0000000Z ##[group]Run pnpm test',
        '2026-08-24T10:52:18.7000000Z The self-hosted runner: builder-07 lost communication with the server.',
        '2026-08-24T10:52:18.7000000Z Verify the machine is running and has a healthy network connection.',
      ].join('\n'),
    },
    expected: {
      attributable: false,
      reason: 'INFRASTRUCTURE_IN_LOG',
      explanation:
        'the log of the failing step names a network, registry, runner or credential failure, which is a failure of the infrastructure the tests ran on rather than of the code they tested',
      layer: 'heuristic',
      evidence:
        '2026-08-24T10:52:18.7000000Z The self-hosted runner: builder-07 lost communication with the server.',
    },
  },
];

for (const { title, input, expected } of cases) {
  const verdict = ciVerdict(input);
  console.log(`\n${title}`);
  console.log(`  ${JSON.stringify(verdict, null, 2).split('\n').join('\n  ')}`);
  assert.deepEqual(verdict, expected, title);
}
console.log('');
