/**
 * The line between a defect in the repository and a broken pipeline.
 *
 * Every enum value asserted here (`cancelled`, `timed_out`, `stale`,
 * `action_required`, `neutral`, `skipped`) was read from GitHub's REST
 * documentation for workflow runs and workflow jobs on 2026-08-25. The log
 * excerpts are hand-written and are labelled in the module under test as
 * heuristics with no documentary basis.
 *
 * Nothing here has ever spoken to GitHub and no credential appears in this
 * repository.
 */

import { describe, expect, it } from 'vitest';
import {
  CI_NOT_A_DEFECT_REASONS,
  classifyFailingStep,
  classifyFailureLog,
  classifyJobOutcome,
  classifyWorkflowRun,
  findFailedJob,
  findFailedStep,
  logTail,
  MAX_LOG_SCAN_BYTES,
} from '../src/attribution.js';
import type { JobFacts, WorkflowRunFacts } from '../src/attribution.js';

const MAINLINE: WorkflowRunFacts = {
  action: 'completed',
  status: 'completed',
  conclusion: 'failure',
  triggeringEvent: 'push',
  headBranch: 'main',
  defaultBranch: 'main',
  repositoryFullName: 'acme/widgets',
  workflowPath: '.github/workflows/ci.yml',
};

function run(overrides: Partial<WorkflowRunFacts> = {}): WorkflowRunFacts {
  return { ...MAINLINE, ...overrides };
}

function reasonOf(facts: WorkflowRunFacts): string | null {
  const verdict = classifyWorkflowRun(facts);
  return verdict.attributable ? null : verdict.reason;
}

describe('classifyWorkflowRun', () => {
  it('attributes a failed push run on the default branch', () => {
    expect(classifyWorkflowRun(run())).toEqual({ attributable: true });
  });

  it('accepts a schedule and a manual dispatch on the default branch', () => {
    expect(reasonOf(run({ triggeringEvent: 'schedule' }))).toBeNull();
    expect(reasonOf(run({ triggeringEvent: 'workflow_dispatch' }))).toBeNull();
  });

  it('refuses a run that has not completed', () => {
    expect(reasonOf(run({ action: 'in_progress' }))).toBe('RUN_NOT_COMPLETED');
    expect(reasonOf(run({ action: 'requested' }))).toBe('RUN_NOT_COMPLETED');
    expect(reasonOf(run({ status: 'in_progress' }))).toBe('RUN_NOT_COMPLETED');
  });

  it('tolerates a payload that simply omitted the status', () => {
    expect(reasonOf(run({ status: null }))).toBeNull();
  });

  it.each([
    ['cancelled', 'RUN_CANCELLED'],
    ['timed_out', 'RUN_TIMED_OUT'],
    ['action_required', 'RUN_NEEDS_ACTION'],
    ['stale', 'RUN_STALE'],
  ])('refuses a %s run as not a defect', (conclusion, reason) => {
    expect(reasonOf(run({ conclusion }))).toBe(reason);
  });

  it.each(['success', 'neutral', 'skipped'])('refuses a %s run', (conclusion) => {
    expect(reasonOf(run({ conclusion }))).toBe('RUN_DID_NOT_FAIL');
  });

  it('treats a conclusion GitHub has not published yet as not a failure', () => {
    expect(reasonOf(run({ conclusion: 'quarantined_by_a_future_release' }))).toBe(
      'RUN_DID_NOT_FAIL',
    );
    expect(reasonOf(run({ conclusion: null }))).toBe('RUN_DID_NOT_FAIL');
  });

  it('refuses a pull request build twice over', () => {
    // Once for the trigger, and the branch rule would have caught it too.
    expect(reasonOf(run({ triggeringEvent: 'pull_request', headBranch: 'fix/thing' }))).toBe(
      'TRIGGER_IS_NOT_A_MAINLINE_RUN',
    );
    expect(reasonOf(run({ headBranch: 'fix/thing' }))).toBe('NOT_THE_DEFAULT_BRANCH');
  });

  it('fails closed when the payload never said what the default branch is', () => {
    expect(reasonOf(run({ defaultBranch: null }))).toBe('DEFAULT_BRANCH_NOT_STATED');
    expect(reasonOf(run({ defaultBranch: '   ' }))).toBe('DEFAULT_BRANCH_NOT_STATED');
  });

  it('does not assume the default branch is called main', () => {
    expect(reasonOf(run({ headBranch: 'master', defaultBranch: 'master' }))).toBeNull();
    expect(reasonOf(run({ headBranch: 'main', defaultBranch: 'master' }))).toBe(
      'NOT_THE_DEFAULT_BRANCH',
    );
  });

  it('refuses a run that named no repository or no workflow file', () => {
    expect(reasonOf(run({ repositoryFullName: null }))).toBe('RUN_PAYLOAD_INCOMPLETE');
    expect(reasonOf(run({ workflowPath: null }))).toBe('RUN_PAYLOAD_INCOMPLETE');
  });

  it('reports the most specific true reason when several apply', () => {
    // Cancelled AND on a topic branch: cancelled is the fact that decides it.
    expect(reasonOf(run({ conclusion: 'cancelled', headBranch: 'topic' }))).toBe('RUN_CANCELLED');
  });

  it("explains every refusal in the library's own words, quoting nothing off the payload", () => {
    for (const conclusion of ['cancelled', 'timed_out', 'action_required', 'stale', 'success']) {
      const verdict = classifyWorkflowRun(
        run({
          conclusion,
          repositoryFullName: 'SECRET/REPO',
          workflowPath: '.github/workflows/SECRET.yml',
          headBranch: 'SECRET-BRANCH',
        }),
      );
      expect(verdict.attributable).toBe(false);
      if (verdict.attributable) return;
      // The library's own sentence. The vocabulary overlaps GitHub's on purpose
      // -- "cancelled" is the right English word -- but nothing off the payload
      // is interpolated, because this reaches a log line and a database row.
      expect(verdict.explanation).not.toContain('SECRET');
      expect(verdict.explanation.length).toBeGreaterThan(20);
    }
  });

  it('draws every reason it can emit from the published list', () => {
    const emitted = [
      run({ action: 'requested' }),
      run({ conclusion: 'cancelled' }),
      run({ conclusion: 'timed_out' }),
      run({ conclusion: 'action_required' }),
      run({ conclusion: 'stale' }),
      run({ conclusion: 'success' }),
      run({ triggeringEvent: 'pull_request' }),
      run({ defaultBranch: null }),
      run({ headBranch: 'topic' }),
      run({ workflowPath: null }),
    ].map(reasonOf);
    for (const reason of emitted) {
      expect(CI_NOT_A_DEFECT_REASONS).toContain(reason);
    }
  });
});

