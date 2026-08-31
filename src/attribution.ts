/**
 * Telling a defect in the repository from a failure of the CI that ran it.
 *
 * A red GitHub Actions run is not evidence that the code is broken. It is
 * equally likely to be a runner that was reclaimed mid-job, an npm registry
 * that returned 503, a checkout that could not reach github.com, an expired
 * cloud credential, or a job somebody cancelled by pressing the button. Any
 * tool that reacts to a red run -- a bot that files an issue, a dashboard that
 * counts flakiness, an agent that opens an investigation -- has to answer that
 * question first, and most of them do not.
 *
 * Two layers, and the difference between them is stated rather than blurred.
 *
 *   **Layer 1 is documented.** It reads GitHub's own enums and nothing else.
 *   Every value it compares against was read from GitHub's REST documentation
 *   on 2026-08-25 and is listed with its URL below. This layer carries the
 *   weight: `cancelled`, `timed_out`, `stale`, `action_required`, `skipped`
 *   and `neutral` are GitHub telling us, in its own vocabulary, that the run
 *   did not fail on the merits, and a run on a branch that is not the default
 *   branch is somebody's work in progress rather than a break.
 *
 *   **Layer 2 is heuristic and says so.** Step names and log substrings are
 *   NOT documented anywhere; they are this library's own patterns, written
 *   from what these tools print. They are therefore given exactly one power:
 *   they may REJECT, never promote. A heuristic that fires wrongly costs one
 *   red run ignored. A heuristic trusted to accept would cost a confident,
 *   wrong claim that the repository is at fault, and that is not a trade worth
 *   making in either direction, so the asymmetry is enforced by the SHAPE of
 *   the functions -- `CiRejection | null`, where `null` means "no opinion" and
 *   the type has no member that means "approved", so a heuristic that tried to
 *   approve would not compile -- rather than by discipline.
 *
 * The default for an unrecognised failure is `attributable`. That is a real
 * choice and worth being honest about: layer 1 removes the large documented
 * categories, layer 2 removes the infrastructure failures it recognises, and
 * what is left is treated as the repository's own. An infrastructure failure
 * whose wording nothing here matches will come back `{ attributable: true }`.
 * The alternative default -- refusing anything not positively recognised as a
 * defect -- would require a heuristic that can approve, which is the one thing
 * this design forbids. Callers that cannot tolerate the residue should gate on
 * something structural downstream: a file and a line from a check-run
 * annotation, a named failing test, a reproducible command. See the README.
 *
 * Documentation read on 2026-08-25, not recalled:
 *
 *   - Workflow run `status` and `conclusion` enums, and the run fields
 *     `head_branch`, `head_sha`, `event`, `run_attempt`, `run_started_at`,
 *     `updated_at`, `path`, `html_url` --
 *     https://docs.github.com/en/rest/actions/workflow-runs
 *     `conclusion` is one of `success`, `failure`, `neutral`, `cancelled`,
 *     `timed_out`, `skipped`, `action_required`; `status` includes
 *     `completed`, `in_progress`, `queued`, `waiting`, `pending`, `requested`
 *     and the conclusion values, and `stale` appears among them.
 *   - Job and step `conclusion` enums (`success`, `failure`, `neutral`,
 *     `cancelled`, `skipped`, `timed_out`, `action_required`, or null) and the
 *     step fields `name`, `number`, `status`, `conclusion` --
 *     https://docs.github.com/en/rest/actions/workflow-jobs
 *   - `default_branch` and `full_name` on a repository --
 *     https://docs.github.com/en/rest/repos/repos (Get a repository)
 *   - Workflow files live in `.github/workflows` and carry a `.yml` or
 *     `.yaml` extension --
 *     https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
 *
 * SECURITY: everything read here came off an attacker-influenced payload. No
 * payload text is interpolated into an `explanation`; those are this library's
 * own sentences, because they end up in a log line and a database row. The
 * `evidence` field is the one place payload text is handed back, and it is
 * handed back through `quote()` -- one line, control characters removed,
 * length bounded -- so a caller who logs it cannot be made to log a megabyte
 * or a terminal escape sequence.
 */

/**
 * Why a red run is not a defect in the repository.
 *
 * Codes rather than prose so an operator can count them. A deployment that
 * ingests a thousand runs and rejects nine hundred of them as
 * `NOT_THE_DEFAULT_BRANCH` is working correctly; one rejecting nine hundred as
 * `INFRASTRUCTURE_IN_LOG` has a broken CI and no defect to find.
 */
