/**
 * Which package manager a repository installs with, and how.
 *
 * This is the neighbouring question to the one the rest of this package
 * answers. Having decided a red run is worth looking at, the next thing anyone
 * needs is a way to build the repository -- and sending a pnpm, yarn or bun
 * repository to `npm install` resolves a different dependency tree than the
 * author's, so every failure that follows is unattributable: you cannot say
 * whether *this change* broke something if you are talking about a tree nobody
 * has ever built. A `packageManager` pin says more still -- it names an exact
 * version, which a lockfile cannot.
 *
 * So the manager is decided from evidence, the evidence is recorded on the
 * result, and no branch quietly falls through to npm.
 *
 * Pure and total, like everything else here: it reads a record of repository
 * root facts and returns argv arrays. It does not touch a filesystem, spawn a
 * process, or know what a container is. Gathering the inputs is the caller's
 * job, which is what makes this testable without one.
 */

export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'yarn-berry', 'bun'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/**
 * What decided the manager, most authoritative first.
 *
 * `default` is spelled out rather than hidden because it is the one answer that
 * rests on nothing: a `package.json` with no lockfile and no pin. npm is the
 * right guess there -- it is what ships with node -- but it stays a guess, and
 * whoever reads the result can see that it was one.
 */
export type PackageManagerEvidence = 'packageManager' | 'lockfile' | 'default';

export interface PackageManagerResolution {
  readonly manager: PackageManager;
  /** The version the repository pinned, or one derived from its lockfile format. */
  readonly version: string | null;
  readonly evidence: PackageManagerEvidence;
  /** argv arrays, to be run in order with the network up. */
  readonly commands: readonly (readonly string[])[];
}

/** The repository-root facts the decision is made from. */
export interface ToolchainInputs {
  /** Entry names in the repository root. */
  readonly rootEntries: ReadonlySet<string>;
  readonly packageJson: string | null;
  /** Head of `yarn.lock`; only its format marker is read. */
  readonly yarnLock: string | null;
  /** Head of `pnpm-lock.yaml`; only `lockfileVersion` is read. */
  readonly pnpmLock: string | null;
}

/**
 * A `packageManager` field, e.g. `pnpm@9.1.0` or `yarn@4.1.0+sha224.<hash>`.
 *
 * Anchored and narrow on purpose. Nothing parsed here need ever reach an argv
 * -- corepack reads the field itself, out of the file -- but a version that is
 * recorded should still be a version.
 */
const PACKAGE_MANAGER_FIELD = /^(npm|pnpm|yarn|bun)@(\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?)(?:\+|$)/;

interface Pin {
  readonly name: 'npm' | 'pnpm' | 'yarn' | 'bun';
  readonly version: string;
}

function readPin(packageJson: string | null): Pin | null {
  if (packageJson === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJson);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const field = (parsed as Record<string, unknown>)['packageManager'];
  if (typeof field !== 'string') return null;
  const match = PACKAGE_MANAGER_FIELD.exec(field.trim());
  if (match === null) return null;
  return { name: match[1] as Pin['name'], version: match[2] as string };
}

function majorOf(version: string): number {
  return Number.parseInt(version.split('.')[0] ?? '', 10);
}

/**
 * Yarn 1 and Yarn 2+ are different programs sharing a name, and the flag that
 * makes an install honour the lockfile is spelled differently in each:
 * `--frozen-lockfile` in classic, `--immutable` in berry, each rejecting the
 * other's. Getting this wrong is a hard install failure, not a slow path.
 */