function job(overrides: Partial<JobFacts> = {}): JobFacts {
  return { name: 'unit', conclusion: 'failure', steps: [], ...overrides };
}

describe('classifyJobOutcome and findFailedJob', () => {
  it('attributes a run with a failed job', () => {
    expect(classifyJobOutcome([job({ conclusion: 'success' }), job()])).toEqual({
      attributable: true,
    });
  });

  it('picks the failed job rather than whichever sibling was cancelled first', () => {
    const jobs = [
      job({ name: 'lint', conclusion: 'cancelled' }),
      job({ name: 'unit (node 22)', conclusion: 'failure' }),
      job({ name: 'unit (node 20)', conclusion: 'cancelled' }),
    ];
    expect(findFailedJob(jobs)?.name).toBe('unit (node 22)');
  });

  it.each([
    ['cancelled', 'JOB_CANCELLED'],
    ['timed_out', 'JOB_TIMED_OUT'],
    ['action_required', 'JOB_NEEDS_ACTION'],
  ])('refuses a run whose only non-green job was %s', (conclusion, reason) => {
    const verdict = classifyJobOutcome([job({ conclusion: 'success' }), job({ conclusion })]);
    expect(verdict.attributable).toBe(false);
    if (!verdict.attributable) expect(verdict.reason).toBe(reason);
  });

  it('refuses a red run with no failing job at all', () => {
    const verdict = classifyJobOutcome([job({ conclusion: 'success' })]);
    expect(verdict.attributable).toBe(false);
    if (!verdict.attributable) expect(verdict.reason).toBe('NO_JOB_FAILED');
    expect(classifyJobOutcome([]).attributable).toBe(false);
  });

  it('prefers a timeout to a cancellation when both are present', () => {
    // A cancelled sibling is usually a consequence of the job that timed out.
    const verdict = classifyJobOutcome([
      job({ conclusion: 'cancelled' }),
      job({ conclusion: 'timed_out' }),
    ]);
    expect(verdict.attributable).toBe(false);
    if (!verdict.attributable) expect(verdict.reason).toBe('JOB_TIMED_OUT');
  });
});

describe('findFailedStep', () => {
  it('takes the first failing step, not the last step that ran', () => {
    const failed = findFailedStep(
      job({
        steps: [
          { name: 'Set up job', number: 1, status: 'completed', conclusion: 'success' },
          { name: 'pnpm test', number: 2, status: 'completed', conclusion: 'failure' },
          { name: 'Upload coverage', number: 3, status: 'completed', conclusion: 'skipped' },
        ],
      }),
    );
    expect(failed?.name).toBe('pnpm test');
  });

  it('answers null rather than blaming a step when the payload carried none', () => {
    expect(findFailedStep(job({ steps: [] }))).toBeNull();
    expect(
      findFailedStep(
        job({ steps: [{ name: 'a', number: 1, status: 'completed', conclusion: 'cancelled' }] }),
      ),
    ).toBeNull();
  });
});