export const CI_NOT_A_DEFECT_REASONS = [
  /* Layer 1 -- run level, from GitHub's documented enums. */
  'RUN_NOT_COMPLETED',
  'RUN_DID_NOT_FAIL',
  'RUN_CANCELLED',
  'RUN_TIMED_OUT',
  'RUN_NEEDS_ACTION',
  'RUN_STALE',
  'TRIGGER_IS_NOT_A_MAINLINE_RUN',
  'DEFAULT_BRANCH_NOT_STATED',
  'NOT_THE_DEFAULT_BRANCH',
  'RUN_PAYLOAD_INCOMPLETE',

  /* Layer 1 -- job level, from GitHub's documented enums. */
  'NO_JOB_FAILED',
  'JOB_CANCELLED',
  'JOB_TIMED_OUT',
  'JOB_NEEDS_ACTION',

  /* Layer 2 -- heuristic. May only reject. */
  'FAILING_STEP_IS_INFRASTRUCTURE',
  'INFRASTRUCTURE_IN_LOG',
] as const;

export type CiNotADefectReason = (typeof CI_NOT_A_DEFECT_REASONS)[number];

/**
 * Which of the two layers decided.
 *
 * The README's central claim is that these are not the same kind of statement:
 * `documented` is GitHub's own enum read back, `heuristic` is this library's
 * guess about wording nobody specifies. A caller who wants to act only on the
 * certain half had no way to tell them apart without hardcoding a list of
 * reason codes, which would go stale the first time one was added.
 */
export type CiLayer = 'documented' | 'heuristic';

/** The reasons layer 2 can produce. Everything else is layer 1. */
const HEURISTIC_REASONS: ReadonlySet<string> = new Set<CiNotADefectReason>([
  'FAILING_STEP_IS_INFRASTRUCTURE',
  'INFRASTRUCTURE_IN_LOG',
]);

/**
 * The longest excerpt of payload text a rejection will carry.
 *
 * A step name is short; a log line is whatever somebody printed, and a
 * minified bundle on one line is a megabyte of it. The bound is on what a
 * caller ends up storing per rejection, so it is small on purpose.
 */
export const MAX_EVIDENCE_LENGTH = 200;

/**
 * Payload text, made safe to put in a log line.
 *
 * Every control character -- including the ESC that starts a terminal escape
 * sequence, and the CR that lets a crafted log line overwrite the one before
 * it -- becomes a space, runs of whitespace collapse, and the result is cut to
 * `MAX_EVIDENCE_LENGTH` with an ellipsis. Empty text answers null, because the
 * absence of evidence is a fact and the empty string reads like one.
 */
function quote(text: string | null): string | null {
  if (typeof text !== 'string') return null;
  const flat = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (flat === '') return null;
  return flat.length <= MAX_EVIDENCE_LENGTH ? flat : `${flat.slice(0, MAX_EVIDENCE_LENGTH - 1)}\u2026`;
}

/**
 * The verdict.
 *
 * A discriminated union rather than a boolean and a string, so that reading
 * `reason` off an attributable verdict does not typecheck.
 */
export type CiAttribution =
  | { readonly attributable: true }
  | {
      readonly attributable: false;
      readonly reason: CiNotADefectReason;
      /** One line, this library's own words. Quotes nothing off the payload. */
      readonly explanation: string;
      /**
       * Whether GitHub's documented enums decided this, or a heuristic did.
       * See `CiLayer`.
       */
      readonly layer: CiLayer;
      /**
       * The one thing that decided it, as it appeared: the conclusion, the
       * triggering event, the branch, the job or step name, the matching log
       * line. Null when the reason is the *absence* of a field, since there is
       * nothing to show. Sanitised and bounded -- see `quote()` -- but still
       * attacker-influenced text: display it, do not parse it.
       */
      readonly evidence: string | null;
    };

/**
 * The half of `CiAttribution` that says no, as a type of its own.
 *
 * This exists so that "a heuristic may only reject" is a fact the compiler
 * checks rather than a rule in a docblock. The two layer-2 functions return
 * `CiRejection | null`, and that type contains no value meaning "I vouch for
 * this": a heuristic that tried to return `{ attributable: true }` would not
 * compile. `CiAttribution | null` would have permitted it.
 */
