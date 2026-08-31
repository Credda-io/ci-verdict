# ci-verdict

[![Apache-2.0](https://img.shields.io/badge/licence-Apache--2.0-informational)](LICENSE)
[![zero dependencies](https://img.shields.io/badge/dependencies-none-informational)](test/package.test.ts)

**Is this red CI run our bug, or was it the runner?**

Every engineer with CI has that question and nobody ships a careful answer. A
red GitHub Actions run is not evidence that the code is broken. It is equally
likely to be a runner reclaimed mid-job, an npm registry that returned 503, a
checkout that could not reach github.com, an expired cloud credential, or a job
somebody cancelled by pressing the button.

Anything that reacts to a red run — a bot that files an issue, a dashboard that
counts flakiness, an on-call rota, an agent that opens an investigation — has to
answer that question first. Most of them guess. This library answers it, says
which layer of evidence decided, and is careful about the difference between
"this is not a defect" and "I have no opinion".

- **Zero runtime dependencies.** Not "few". None. No Node builtins either — the
  source imports nothing but itself, so it runs unchanged on Node, Deno, Bun, a
  browser, and an edge worker. There is a [test](test/package.test.ts) that
  fails if that stops being true.
- **Pure and total.** No I/O, no network, no clock, no throw. You hand it JSON
  you already have; it hands you a verdict.
- **204 tests**, 143 of them on the classifier itself -- including one per entry in BOTH heuristic pattern lists, the log lines and the step names, each asserted to be the pattern that DECIDED its own sample rather than merely to match it. The step list had no such audit until 2026-08-30, and one of its patterns could be deleted with the whole suite still green.
- **Never measured against real runs.** The tests say it reads GitHub's enums
  correctly; nobody has scored its two heuristics, or its default, against a
  labelled set of real red runs, because none exists. [What that would
  take](#has-any-of-this-been-measured-no--and-here-is-what-it-would-take).

Apache-2.0. Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Vulnerabilities:
[SECURITY.md](SECURITY.md), privately.

### Why it is a package of its own

Because the question is upstream of everybody who has it, and nobody's answer is
reusable while it lives inside their bot. A dashboard that counts flakiness, an
on-call rota, an issue filer and an agent that opens an investigation all need
this decision made before they act, and all four otherwise make it with a regex
somebody wrote in an afternoon. Extracting it means the reasoning can be read,
the enum handling can be audited against GitHub's own documentation, and the
asymmetry that makes it trustworthy -- a heuristic may reject, never approve --
can be enforced by the type system instead of by a comment.

### What it has to do with Credda

This is the failing-CI classifier from [Credda](https://credda.io), extracted
and published on its own. Credda takes a bug report or security vulnerability a
customer has labelled, reproduces the failure, diagnoses the cause, writes the
patch, proves it with a test that fails before and passes after, and hands back
a diff. It runs in your own CI. Whether that diff becomes a
pull request depends on which mechanism delivered it, and the two answer
differently: the **GitHub App** path opens one with no flag and no switch, for a
run that reaches `READY_FOR_REVIEW` with a proven verdict; the **GitHub Action**
opens none unless you set its `open-pull-request` input, which defaults to
`false`, **and** add `contents: write` and `pull-requests: write` to your own
workflow's `permissions:` block, which a default install does not grant. Turning
the input on without both scopes fails at that step rather than opening
anything -- and that input is declared on no version a caller can reach: it is
absent from `action.yml` at the `v1` tag and on the action's default branch
alike, so setting it today parses, runs green and delivers nothing. How often a
run reaches a proven fix at all has not been measured. It proposes and never
merges.

Everything in that sentence rests on a red run meaning something. An agent that
investigates an npm registry outage as though it were a defect wastes a sandbox
and files a confident, wrong claim about somebody's repository -- which is why
this decision is made first, made from GitHub's own documented enums where it
can be, and made cautiously where it cannot.

## Install

```
npm install ci-verdict
```

> **Not on npm yet — checked 2026-08-30.** `https://registry.npmjs.org/ci-verdict`
> returns 404, so the command above fails today. Until `0.1.0` is published, use
> it from a checkout of this repository. This is the only claim in this README
> that is about the future; everything below is about the code in this repo, and
> the test counts are real (`npm test`).

## Use it

```ts
import { ciVerdict } from 'ci-verdict';

// `workflowRun` is a parsed `workflow_run` webhook delivery, or anything with
// the same `{ action, repository, workflow_run }` shape. `jobs` and `log` are
// optional — see "How much evidence to give it" below.
const verdict = ciVerdict({
  workflowRun: delivery,
  jobs: await jobsForRun(delivery.workflow_run.id), // optional
  log: await logForFailingJob(jobId),               // optional
});

if (verdict.attributable) {
  fileTheIssue();
} else {
  console.log(`ignoring this red run: ${verdict.reason} — ${verdict.explanation}`);
}
```

`CiAttribution` is a discriminated union, so reading `reason` off an
attributable verdict does not compile:

```ts
type CiAttribution =
  | { attributable: true }
  | {
      attributable: false;
      reason: CiNotADefectReason;
      explanation: string;
      layer: 'documented' | 'heuristic';
      evidence: string | null;
    };
```

`layer` says which of the two layers below decided, so a caller who wants to
act only on the certain half can write `verdict.layer === 'documented'` instead
of hardcoding a list of reason codes that goes stale the next time one is
added. `evidence` is the one thing that decided it — the conclusion, the
triggering event, the branch, the failing job or step name, the log line a
pattern matched — and null when the reason is the *absence* of a field, since
then there is nothing to show. See "Evidence is payload text" before you log
it.

`npm run example` builds the package and runs [four real-shaped
runs](examples/three-runs.mjs) through it. Its actual output:

```
A genuine test failure — a vitest assertion on the default branch
  {
    "attributable": true
  }

A cancelled run — somebody pressed the button
  {
    "attributable": false,
    "reason": "RUN_CANCELLED",
    "explanation": "the run was cancelled, which says a person or a policy stopped it and nothing about the code",
    "layer": "documented",
    "evidence": "cancelled"
  }

An infrastructure failure — the npm registry answered 503 during install
  {
    "attributable": false,
    "reason": "FAILING_STEP_IS_INFRASTRUCTURE",
    "explanation": "the step that failed sets up the job rather than exercising the code -- a checkout, a toolchain install, a cache or an artifact transfer -- so the break is in the pipeline rather than in the repository",
    "layer": "heuristic",
    "evidence": "Install dependencies"
  }

An infrastructure failure — a self-hosted runner died mid-suite, log only
  {
    "attributable": false,
    "reason": "INFRASTRUCTURE_IN_LOG",
    "explanation": "the log of the failing step names a network, registry, runner or credential failure, which is a failure of the infrastructure the tests ran on rather than of the code they tested",
    "layer": "heuristic",
    "evidence": "2026-08-24T10:52:18.7000000Z The self-hosted runner: builder-07 lost communication with the server."
  }
```

That block is not transcribed. [`test/readme.test.ts`](test/readme.test.ts)
renders it from the same four cases the example runs
([`examples/cases.mjs`](examples/cases.mjs)) and fails if this file does not
contain it verbatim, so a changed explanation cannot be fixed in the code and
left wrong here. The same four cases are also asserted against the library in
[`test/verdict.test.ts`](test/verdict.test.ts).

## The two layers, and why one of them may only ever say no

This is the design, and it is the reason to trust the library rather than write
your own regexes.

### Layer 1 is documented

It reads GitHub's own enums and nothing else. `cancelled`, `timed_out`,
`stale`, `action_required`, `skipped` and `neutral` are GitHub telling you, in
its own published vocabulary, that the run did not fail on the merits. A run
whose `head_branch` is not the repository's `default_branch` is somebody's work
in progress rather than a break. A run whose triggering `event` is
`pull_request` is a build of code nobody has decided to keep yet.

Every value the classifier compares against was read from GitHub's REST
documentation on 2026-08-25, and the URLs and the field lists are in the
docblock of [`src/attribution.ts`](src/attribution.ts) so the enum handling is
auditable rather than remembered. This layer carries the weight.

Note one thing layer 1 does *not* do: an **unrecognised** `conclusion` is
treated as *not a failure*. If GitHub adds an enum value tomorrow, you get
`RUN_DID_NOT_FAIL`, not a wave of false reports.

### Layer 2 is heuristic and says so

Step names and log substrings are documented nowhere. GitHub publishes no list
of the steps it generates and no naming convention for the ones you write, and
npm, pnpm, git, curl, Docker and the Actions runner change their wording
whenever they like. The patterns in this library are its own reading of what
those tools print, and they will go stale.

So they are given exactly one power: **they may reject, never approve.**

```ts
type CiRejection = Extract<CiAttribution, { attributable: false }>;

function classifyFailingStep(step: StepFacts | null): CiRejection | null;
function classifyFailureLog(log: string): CiRejection | null;
```

`null` means *no opinion*. It is a different thing from approval, and
`CiRejection` has no member that means "I vouch for this", so a heuristic here
that tried to return `{ attributable: true }` does not compile. The asymmetry is
checked by tsc, not left to a convention someone can forget. `CiRejection` is
exported if you want to hold a rejection in your own code.

The reason is a cost argument. A heuristic that fires wrongly costs one red run
ignored — annoying, recoverable, and visible if you count reason codes. A
heuristic *trusted to accept* would cost a confident, wrong claim that your
repository is at fault. Those are not the same size of mistake, so they do not
get the same amount of trust.

One deliberate omission worth knowing about: **out-of-memory is not treated as
infrastructure.** A suite that exhausts the runner's memory may be a leak you
introduced or may be a runner smaller than the job needs, and this library
cannot tell which. Rejecting it would hide a real class of defect, so it falls
through. There is a test that pins that behaviour.

### Evidence is payload text

`explanation` is this library's own sentence and quotes nothing. `evidence` is
the opposite: it is the branch name, the step name or the log line, and every
one of those was written by whoever opened the pull request or by whatever the
job printed. It is handed back because a rejection you cannot explain to the
person who filed it is a rejection you cannot argue with — the reason code says
`FAILING_STEP_IS_INFRASTRUCTURE`, and the only thing that settles whether that
was right is knowing the step was called `Install dependencies`.

What is done to it before you get it: every control character becomes a space,
so an ESC cannot start a terminal escape sequence in your log and a CR cannot
overwrite the line above it; runs of whitespace collapse; the result is cut to
`MAX_EVIDENCE_LENGTH` (200) characters, so one minified line in a log cannot
become a megabyte in your database.

What is not done to it: it is not escaped for HTML, for a shell, or for SQL,
and it is not validated to be anything. **Display it; do not parse it, and
escape it wherever you put it.** If you would rather not hold attacker-written
text at all, ignore the field — everything else in the verdict is this
library's own vocabulary.

## The known limitation, stated plainly

**The default for an unrecognised failure is `attributable`.**

Layer 1 removes the large documented categories. Layer 2 removes the
infrastructure failures whose wording it recognises. Whatever is left is
returned as the repository's own. So an infrastructure failure that nothing here
matches — a new pnpm error string, an internal artifact proxy with its own
vocabulary, a corporate mirror that fails in a way nobody has seen — comes back
`{ attributable: true }`.

That is a real cost and it is the right default anyway. The alternative —
refusing everything not positively recognised as a defect — requires a heuristic
that can *approve*, and that is the one thing this design forbids. A pattern
list good enough to be an allowlist does not exist, and pretending otherwise
would make every verdict as weak as the weakest guess in it.

What to do about the residue: gate on something **structural** downstream rather
than on another guess. A file and a line from a check-run annotation. A named
failing test. A command that reproduces. An infrastructure failure that slips
past both layers arrives with none of those, so a downstream requirement for one
catches it without anybody writing another regex. That gate is your policy and
is deliberately not in this library.

## Has any of this been measured? No — and here is what it would take.

Nothing in this repository has ever spoken to GitHub. Every payload in
`test/` and in `examples/` was hand-written from the field lists GitHub
publishes, cited by URL in `src/attribution.ts`. So there is no labelled set of
real red runs here, and none anywhere else in the codebase this library was cut
out of. **No number in this README is an accuracy number, because none has been
earned.** That is a statement of fact, not modesty, and it should stay here
until somebody changes it by measuring.

**Most of the surface could not be measured anyway, and that is fine.** 14 of
the 16 reason codes are layer 1: they read back an enum GitHub documents.
`RUN_CANCELLED` fires when `conclusion` is `cancelled`. There is no ground truth
to compare that against that is not the same field read a second time —
labelling it would be circular. What layer 1 can be wrong about is *reading*,
and reading is what `test/attribution.test.ts` checks.

Three claims are genuinely falsifiable, and each needs different evidence:

1. **Layer-2 precision.** When `FAILING_STEP_IS_INFRASTRUCTURE` or
   `INFRASTRUCTURE_IN_LOG` rejects a run, was the failure really the pipeline?
   A false rejection here silently drops a defect.
2. **The residue.** [The known limitation](#the-known-limitation-stated-plainly)
   says an unrecognised infrastructure failure comes back `attributable`. Nobody
   knows how often. This is the number that matters most, because it is the one
   the default is spending.
3. **Whether the layer-1 policy exclusions cost anything.**
   `TRIGGER_IS_NOT_A_MAINLINE_RUN` and `NOT_THE_DEFAULT_BRANCH` are choices, not
   errors — they discard real defects on purpose. Measuring them means asking
   whether the discarded ones were worth reporting, which is a product question
   with no ground truth at all.

**What an honest labelled set would require.**

- **A sample drawn before anything is classified.** A fixed list of public
  repositories and a fixed date window, written down first, so the sample is not
  selected by what this library says about it.
- **Deliveries plus jobs plus the failing job's log, per run.** The verdict
  changes with the evidence given (see [How much evidence to give
  it](#how-much-evidence-to-give-it)), so a corpus that is webhooks only can
  only measure layers 1 and 2a.
- **Forward capture, not a backfill.** Actions logs are retained for a limited
  window and the log download URL GitHub hands back expires in about a minute.
  A corpus of failing-job logs has to be collected as the runs happen. This is
  the expensive constraint: it is weeks of wall-clock before anything can be
  scored, not an afternoon of fetching.
- **A label that is not this library's opinion, and not a model's.** The only
  labels going that are neither a judgement nor a restatement of the input:
  a re-run of the *same commit with no code change* that succeeds is evidence of
  a non-repository failure; a failure that persists across subsequent commits
  until a code change clears it is evidence of a repository one. Both are
  execution, which is the right shape. Both are also imperfect, and the honest
  reading is narrow: a re-run that goes green can equally be a flaky *test*,
  which is the repository's own defect and should be attributable. Any corpus
  built this way has to report that ambiguity rather than round it away.

**Two ways of faking it, named so nobody reaches for them.** Labelling runs by
asking a model to read the log measures the model. Labelling them by having a
person read the log for words like "ECONNRESET" measures this library's keyword
list against itself and will score near perfect while proving nothing. A
measurement is only worth having when it can come back unflattering — which is
exactly what happened to `repro-check`, the sibling library, the first time it
was scored.

**What a deployment can do today.** Count the reason codes, as [Reason
codes](#reason-codes) describes. That distribution is a smoke test on your
pipeline — nine hundred `INFRASTRUCTURE_IN_LOG` in a thousand means your CI is
broken — and it is not a measurement of this library, because nothing in it
knows whether any single verdict was right. Do not report it as one.

## Reason codes

Codes rather than prose so you can count them. If your deployment rejects nine
hundred runs in a thousand as `NOT_THE_DEFAULT_BRANCH`, it is working correctly.
If it rejects nine hundred as `INFRASTRUCTURE_IN_LOG`, you have a broken CI and
no defect to find. The full list is exported as `CI_NOT_A_DEFECT_REASONS`.

### Layer 1 — run level (GitHub's documented enums)

| Code | Meaning |
| --- | --- |
| `RUN_NOT_COMPLETED` | The webhook `action` is not `completed`, or `status` is explicitly something other than `completed`. There is no outcome to attribute yet. A *missing* `status` is tolerated — some serializations omit it. |
| `RUN_DID_NOT_FAIL` | `conclusion` is not `failure`. Covers `success`, `neutral`, `skipped`, `null`, **and any value GitHub publishes after this was written**. |
| `RUN_CANCELLED` | `conclusion` is `cancelled`. A person or a policy stopped it; it says nothing about the code. |
| `RUN_TIMED_OUT` | `conclusion` is `timed_out`. A fact about the runner budget, not a specific reproducible failure. |
| `RUN_NEEDS_ACTION` | `conclusion` is `action_required`. Waiting on a human approval or an integration. |
| `RUN_STALE` | `conclusion` is `stale`. Superseded before it could produce a verdict, so the result describes nothing. |
| `TRIGGER_IS_NOT_A_MAINLINE_RUN` | `event` is not `push`, `schedule` or `workflow_dispatch`. `pull_request` is the loud omission: a red PR build is the normal state of somebody's afternoon and is already in front of its author. |
| `DEFAULT_BRANCH_NOT_STATED` | The payload carried no `repository.default_branch`. Fails closed — guessing `main` is wrong for every repository that never renamed `master`. |
| `NOT_THE_DEFAULT_BRANCH` | `head_branch` is not the default branch. A red topic branch is expected work in progress. |
| `RUN_PAYLOAD_INCOMPLETE` | No `repository.full_name` or no `workflow_run.path`. Nothing to key a report on. |

### Layer 1 — job level (GitHub's documented enums)

Emitted only when you pass `jobs`.

| Code | Meaning |
| --- | --- |
| `NO_JOB_FAILED` | No job concluded `failure`. The run reports red without a job that broke. |
| `JOB_CANCELLED` | The only non-green jobs were `cancelled` — usually a sibling failing first, or a person stopping the run. |
| `JOB_TIMED_OUT` | A job hit its time limit rather than failing on the merits. Preferred over `JOB_CANCELLED` when both appear, because a cancelled sibling is normally a consequence of the one that timed out. |
| `JOB_NEEDS_ACTION` | A job is waiting on a human approval or an integration. |

### Layer 2 — heuristic (may only reject)

| Code | Meaning |
| --- | --- |
| `FAILING_STEP_IS_INFRASTRUCTURE` | The first step concluding `failure` is named like job setup rather than like exercising code: `Set up job`, `Checkout`, `Set up Node`, `Install dependencies`, `npm ci`, `Restore cache`, `Upload artifact`, `Login to GHCR`, `Configure AWS credentials`, `Build and push`, and friends. Anchored at the start of the name, case-insensitive. |
| `INFRASTRUCTURE_IN_LOG` | The log names a resource the repository does not control: DNS (`getaddrinfo EAI_AGAIN`, `Could not resolve host`), transport (`ECONNRESET`, `TLS handshake timeout`), a registry or mirror answering badly (`503 Service Unavailable`, `npm ERR! network`, `ERR_PNPM_FETCH_`, `fatal: unable to access`), the runner itself (`The runner has received a shutdown signal`, `lost communication with the server`, `No space left on device`), or a credential and quota (`Bad credentials`, `API rate limit exceeded`, `toomanyrequests`). Nothing in the list matches an assertion failure, a compile error, a type error, or a non-zero exit from a test runner. |

A known false positive, accepted on purpose: a repository that genuinely names
its *test* step "Install dependencies" gets skipped. That is a rarity, and the
alternative is filing against every repository whose lockfile install flakes.

## How much evidence to give it

`jobs` and `log` are optional, and omitting them gives a **weaker verdict, not a
different one**. It can still say no; it just has fewer ways to.

| You have | Layers that run | Typical use |
| --- | --- | --- |
| The webhook delivery only | Layer 1, run level | Cheap filter at ingest. Throws out cancellations, PR builds, topic branches and non-failures without a single API call. |
| ...plus the jobs listing | + layer 1 job level, + layer 2 step names | Catches matrix cancellations and setup-step failures. One extra request. |
| ...plus the failing job's log | + layer 2 log | Catches registry, DNS, runner and credential failures that the step name did not reveal. |

`ciVerdict()` runs them in that order and returns the **first** rejection, so
the reason you record is the most specific true one — a cancelled pull request
build is reported as `RUN_CANCELLED`, not as off-mainline, because cancelled is
the fact that decides it.

Logs are large; `ciVerdict()` takes the last `MAX_LOG_SCAN_BYTES` (262,144) for
you, so you cannot forget to. The end is the part that matters: the runner
writes its own diagnosis last, and a registry or DNS failure aborts the step it
happened in.

The name says bytes and the unit is string length, which is UTF-16 code units.
For the ASCII a runner writes those are the same number; for a log carrying
non-ASCII text they are not, and 262,144 characters of two-byte UTF-8 is 512
KiB. Treat it as a bound on characters scanned and an approximate one on memory.
If your logs are large *and* non-ASCII, slice to a byte budget yourself before
handing the log over.

## Lower-level API

Every layer is exported on its own, and they take plain records rather than raw
payloads, so you can test your own policy without a webhook body.

```ts
// Layer 1. Total, returns a verdict.
classifyWorkflowRun(facts: WorkflowRunFacts): CiAttribution
classifyJobOutcome(jobs: readonly JobFacts[]): CiAttribution

// Layer 2. May only reject; `null` means no opinion. `CiRejection` is the
// `attributable: false` half of `CiAttribution` and has no approving member,
// so these two signatures are the invariant rather than a note about it.
classifyFailingStep(step: StepFacts | null): CiRejection | null
classifyFailureLog(log: string): CiRejection | null

// Selection.
findFailedJob(jobs: readonly JobFacts[]): JobFacts | null
findFailedStep(job: JobFacts): StepFacts | null

// Payload adapters. Total: bad JSON becomes absent facts, never a throw.
workflowRunFactsFrom(payload: unknown): WorkflowRunFacts
jobFactsListFrom(payload: unknown): readonly JobFacts[]
jobFactsFrom(value: unknown): JobFacts

// Bounded log handling.
logTail(log: string): string
MAX_LOG_SCAN_BYTES: number

CI_NOT_A_DEFECT_REASONS: readonly CiNotADefectReason[]
```

`findFailedJob` takes the **first** job concluding `failure`, not the first that
is not green: in a matrix, one genuine failure cancels its siblings, and picking
a cancelled sibling would blame whichever shard the API listed first.
`findFailedStep` takes the **first** step concluding `failure`, because later
steps in a failed job are `skipped`. Both return `null` rather than blaming
something when the payload carried nothing.

Rejection `explanation` strings are the library's own sentences and never
interpolate anything off the payload, because they end up in your log lines and
your database rows. There is a test for that.

## Also here: `resolvePackageManager`

The neighbouring question. Having decided a red run is worth looking at, the
next thing anyone needs is a way to actually build the repository — and sending
a pnpm, yarn or bun repository to `npm install` resolves a different dependency
tree than the author's, so every failure that follows is unattributable too.

```ts
import { resolvePackageManager, relaxedInstall } from 'ci-verdict';

const resolved = resolvePackageManager({
  rootEntries: new Set(await readdir(repoRoot)),
  packageJson: await maybeRead('package.json'),
  yarnLock: await maybeRead('yarn.lock'),   // head is enough
  pnpmLock: await maybeRead('pnpm-lock.yaml'),
});
// { manager: 'pnpm', version: '9.1.0', evidence: 'packageManager',
//   commands: [['pnpm', 'install', '--frozen-lockfile']] }
```

Pure, like the rest: it reads a record of root facts and returns argv arrays. It
does not touch a filesystem or spawn anything — gathering the inputs is yours.

- Handles `npm`, `pnpm`, `yarn` (classic), `yarn-berry` and `bun`.
- `evidence` says what decided it: `packageManager` (a pin, the most
  authoritative — it names an exact version, which a lockfile cannot),
  `lockfile`, or `default`. `default` is spelled out rather than hidden because
  it is the one answer resting on nothing: npm is the right guess for a
  `package.json` with no lockfile and no pin, but it stays a guess and you can
  see that it was one.
- Yarn classic and berry are different programs sharing a name:
  `--frozen-lockfile` versus `--immutable`, each rejecting the other's. Guessing
  is a hard install failure, so `.yarnrc.yml` and the lockfile format marker are
  read to tell them apart.
- pnpm refuses a lockfile written by an older major outright
  (`ERR_PNPM_LOCKFILE_BREAKING_CHANGE`), so lockfile formats 5.x and 6.x pin
  pnpm 7 and 8 via `corepack prepare`. Format 9.0 is read by pnpm 9, 10 and 11
  alike and is left to corepack rather than pinned to a guess.
- Returns `null` when there is no `package.json`. No manifest, no dependency
  graph, and inventing an install command for one is how provisioning fails for
  a repository that never needed it.

`relaxedInstall(command)` rewrites one of those strict installs into one that
tolerates lockfile drift — `npm ci` → `npm install`, `pnpm install
--frozen-lockfile` → `pnpm install --no-frozen-lockfile` (pnpm needs the
*negation*, because `CI=true` makes frozen the default). Fire it **only after a
real non-zero exit** from the strict install: a timeout is a slow network or a
wedged process, not a lockfile disagreement. It returns `null` for a command
with nothing to relax, which is what stops it firing twice on one failure, and
`null` for a command it does not understand rather than inventing a fallback for
somebody else's build.

## Development

```
npm install
npm run typecheck   # tsc, strict, noUncheckedIndexedAccess
npm test            # vitest; the count is in the summary above, not here twice
npm run build       # tsc → dist/, ESM + .d.ts
npm run check:readme # the two test counts above, against the tests collected
npm run check       # all four
npm run example     # build, then run the four worked runs
```

`tsconfig.build.json` compiles `src` with `"types": []` and `"lib": ["ES2022"]`.
Nothing ambient, no host API — which is the mechanical version of the
zero-dependency claim, alongside the audit in `test/package.test.ts` that reads
every source file and fails on any specifier that is not a relative path inside
`src/`.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the four rules that are not negotiable --
the zero-import constraint, the reject-only asymmetry, totality, and citing
GitHub's documentation for every enum -- and what a new layer-2 pattern has to
clear before it is added.

Security: [SECURITY.md](SECURITY.md). Everything this package reads came off an
attacker-influenced payload, and it is written that way on purpose.