describe('classifyFailingStep', () => {
  it.each([
    'Set up job',
    'Complete job',
    'Post Checkout',
    'Checkout',
    'actions/checkout@v4',
    'Set up Node',
    'Setup Python 3.12',
    'Install dependencies',
    'pnpm install',
    'npm ci',
    'bundle install',
    'cargo fetch',
    'Cache node modules',
    'Restore cache',
    'Upload artifact',
    'Download artifacts',
    'Login to GHCR',
    'Configure AWS credentials',
    'Build and push',
  ])('rejects the pipeline step %s', (name) => {
    const verdict = classifyFailingStep({
      name,
      number: 1,
      status: 'completed',
      conclusion: 'failure',
    });
    expect(verdict?.attributable).toBe(false);
    if (verdict !== null && !verdict.attributable) {
      expect(verdict.reason).toBe('FAILING_STEP_IS_INFRASTRUCTURE');
    }
  });

  it.each([
    'pnpm test',
    'Run unit tests',
    'vitest run',
    'go test ./...',
    'Typecheck',
    'Build the package',
    'pytest',
  ])('has no opinion about the test step %s', (name) => {
    expect(
      classifyFailingStep({ name, number: 2, status: 'completed', conclusion: 'failure' }),
    ).toBeNull();
  });

  it('has no opinion when there is no step or no name', () => {
    expect(classifyFailingStep(null)).toBeNull();
    expect(
      classifyFailingStep({ name: '  ', number: 1, status: 'completed', conclusion: 'failure' }),
    ).toBeNull();
  });

  it('can only ever reject; there is no shape in which it approves', () => {
    for (const name of ['pnpm test', 'Set up job', '']) {
      const verdict = classifyFailingStep({
        name,
        number: 1,
        status: 'completed',
        conclusion: 'failure',
      });
      expect(verdict === null || verdict.attributable === false).toBe(true);
    }
  });
});

describe('classifyFailureLog', () => {
  it.each([
    'The runner has received a shutdown signal. This can happen when the runner service is stopped',
    'The self-hosted runner: builder-07 lost communication with the server.',
    'Error: The operation was canceled.',
    'ENOSPC: No space left on device, write',
    'npm ERR! network request to https://registry.npmjs.org/left-pad failed',
    'Error: getaddrinfo EAI_AGAIN registry.npmjs.org',
    'fatal: unable to access https://github.com/acme/widgets/: Could not resolve host: github.com',
    'ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/thing: Not Found',
    'error: RPC failed; curl 92 HTTP/2 stream 5 was not closed cleanly',
    'read ECONNRESET',
    'Error response from daemon: toomanyrequests: You have reached your pull rate limit',
    'remote: Repository not found.',
    'HttpError: Bad credentials',
    'The requested URL returned error: 503',
  ])('rejects an infrastructure log naming %s', (log) => {
    const verdict = classifyFailureLog(log);
    expect(verdict?.attributable).toBe(false);
    if (verdict !== null && !verdict.attributable) {
      expect(verdict.reason).toBe('INFRASTRUCTURE_IN_LOG');
    }
  });

  it.each([
    'AssertionError: expected 3 to equal 4\n  at Object.<anonymous> (src/total.ts:12:5)',
    "TypeError: Cannot read properties of undefined (reading 'id')",
    'src/index.ts(9,3): error TS2322: Type string is not assignable to type number',
    'FAILED tests/test_total.py::test_rounds_up - assert 1.0 == 1.5',
    '--- FAIL: TestTotal (0.00s)',
    'Error: Process completed with exit code 1.',
  ])('has no opinion about a genuine defect log: %s', (log) => {
    expect(classifyFailureLog(log)).toBeNull();
  });

  it('deliberately does not call an out-of-memory kill infrastructure', () => {
    // Documented in the module: a suite that exhausts memory may be a leak the
    // repository introduced, and this layer cannot tell which.
    expect(classifyFailureLog('FATAL ERROR: Reached heap limit Allocation failed')).toBeNull();
  });

  it('has no opinion about an empty or unreadable log', () => {
    expect(classifyFailureLog('')).toBeNull();
    expect(classifyFailureLog(undefined as unknown as string)).toBeNull();
  });
});

describe('logTail', () => {
  it('keeps the end, which is where a runner writes its diagnosis', () => {
    const log = `${'x'.repeat(MAX_LOG_SCAN_BYTES)}The runner has received a shutdown signal`;
    const tail = logTail(log);
    expect(tail.length).toBe(MAX_LOG_SCAN_BYTES);
    expect(classifyFailureLog(tail)?.attributable).toBe(false);
  });

  it('leaves a short log alone', () => {
    expect(logTail('short')).toBe('short');
  });
});