export type CiRejection = Extract<CiAttribution, { readonly attributable: false }>;

const EXPLANATIONS: Readonly<Record<CiNotADefectReason, string>> = {
  RUN_NOT_COMPLETED: 'the run has not finished, so there is no outcome to attribute yet',
  RUN_DID_NOT_FAIL: 'the run did not conclude as a failure',
  RUN_CANCELLED:
    'the run was cancelled, which says a person or a policy stopped it and nothing about the code',
  RUN_TIMED_OUT:
    'the run exceeded its time limit, which is a fact about the runner budget rather than a specific reproducible failure',
  RUN_NEEDS_ACTION:
    'the run is waiting on a human approval or an integration, which is not a failure of the code',
  RUN_STALE:
    'the run was superseded before it could produce a verdict, so its result describes nothing',
  TRIGGER_IS_NOT_A_MAINLINE_RUN:
    'the run was not triggered by a push, a schedule or a manual dispatch, so it does not describe the state of the mainline',
  DEFAULT_BRANCH_NOT_STATED:
    "the payload did not state the repository's default branch, so whether this failure is on the mainline cannot be established",
  NOT_THE_DEFAULT_BRANCH:
    'the run is on a branch other than the default one, where a red build is expected work in progress rather than a break',
  RUN_PAYLOAD_INCOMPLETE:
    'the payload did not carry the repository, the workflow file or the outcome, so there is nothing to key a report on',

  NO_JOB_FAILED:
    'no job in the run concluded as a failure, so the run reports red without a job that broke',
  JOB_CANCELLED:
    'the job that ended the run was cancelled rather than failed, which is usually a sibling job failing first or a person stopping the run',
  JOB_TIMED_OUT:
    'the job that ended the run exceeded its time limit rather than failing on the merits',
  JOB_NEEDS_ACTION: 'the job that ended the run is waiting on a human approval or an integration',

  FAILING_STEP_IS_INFRASTRUCTURE:
    'the step that failed sets up the job rather than exercising the code -- a checkout, a toolchain install, a cache or an artifact transfer -- so the break is in the pipeline rather than in the repository',
  INFRASTRUCTURE_IN_LOG:
    'the log of the failing step names a network, registry, runner or credential failure, which is a failure of the infrastructure the tests ran on rather than of the code they tested',
};

function reject(reason: CiNotADefectReason, evidence: string | null = null): CiRejection {
  return {
    attributable: false,
    reason,
    explanation: EXPLANATIONS[reason],
    layer: HEURISTIC_REASONS.has(reason) ? 'heuristic' : 'documented',
    evidence: quote(evidence),
  };
}

const ATTRIBUTABLE: CiAttribution = { attributable: true };

/**
 * Which triggering events describe the mainline.
 *
 * `pull_request` is the loud omission. A red pull request build is the normal
 * state of somebody's afternoon, it is already in front of the author, and
 * reacting to it would mean acting on code nobody has decided to keep. The
 * default-branch rule below excludes it a second time, because a pull request
 * run's `head_branch` is the topic branch -- both rules are kept, since a
 * `merge_group` run does carry a branch and the two checks mean different
 * things.
 */
const MAINLINE_TRIGGERS: ReadonlySet<string> = new Set(['push', 'schedule', 'workflow_dispatch']);

/**
 * The facts about a run this module needs, lifted out of a payload elsewhere.
 *
 * A plain record rather than the raw payload so the rules are testable without
 * a webhook body, and so the reader can see at a glance that the decision uses
 * eight documented fields and nothing else. `workflowRunFactsFrom()` in
 * `payload.ts` builds one of these from a `workflow_run` delivery.
 */
export interface WorkflowRunFacts {
  /** The webhook action, or `completed` when the caller is reading the REST API. */
  readonly action: string;
  readonly status: string | null;
  readonly conclusion: string | null;
  /** `workflow_run.event`: what triggered the run. */
  readonly triggeringEvent: string | null;
  readonly headBranch: string | null;
  /** `repository.default_branch`. Null when the payload did not carry it. */
  readonly defaultBranch: string | null;
  /** `repository.full_name`. */
  readonly repositoryFullName: string | null;
  /** `workflow_run.path`, e.g. `.github/workflows/ci.yml`. */
  readonly workflowPath: string | null;
}

