/**
 * `ciVerdict()` end to end, on payloads shaped like the real thing.
 *
 * The three scenarios at the bottom -- a genuine test failure, a cancelled run,
 * and an infrastructure failure -- are the ones the README shows. They are
 * asserted here so the README cannot drift away from what the code does.
 *
 * The bodies are hand-written from the field lists GitHub publishes, read on
 * 2026-08-25 and cited in `src/attribution.ts`. Nothing here has ever spoken to
 * GitHub and no credential appears in this repository.
 */

import { describe, expect, it } from 'vitest';
import { ciVerdict } from '../src/verdict.js';
import { CI_NOT_A_DEFECT_REASONS, MAX_LOG_SCAN_BYTES } from '../src/attribution.js';
import type { CiAttribution } from '../src/attribution.js';

function delivery(
  run: Record<string, unknown> = {},
  repository: Record<string, unknown> = {},
  action = 'completed',
): unknown {
  return {
    action,
    repository: { full_name: 'acme/widgets', default_branch: 'main', ...repository },
    workflow_run: {
      id: 10_500_400_300,
      name: 'CI',
      path: '.github/workflows/ci.yml',
      head_branch: 'main',
      head_sha: '3f2a1c9d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39',
      event: 'push',
      status: 'completed',
      conclusion: 'failure',
      run_attempt: 1,
      html_url: 'https://github.com/acme/widgets/actions/runs/10500400300',
      ...run,
    },
  };
}

function jobs(...entries: readonly Record<string, unknown>[]): unknown {
  return { total_count: entries.length, jobs: entries };
}

function reasonOf(verdict: CiAttribution): string | null {
  return verdict.attributable ? null : verdict.reason;
}

describe('ciVerdict', () => {
  it('attributes a failed push run on the default branch from the delivery alone', () => {
    expect(ciVerdict({ workflowRun: delivery() })).toEqual({ attributable: true });
  });

  it('answers from the run alone when no jobs and no log were supplied', () => {
    // A weaker verdict, not a different one: it can still say no.
    expect(reasonOf(ciVerdict({ workflowRun: delivery({ conclusion: 'cancelled' }) }))).toBe(
      'RUN_CANCELLED',
    );
  });

  it('stops at the first layer that rejects, so the reason is the most specific one', () => {
    // The run is cancelled AND its jobs are all cancelled AND its log names a
    // dead runner. The run-level fact is the one that decides it.
    const verdict = ciVerdict({
      workflowRun: delivery({ conclusion: 'cancelled' }),
      jobs: jobs({ name: 'unit', conclusion: 'cancelled', steps: [] }),
      log: 'The runner has received a shutdown signal',
    });
    expect(reasonOf(verdict)).toBe('RUN_CANCELLED');
  });

  it('applies the job layer only when jobs were supplied', () => {
    const noFailingJob = jobs({ name: 'unit', conclusion: 'cancelled', steps: [] });
    expect(reasonOf(ciVerdict({ workflowRun: delivery(), jobs: noFailingJob }))).toBe(
      'JOB_CANCELLED',
    );
    expect(ciVerdict({ workflowRun: delivery() }).attributable).toBe(true);
  });

  it('rejects on the failing step name, which is layer 2', () => {
    const verdict = ciVerdict({
      workflowRun: delivery(),
      jobs: jobs({
        name: 'unit',
        conclusion: 'failure',
        steps: [
          { name: 'Set up job', number: 1, status: 'completed', conclusion: 'success' },
          { name: 'Install dependencies', number: 2, status: 'completed', conclusion: 'failure' },
        ],
      }),
    });
    expect(reasonOf(verdict)).toBe('FAILING_STEP_IS_INFRASTRUCTURE');
  });

  it('rejects on the log when the step name gave nothing away', () => {
    const verdict = ciVerdict({
      workflowRun: delivery(),
      jobs: jobs({
        name: 'unit',
        conclusion: 'failure',
        steps: [{ name: 'pnpm test', number: 2, status: 'completed', conclusion: 'failure' }],
      }),
      log: 'Error: getaddrinfo EAI_AGAIN registry.npmjs.org',
    });
    expect(reasonOf(verdict)).toBe('INFRASTRUCTURE_IN_LOG');
  });

  it('takes the tail of an oversized log rather than making the caller remember to', () => {
    const log = `${'x'.repeat(MAX_LOG_SCAN_BYTES)}\nThe runner has received a shutdown signal`;
    expect(reasonOf(ciVerdict({ workflowRun: delivery(), log }))).toBe('INFRASTRUCTURE_IN_LOG');
  });

  it('never throws, whatever arrives', () => {
    const shapes: unknown[] = [null, undefined, 'nope', 42, [], { action: 'completed' }];
    for (const workflowRun of shapes) {
      expect(() => ciVerdict({ workflowRun, jobs: workflowRun, log: '' })).not.toThrow();
      expect(ciVerdict({ workflowRun }).attributable).toBe(false);
    }
  });

  it('only ever emits a published reason code', () => {
    const verdicts = [
      ciVerdict({ workflowRun: delivery({}, {}, 'requested') }),
      ciVerdict({ workflowRun: delivery({ conclusion: 'timed_out' }) }),
      ciVerdict({ workflowRun: delivery({ head_branch: 'topic' }) }),
      ciVerdict({ workflowRun: delivery(), jobs: jobs() }),
      ciVerdict({ workflowRun: delivery(), log: 'read ECONNRESET' }),
    ];
    for (const verdict of verdicts) {
      expect(verdict.attributable).toBe(false);
      expect(CI_NOT_A_DEFECT_REASONS).toContain(reasonOf(verdict));
    }
  });
});