function yarnIsBerry(inputs: ToolchainInputs): boolean {
  // `.yarnrc.yml` is berry-only; classic reads `.yarnrc`.
  if (inputs.rootEntries.has('.yarnrc.yml')) return true;
  const lock = inputs.yarnLock;
  if (lock === null) return false;
  if (/^# yarn lockfile v1/m.test(lock)) return false;
  return /^__metadata:/m.test(lock);
}

/**
 * pnpm refuses a lockfile written by an older major outright
 * (`ERR_PNPM_LOCKFILE_BREAKING_CHANGE`), so a repository that does not pin
 * `packageManager` gets corepack's default and fails. The lockfile format is
 * the only version evidence such a repository has, and these are the two
 * mappings that are unambiguous. Format 9.0 is read by pnpm 9, 10 and 11 alike,
 * so it is left to corepack rather than pinned to a guess.
 */
function pnpmMajorForLockfile(lockfileVersion: string | null): string | null {
  if (lockfileVersion === null) return null;
  if (lockfileVersion.startsWith('5.')) return '7';
  if (lockfileVersion.startsWith('6.')) return '8';
  return null;
}

function pnpmLockfileVersion(pnpmLock: string | null): string | null {
  if (pnpmLock === null) return null;
  const match = /^lockfileVersion:\s*['"]?(\d+(?:\.\d+)?)/m.exec(pnpmLock);
  return match === null ? null : (match[1] as string);
}

function npmInstall(inputs: ToolchainInputs): readonly string[] {
  // `npm ci` installs exactly what the lockfile pins; `npm install` resolves
  // fresh, which is a different tree from the author's.
  return inputs.rootEntries.has('package-lock.json') ||
    inputs.rootEntries.has('npm-shrinkwrap.json')
    ? ['npm', 'ci']
    : ['npm', 'install'];
}

function bunInstall(inputs: ToolchainInputs): readonly string[] {
  return inputs.rootEntries.has('bun.lock') || inputs.rootEntries.has('bun.lockb')
    ? ['bun', 'install', '--frozen-lockfile']
    : ['bun', 'install'];
}

function pnpmCommands(version: string | null): readonly (readonly string[])[] {
  const install = ['pnpm', 'install', '--frozen-lockfile'];
  // `--activate` makes the shim use this version for every later `pnpm`, so the
  // repository's own test script runs on it too.
  return version === null
    ? [install]
    : [['corepack', 'prepare', `pnpm@${version}`, '--activate'], install];
}

function yarnInstall(berry: boolean): readonly string[] {
  return berry ? ['yarn', 'install', '--immutable'] : ['yarn', 'install', '--frozen-lockfile'];
}

/**
 * Returns null when there is nothing to install: no `package.json` means no
 * dependency graph, and inventing an install command for one is how
 * provisioning fails for a repository that never needed it.
 */
export function resolvePackageManager(inputs: ToolchainInputs): PackageManagerResolution | null {
  if (!inputs.rootEntries.has('package.json')) return null;

  const pin = readPin(inputs.packageJson);
  if (pin !== null) {
    switch (pin.name) {
      case 'npm':
        return {
          manager: 'npm',
          version: pin.version,
          evidence: 'packageManager',
          commands: [npmInstall(inputs)],
        };
      case 'pnpm':
        // corepack reads `packageManager` out of the file and downloads exactly
        // that version, so the pin is honoured without a repository-supplied
        // string ever entering an argv.
        return {
          manager: 'pnpm',
          version: pin.version,
          evidence: 'packageManager',
          commands: pnpmCommands(null),
        };
      case 'yarn': {
        const berry = majorOf(pin.version) >= 2;
        return {
          manager: berry ? 'yarn-berry' : 'yarn',
          version: pin.version,
          evidence: 'packageManager',
          commands: [yarnInstall(berry)],
        };
      }
      case 'bun':
        // corepack does not manage bun, so the repository's pin is recorded and
        // cannot be honoured: whatever bun is on PATH is the one that runs.
        return {
          manager: 'bun',
          version: pin.version,
          evidence: 'packageManager',
          commands: [bunInstall(inputs)],
        };
    }
  }

  if (inputs.rootEntries.has('pnpm-lock.yaml')) {
    const version = pnpmMajorForLockfile(pnpmLockfileVersion(inputs.pnpmLock));
    return { manager: 'pnpm', version, evidence: 'lockfile', commands: pnpmCommands(version) };
  }
  if (inputs.rootEntries.has('yarn.lock')) {
    const berry = yarnIsBerry(inputs);
    return {
      manager: berry ? 'yarn-berry' : 'yarn',
      version: null,
      evidence: 'lockfile',
      commands: [yarnInstall(berry)],
    };
  }
  if (inputs.rootEntries.has('bun.lock') || inputs.rootEntries.has('bun.lockb')) {
    return { manager: 'bun', version: null, evidence: 'lockfile', commands: [bunInstall(inputs)] };
  }
  if (
    inputs.rootEntries.has('package-lock.json') ||
    inputs.rootEntries.has('npm-shrinkwrap.json')
  ) {
    return { manager: 'npm', version: null, evidence: 'lockfile', commands: [npmInstall(inputs)] };
  }
  return { manager: 'npm', version: null, evidence: 'default', commands: [npmInstall(inputs)] };
}

/**
 * The same install with the lockfile treated as a hint instead of a contract.
 *
 * Every command above pins the lockfile deliberately -- a freshly resolved tree
 * is not the author's tree, and a failure in one is unattributable. That
 * argument holds right up until the strict install cannot run at all, at which
 * point the choice is not "author's tree vs a different tree" but "a different
 * tree vs nothing".
 *
 * MEASURED 2026-08-25 (node 24, npm 11.17.0), on a repository whose
 * `package-lock.json` is lockfileVersion 1 and carries one `github:`
 * dependency:
 *
 *   npm error code EUSAGE
 *   npm error `npm ci` can only install packages when your package.json and
 *   package-lock.json or npm-shrinkwrap.json are in sync.
 *   npm error Invalid: lock file's v8-argv@ does not satisfy v8-argv@1.1.1
 *
 * npm's v1 lockfile fix-up refetches metadata from the registry and cannot
 * reconstruct a version for a git-spec entry, so the converted lockfile fails
 * its own sync check and `npm ci` refuses. It is not repairable in place: the
 * lockfile on disk is what the author committed. `npm install` on the identical
 * tree resolved 82 packages and exited 0 in 8s.
 *
 * That class is not one repository's -- any v1 lockfile with a git dependency
 * hits it, and the yarn/pnpm/bun equivalents have the same shape -- so the
 * relaxation is expressed per manager rather than per repository.
 *
 * Returns null when a command has nothing to relax (`npm install` already is
 * the fallback, `corepack prepare` is not an install), which is what keeps this
 * from firing twice on the same failure.
 *
 * Fire it only after a real non-zero exit from the strict install. A timeout is
 * not a lockfile disagreement -- it is a slow network or a wedged process -- and
 * relaxing the lockfile in response would resolve a different tree for a reason
 * that has nothing to do with the lockfile.
 */
export function relaxedInstall(command: readonly string[]): readonly string[] | null {
  const [executable, subcommand, ...flags] = command;
  if (executable === undefined) return null;

  switch (executable) {
    case 'npm':
      // `npm ci` is the only strict form npm has; `npm install` is the relaxed one.
      return subcommand === 'ci' ? ['npm', 'install', ...flags] : null;
    case 'yarn':
      // Classic spells it --frozen-lockfile, berry --immutable. Dropping either
      // leaves a plain `yarn install`, which both accept.
      return flags.includes('--frozen-lockfile') || flags.includes('--immutable')
        ? [
            'yarn',
            'install',
            ...flags.filter((f) => f !== '--frozen-lockfile' && f !== '--immutable'),
          ]
        : null;
    case 'pnpm':
      // pnpm needs the negated flag, not the absence of one: CI=true makes
      // --frozen-lockfile the default, and the environment does not say.
      return flags.includes('--frozen-lockfile')
        ? [
            'pnpm',
            'install',
            '--no-frozen-lockfile',
            ...flags.filter((f) => f !== '--frozen-lockfile'),
          ]
        : null;
    case 'bun':
      return flags.includes('--frozen-lockfile')
        ? ['bun', 'install', ...flags.filter((f) => f !== '--frozen-lockfile')]
        : null;
    default:
      return null;
  }
}