/**
 * Layer 1 at the run level.
 *
 * Pure, total, and reads only GitHub's documented enums. Ordering is
 * deliberate: the cheapest and most certain rejections come first so that the
 * reason recorded for a delivery is the most specific true one -- a cancelled
 * pull request build is reported as cancelled, not as off-mainline, because
 * cancelled is the fact that decides it.
 */
export function classifyWorkflowRun(facts: WorkflowRunFacts): CiAttribution {
  if (facts.action !== 'completed') return reject('RUN_NOT_COMPLETED', facts.action);
  // `status` is absent on some serializations; only an explicit non-completed
  // status is a rejection, because inferring "not completed" from a missing
  // field would reject every run whose payload simply omitted it.
  if (facts.status !== null && facts.status !== 'completed') return reject('RUN_NOT_COMPLETED', facts.status);

  switch (facts.conclusion) {
    case 'failure':
      break;
    case 'cancelled':
      return reject('RUN_CANCELLED', facts.conclusion);
    case 'timed_out':
      return reject('RUN_TIMED_OUT', facts.conclusion);
    case 'action_required':
      return reject('RUN_NEEDS_ACTION', facts.conclusion);
    case 'stale':
      return reject('RUN_STALE', facts.conclusion);
    default:
      // `success`, `neutral`, `skipped`, null, and any value GitHub adds after
      // this was written. An unknown conclusion is NOT a failure: treating an
      // unrecognised enum value as one would turn a future platform change into
      // a wave of false reports.
      return reject('RUN_DID_NOT_FAIL', facts.conclusion);
  }

  if (facts.triggeringEvent === null || !MAINLINE_TRIGGERS.has(facts.triggeringEvent)) {
    return reject('TRIGGER_IS_NOT_A_MAINLINE_RUN', facts.triggeringEvent);
  }

  const defaultBranch = (facts.defaultBranch ?? '').trim();
  const headBranch = (facts.headBranch ?? '').trim();
  // Fail closed. Without the default branch there is no way to tell a break on
  // the mainline from a red topic branch, and guessing `main` would be wrong
  // for every repository that never renamed `master` and for every fork.
  if (defaultBranch === '') return reject('DEFAULT_BRANCH_NOT_STATED');
  if (headBranch === '' || headBranch !== defaultBranch) return reject('NOT_THE_DEFAULT_BRANCH', headBranch);

  if ((facts.repositoryFullName ?? '').trim() === '' || (facts.workflowPath ?? '').trim() === '') {
    return reject('RUN_PAYLOAD_INCOMPLETE');
  }

  return ATTRIBUTABLE;
}

export interface StepFacts {
  readonly name: string | null;
  readonly number: number | null;
  readonly status: string | null;
  readonly conclusion: string | null;
}

export interface JobFacts {
  readonly name: string | null;
  readonly conclusion: string | null;
  readonly steps: readonly StepFacts[];
}

/**
 * The job in a run that is worth attributing, or null.
 *
 * `filter=latest` on GitHub's jobs endpoint (the default) already restricts a
 * listing to the newest attempt, so a job that failed on attempt one and
 * passed on attempt two is not here to be found.
 *
 * The FIRST job whose conclusion is `failure` is chosen, not the first job
 * that is not green. In a matrix, one genuine failure cancels its siblings,
 * and the cancelled siblings are noise; picking a cancelled job would attribute
 * the break to whichever shard the API happened to list first.
 */
export function findFailedJob(jobs: readonly JobFacts[]): JobFacts | null {
  return jobs.find((job) => job.conclusion === 'failure') ?? null;
}

/**
 * Layer 1 at the job level, applied to a job already chosen as the failing one.
 *
 * Kept separate from `findFailedJob` so that a run whose only non-green jobs
 * were cancelled or timed out produces a specific reason rather than a bare
 * "nothing failed".
 */
/** The name of the first job with a given conclusion, for evidence. */
function jobNameWith(jobs: readonly JobFacts[], conclusion: string): string | null {
  return jobs.find((job) => job.conclusion === conclusion)?.name ?? null;
}

