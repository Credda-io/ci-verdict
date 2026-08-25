/**
 * The whole library in one call.
 *
 * `ciVerdict()` runs the layers in order and returns the FIRST rejection, so
 * the reason an operator sees is the most specific true one. The order is not
 * arbitrary and not tunable:
 *
 *   1. Layer 1, run level -- GitHub's documented enums about the run.
 *   2. Layer 1, job level -- GitHub's documented enums about the jobs, when the
 *      caller supplied them.
 *   3. Layer 2, step name -- heuristic, may only reject.
 *   4. Layer 2, log tail -- heuristic, may only reject.
 *
 * Cheapest and most certain first. A cancelled run is reported as cancelled
 * without anyone fetching its jobs, and a caller who has only the webhook
 * delivery gets a useful verdict from that alone -- which is the point of
 * making `jobs` and `log` optional rather than required.
 *
 * Passing neither `jobs` nor `log` means layers 2 and 3 never run. That is a
 * weaker verdict, not a different one: it can still say no, it just has fewer
 * ways to. See the README on what the extra evidence buys.
 */

import {
  classifyFailingStep,
  classifyFailureLog,
  classifyJobOutcome,
  classifyWorkflowRun,
  findFailedJob,
  findFailedStep,
  logTail,
} from './attribution.js';
import type { CiAttribution } from './attribution.js';
import { jobFactsListFrom, workflowRunFactsFrom } from './payload.js';

export interface CiVerdictInput {
  /**
   * A `workflow_run` webhook delivery body: `{ action, repository,
   * workflow_run }`. Parsed JSON, not the raw string.
   */
  readonly workflowRun: unknown;
  /**
   * The response from `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs`,
   * either the `{ total_count, jobs }` envelope or the bare array. Optional:
   * omitting it skips the job-level and step-name layers.
   */
  readonly jobs?: unknown;
  /**
   * The log of the failing job, or any tail of it. Optional: omitting it skips
   * the log layer. Only the last `MAX_LOG_SCAN_BYTES` are scanned, and the
   * slicing is done here so a caller cannot forget to do it.
   */
  readonly log?: string;
}

export function ciVerdict(input: CiVerdictInput): CiAttribution {
  const run = classifyWorkflowRun(workflowRunFactsFrom(input.workflowRun));
  if (!run.attributable) return run;

  if (input.jobs !== undefined) {
    const jobs = jobFactsListFrom(input.jobs);
    const outcome = classifyJobOutcome(jobs);
    if (!outcome.attributable) return outcome;

    // Non-null by construction: `classifyJobOutcome` returned attributable
    // exactly when `findFailedJob` found one. Recomputed rather than threaded
    // through so that the two functions stay independently testable.
    const failed = findFailedJob(jobs);
    const step = classifyFailingStep(failed === null ? null : findFailedStep(failed));
    // A heuristic layer answers `CiRejection | null` and the null is the
    // interesting half: it means "no opinion", and no opinion is not approval.
    // The only thing done with a non-null answer is returning it, because a
    // rejection is the only non-null answer the type lets it produce.
    if (step !== null) return step;
  }

  if (typeof input.log === 'string' && input.log !== '') {
    const log = classifyFailureLog(logTail(input.log));
    if (log !== null) return log;
  }

  return { attributable: true };
}
