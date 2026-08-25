/**
 * ci-verdict -- is this red CI run our bug, or was it the runner?
 *
 * Zero runtime dependencies, by construction: no module in this package
 * imports anything outside it, including Node builtins. It runs unchanged on
 * Node, Deno, Bun, a browser and an edge worker.
 *
 * See the README for the two-layer design and why a heuristic here may only
 * ever reject.
 */

export { ciVerdict } from './verdict.js';
export type { CiVerdictInput } from './verdict.js';

export {
  CI_NOT_A_DEFECT_REASONS,
  classifyFailingStep,
  classifyFailureLog,
  classifyJobOutcome,
  classifyWorkflowRun,
  findFailedJob,
  findFailedStep,
  logTail,
  MAX_LOG_SCAN_BYTES,
} from './attribution.js';
export type {
  CiAttribution,
  CiNotADefectReason,
  CiRejection,
  JobFacts,
  StepFacts,
  WorkflowRunFacts,
} from './attribution.js';

export { jobFactsFrom, jobFactsListFrom, workflowRunFactsFrom } from './payload.js';

export { PACKAGE_MANAGERS, relaxedInstall, resolvePackageManager } from './toolchain.js';
export type {
  PackageManager,
  PackageManagerEvidence,
  PackageManagerResolution,
  ToolchainInputs,
} from './toolchain.js';