export function classifyJobOutcome(jobs: readonly JobFacts[]): CiAttribution {
  if (findFailedJob(jobs) !== null) return ATTRIBUTABLE;

  // Nothing failed. Say which of the documented non-failures it was, preferring
  // the one that most explains a red run.
  const conclusions = new Set(jobs.map((job) => job.conclusion));
  if (conclusions.has('timed_out')) return reject('JOB_TIMED_OUT', jobNameWith(jobs, 'timed_out'));
  if (conclusions.has('action_required')) return reject('JOB_NEEDS_ACTION', jobNameWith(jobs, 'action_required'));
  if (conclusions.has('cancelled')) return reject('JOB_CANCELLED', jobNameWith(jobs, 'cancelled'));
  return reject('NO_JOB_FAILED');
}

/**
 * The step that broke, which is the first one concluding `failure`.
 *
 * Later steps in a failed job are `skipped` and the ones before it `success`,
 * so the first failure is the one that ended the job. A job may report no
 * failing step at all -- the steps array is absent on some serializations, and
 * a job killed outside a step has none -- and null is the honest answer rather
 * than blaming the last step that ran.
 */
export function findFailedStep(job: JobFacts): StepFacts | null {
  return job.steps.find((step) => step.conclusion === 'failure') ?? null;
}

/**
 * Layer 2, part one: step names that describe preparing a job rather than
 * exercising the code.
 *
 * NOT DOCUMENTED. GitHub publishes no list of the steps it generates and no
 * naming convention for the ones an author writes, so every pattern here is
 * this library's own reading of what these actions call themselves. They are
 * anchored at the start of the name and matched case-insensitively.
 *
 * The cost of a false positive is one red run ignored; the cost of a false
 * negative is one infrastructure failure reported as a defect. This list is
 * allowed to be wrong in the first direction only, because
 * `classifyFailingStep()` can return a rejection and nothing else.
 *
 * A repository that genuinely names its test step "Install dependencies" would
 * be skipped. That is accepted: it is a rarity, and the alternative is filing
 * against every repository whose lockfile install flakes.
 */
const INFRASTRUCTURE_STEP_PATTERNS: readonly RegExp[] = [
  /* GitHub's own generated steps. */
  /^set up job\b/i,
  /^complete job\b/i,
  /^post\b/i,

  /* Getting the code and the toolchain onto the runner. */
  /^(actions\/)?checkout\b/i,
  /^check ?out\b/i,
  /^set ?up[ -](node|python|java|go|ruby|dotnet|\.net|rust|php|xcode|jdk|msbuild|qemu|buildx|docker)\b/i,
  /^install (the )?(dependencies|deps|packages|toolchain|requirements)\b/i,
  /^installing\b/i,
  /^(npm|pnpm|yarn|bun|pip|pipenv|poetry|bundle|cargo|composer|go mod|gradle|mvn|maven) (ci|install|fetch|download|restore|sync)\b/i,
  /^restore (the )?(dependencies|packages|cache)\b/i,

  /* Caches and artifacts: transfers, not tests. */
  /^(restore|save|warm|prime)?[ -]?cache\b/i,
  /^(upload|download)[ -]artifact\b/i,
  /^(upload|download) (the )?artifacts?\b/i,

  /* Credentials and registries. */
  /^(log ?in|login|authenticate)\b/i,
  /^configure (aws|gcp|azure|google) credentials\b/i,
  /^(docker )?(build and push|push image)\b/i,
];

/**
 * Layer 2 applied to the failing step. Rejects or says nothing.
 *
 * The return type is `CiRejection | null`, and both halves are deliberate.
 * `null` means "this layer has no opinion", which is different from "this
 * layer vouches for it". `CiRejection` has no member that approves, so a
 * heuristic that tried to vouch would not compile -- the asymmetry is checked
 * by tsc rather than trusted to whoever edits the pattern list next.
 */
export function classifyFailingStep(step: StepFacts | null): CiRejection | null {
  const name = (step?.name ?? '').trim();
  if (name === '') return null;
  return INFRASTRUCTURE_STEP_PATTERNS.some((pattern) => pattern.test(name))
    ? reject('FAILING_STEP_IS_INFRASTRUCTURE', name)
    : null;
}

