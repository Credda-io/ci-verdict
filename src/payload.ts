/**
 * Lifting the facts the classifier needs out of GitHub's own JSON.
 *
 * `attribution.ts` deliberately takes plain records rather than raw payloads,
 * so that its rules are readable and testable without a webhook body. This
 * module is the adapter between the two.
 *
 * It used to say it was "the only place in the package that touches an untyped
 * object", and that stopped being true when `toolchain.ts` joined the package:
 * `readPin()` there parses a `package.json` into `unknown` and narrows it the
 * same way. The claim was load-bearing in the wrong direction -- it is the
 * reason a reader would audit this file alone for totality and stop -- so it
 * is stated as what it is. There are TWO such places, they are this file and
 * `readPin()`, and both are total for the same reason.
 *
 * Everything here is total. A field of the wrong type, a missing object, an
 * array of nulls -- each becomes the absence of a fact, never an exception.
 * GitHub adds and reshapes fields on its own schedule and a throw in an
 * unauthenticated ingest path turns a routine platform change into an outage.
 *
 * Field names were read from GitHub's REST documentation on 2026-08-25 and are
 * cited in the docblock of `attribution.ts`:
 *
 *   - `action`, `repository.full_name`, `repository.default_branch` and the
 *     workflow run fields `status`, `conclusion`, `event`, `head_branch`,
 *     `path` -- https://docs.github.com/en/rest/actions/workflow-runs and
 *     https://docs.github.com/en/rest/repos/repos
 *   - A jobs listing answers `{ total_count, jobs }`, and a job carries `name`,
 *     `conclusion` and `steps[]` of `{ name, number, status, conclusion }` --
 *     https://docs.github.com/en/rest/actions/workflow-jobs
 */

import type { JobFacts, StepFacts, WorkflowRunFacts } from './attribution.js';

/* Four total readers, reimplemented here rather than depended upon. The
 * package has no runtime dependencies and these are the whole reason it can
 * afford not to. */

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arr(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A non-empty string, or null. Empty and absent are the same fact here. */
function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The eight fields `classifyWorkflowRun()` reads, from a `workflow_run`
 * delivery body.
 *
 * The payload shape is the webhook one: `{ action, repository, workflow_run }`.
 * A caller reading the REST API instead has no `action` field and holds a bare
 * run object; `workflowRunFactsFrom({ action: 'completed', workflow_run: run,
 * repository: repo })` is the adaptation, and it is left to the caller because
 * inventing `action: 'completed'` on their behalf would silently accept a run
 * that is still going.
 */
export function workflowRunFactsFrom(payload: unknown): WorkflowRunFacts {
  const body = obj(payload) ?? {};
  const run = obj(body['workflow_run']) ?? {};
  const repository = obj(body['repository']) ?? {};
  return {
    action: str(body['action']) ?? '',
    status: str(run['status']),
    conclusion: str(run['conclusion']),
    triggeringEvent: str(run['event']),
    headBranch: str(run['head_branch']),
    defaultBranch: str(repository['default_branch']),
    repositoryFullName: str(repository['full_name']),
    workflowPath: str(run['path']),
  };
}

/** One job object from a jobs listing. */
export function jobFactsFrom(value: unknown): JobFacts {
  const job = obj(value) ?? {};
  const steps: StepFacts[] = [];
  for (const entry of arr(job['steps'])) {
    const step = obj(entry);
    if (step === null) continue;
    steps.push({
      name: str(step['name']),
      number: num(step['number']),
      status: str(step['status']),
      conclusion: str(step['conclusion']),
    });
  }
  return { name: str(job['name']), conclusion: str(job['conclusion']), steps };
}

/**
 * A whole jobs listing: either the documented `{ total_count, jobs }` envelope
 * or the bare array, because callers who paginate hold the array.
 */
export function jobFactsListFrom(payload: unknown): readonly JobFacts[] {
  const jobs = Array.isArray(payload) ? payload : arr(obj(payload)?.['jobs']);
  return jobs.map(jobFactsFrom);
}