/**
 * The three worked examples.
 *
 * `examples/three-runs.ts` prints exactly these and nothing else, so what the
 * README shows is what these assertions pin.
 */
describe('worked examples', () => {
  it('1. a genuine test failure is attributable', () => {
    const verdict = ciVerdict({
      workflowRun: delivery({ name: 'CI', conclusion: 'failure', event: 'push' }),
      jobs: jobs({
        name: 'unit (node 22)',
        conclusion: 'failure',
        steps: [
          { name: 'Set up job', number: 1, status: 'completed', conclusion: 'success' },
          { name: 'Checkout', number: 2, status: 'completed', conclusion: 'success' },
          { name: 'Install dependencies', number: 3, status: 'completed', conclusion: 'success' },
          { name: 'pnpm test', number: 4, status: 'completed', conclusion: 'failure' },
        ],
      }),
      log: [
        '2026-08-24T09:21:31.1000000Z ##[group]Run pnpm test',
        '2026-08-24T09:21:41.2000000Z  FAIL  src/total.test.ts > rounds a half up',
        '2026-08-24T09:21:41.2000000Z AssertionError: expected 3 to equal 4',
        '2026-08-24T09:21:41.3000000Z  at Object.<anonymous> (src/total.ts:12:5)',
        '2026-08-24T09:21:44.0000000Z ##[error]Process completed with exit code 1.',
      ].join('\n'),
    });
    expect(verdict).toEqual({ attributable: true });
  });

  it('2. a cancelled run is refused by layer 1, on a documented enum', () => {
    const verdict = ciVerdict({
      workflowRun: delivery({ conclusion: 'cancelled' }),
      jobs: jobs({ name: 'unit (node 22)', conclusion: 'cancelled', steps: [] }),
    });
    expect(verdict).toEqual({
      attributable: false,
      reason: 'RUN_CANCELLED',
      explanation:
        'the run was cancelled, which says a person or a policy stopped it and nothing about the code',
      layer: 'documented',
      evidence: 'cancelled',
    });
  });

  it('3. a registry 5xx during install is refused by layer 2, twice over', () => {
    const infrastructure = {
      workflowRun: delivery(),
      jobs: jobs({
        name: 'unit (node 22)',
        conclusion: 'failure',
        steps: [
          { name: 'Set up job', number: 1, status: 'completed', conclusion: 'success' },
          { name: 'Checkout', number: 2, status: 'completed', conclusion: 'success' },
          { name: 'Install dependencies', number: 3, status: 'completed', conclusion: 'failure' },
        ],
      }),
      log: [
        '2026-08-24T09:15:02.1000000Z ##[group]Run pnpm install --frozen-lockfile',
        '2026-08-24T09:15:31.4000000Z  WARN  GET https://registry.npmjs.org/left-pad error (503)',
        '2026-08-24T09:15:44.9000000Z ERR_PNPM_FETCH_503  GET https://registry.npmjs.org/left-pad: Service Unavailable',
        '2026-08-24T09:15:45.0000000Z ##[error]Process completed with exit code 1.',
      ].join('\n'),
    };

    // The step name decides it first, because the step layer runs before the log
    // layer and a name is cheaper to read than a log.
    expect(ciVerdict(infrastructure)).toEqual({
      attributable: false,
      reason: 'FAILING_STEP_IS_INFRASTRUCTURE',
      explanation:
        'the step that failed sets up the job rather than exercising the code -- a checkout, a toolchain install, a cache or an artifact transfer -- so the break is in the pipeline rather than in the repository',
      layer: 'heuristic',
      evidence: 'Install dependencies',
    });

    // And the log alone would have caught it too, which is the point of having
    // both: a caller who only has the log still gets the right answer.
    expect(reasonOf(ciVerdict({ workflowRun: infrastructure.workflowRun, log: infrastructure.log }))).toBe(
      'INFRASTRUCTURE_IN_LOG',
    );
  });

  it('4. a dead runner is refused from the log, with no jobs fetched at all', () => {
    const verdict = ciVerdict({
      workflowRun: delivery(),
      log: [
        '2026-08-24T10:41:02.0000000Z ##[group]Run pnpm test',
        '2026-08-24T10:52:18.7000000Z The self-hosted runner: builder-07 lost communication with the server.',
        '2026-08-24T10:52:18.7000000Z Verify the machine is running and has a healthy network connection.',
      ].join('\n'),
    });
    expect(verdict).toEqual({
      attributable: false,
      reason: 'INFRASTRUCTURE_IN_LOG',
      explanation:
        'the log of the failing step names a network, registry, runner or credential failure, which is a failure of the infrastructure the tests ran on rather than of the code they tested',
      layer: 'heuristic',
      evidence:
        '2026-08-24T10:52:18.7000000Z The self-hosted runner: builder-07 lost communication with the server.',
    });
  });
});