/**
 * Layer 2, part two: log lines that name a failure of the machine rather than
 * of the code.
 *
 * NOT DOCUMENTED. These are the strings npm, pnpm, git, curl, Docker and the
 * Actions runner print when the world outside the repository breaks. They were
 * written from what those tools emit, they are not read from any specification,
 * and they will go stale as those tools change their wording.
 *
 * Every pattern names a resource the repository does not control: DNS, a
 * registry, a mirror, a runner, a credential, a disk. Nothing here matches an
 * assertion failure, a compile error, a type error or a non-zero exit from a
 * test runner, which are the things a defect looks like.
 *
 * A deliberate omission: out-of-memory. A suite that exhausts the runner's
 * memory may be a leak the repository introduced or may be a runner smaller
 * than the job needs, and this module cannot tell which. Rejecting it would
 * hide a real class of defect, so it is left to fall through rather than
 * guessed at here.
 */
const INFRASTRUCTURE_LOG_PATTERNS: readonly RegExp[] = [
  /* The runner itself. */
  /The runner has received a shutdown signal/i,
  /lost communication with the server/i,
  /The operation was canceled/i,
  /No space left on device/i,
  /Received request to deprovision/i,

  /* Name resolution and transport. */
  /getaddrinfo (ENOTFOUND|EAI_AGAIN)/i,
  /Temporary failure in name resolution/i,
  /Could not resolve host/i,
  /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)\b/,
  /TLS handshake timeout/i,
  /SSL_ERROR_SYSCALL/,

  /* Registries, mirrors and object stores answering badly. */
  /\b(429 Too Many Requests|502 Bad Gateway|503 Service Unavailable|504 Gateway Time-?out)\b/i,
  /npm ERR! network/i,
  /ERR_PNPM_FETCH_/,
  /error: RPC failed/i,
  /fatal: unable to access/i,
  /The requested URL returned error: 5\d\d/,
  /failed to (fetch|download) (metadata|oauth token|the )/i,

  /* Credentials and quota. */
  /API rate limit exceeded/i,
  /\bBad credentials\b/,
  /remote: Repository not found/i,
  /(authentication|authorization) (required|failed)/i,
  /toomanyrequests: (You have reached|Rate exceeded)/i,
];

/**
 * Scans a log excerpt and rejects if it names an infrastructure failure.
 *
 * Returns `null` when it has no opinion -- see `classifyFailingStep()` for why
 * that is not the same as approval. The caller passes a bounded tail rather
 * than a whole log; see `MAX_LOG_SCAN_BYTES` and `logTail()`.
 */
export function classifyFailureLog(log: string): CiRejection | null {
  if (typeof log !== 'string' || log === '') return null;
  for (const pattern of INFRASTRUCTURE_LOG_PATTERNS) {
    const match = pattern.exec(log);
    if (match !== null) return reject('INFRASTRUCTURE_IN_LOG', lineAround(log, match.index));
  }
  return null;
}

/**
 * The whole line a match fell on.
 *
 * A bare match is `ECONNRESET` and tells an operator nothing they did not
 * already have from the reason code. The line it sits on is the thing worth
 * putting in front of them, and `quote()` bounds it.
 */
function lineAround(log: string, at: number): string {
  const start = log.lastIndexOf('\n', at) + 1;
  const end = log.indexOf('\n', at);
  return log.slice(start, end === -1 ? undefined : end);
}

/**
 * How much of a job log is worth scanning, in bytes, taken from the end.
 *
 * A failing job's log is routinely tens of megabytes -- a matrix of browser
 * tests with debug logging on will produce more -- and holding one in memory on
 * a worker is a way to lose the worker. The end is the part that matters: the
 * runner writes its own diagnosis last, and a registry or DNS failure aborts
 * the step it happened in, so the message is at the tail of what was written.
 *
 * The name says bytes and the unit is JavaScript string length, which is UTF-16
 * code units. For the ASCII a runner writes those are the same number. For a
 * log with non-ASCII text in it they are not: 262,144 characters of two-byte
 * UTF-8 is 512 KiB. The bound is therefore an upper bound on characters scanned
 * and only an approximate one on memory. Counting real bytes would mean
 * encoding the log to find out where to cut it, which costs the allocation the
 * bound exists to avoid.
 */
export const MAX_LOG_SCAN_BYTES = 262_144;

/** The last `MAX_LOG_SCAN_BYTES` of a log, for `classifyFailureLog()`. */
export function logTail(log: string): string {
  return log.length <= MAX_LOG_SCAN_BYTES ? log : log.slice(-MAX_LOG_SCAN_BYTES);
}
