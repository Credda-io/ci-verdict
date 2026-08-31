/**
 * Package-manager resolution.
 *
 * Runs anywhere -- no container, no filesystem -- because this is the decision
 * that sends a repository to the wrong installer, and it should be provable on
 * a laptop.
 */

import { describe, expect, it } from 'vitest';

import { relaxedInstall, resolvePackageManager } from '../src/toolchain.js';
import type { ToolchainInputs } from '../src/toolchain.js';

function inputs(
  entries: readonly string[],
  overrides: Partial<ToolchainInputs> = {},
): ToolchainInputs {
  return {
    rootEntries: new Set(entries),
    packageJson: null,
    yarnLock: null,
    pnpmLock: null,
    ...overrides,
  };
}

const pinned = (spec: string): string => JSON.stringify({ name: 'x', packageManager: spec });

describe('resolvePackageManager', () => {
  it('returns null when there is no package.json, so nothing is installed', () => {
    expect(resolvePackageManager(inputs(['README.md', 'src']))).toBeNull();
    // Even with a stray lockfile: no manifest, no dependency graph.
    expect(resolvePackageManager(inputs(['pnpm-lock.yaml']))).toBeNull();
  });

  it('sends a pnpm repository to pnpm, never to npm', () => {
    const resolved = resolvePackageManager(inputs(['package.json', 'pnpm-lock.yaml']));
    expect(resolved?.manager).toBe('pnpm');
    expect(resolved?.evidence).toBe('lockfile');
    expect(resolved?.commands).toEqual([['pnpm', 'install', '--frozen-lockfile']]);
  });

  it('sends a bun repository to bun, never to npm', () => {
    for (const lock of ['bun.lockb', 'bun.lock']) {
      const resolved = resolvePackageManager(inputs(['package.json', lock]));
      expect(resolved?.manager).toBe('bun');
      expect(resolved?.commands).toEqual([['bun', 'install', '--frozen-lockfile']]);
    }
  });

  it('prefers the packageManager field over the lockfile', () => {
    // A repository that migrated to pnpm and left package-lock.json behind. The
    // pin is the newer, more specific fact, and it is what corepack will obey.
    const resolved = resolvePackageManager(
      inputs(['package.json', 'package-lock.json'], { packageJson: pinned('pnpm@9.1.0') }),
    );
    expect(resolved?.manager).toBe('pnpm');
    expect(resolved?.version).toBe('9.1.0');
    expect(resolved?.evidence).toBe('packageManager');
  });

  it('reads a packageManager field carrying an integrity hash', () => {
    const resolved = resolvePackageManager(
      inputs(['package.json'], { packageJson: pinned('yarn@4.1.0+sha224.abc123') }),
    );
    expect(resolved?.manager).toBe('yarn-berry');
    expect(resolved?.version).toBe('4.1.0');
  });

  it('ignores a packageManager field that is not a version, rather than trusting it', () => {
    const resolved = resolvePackageManager(
      inputs(['package.json', 'pnpm-lock.yaml'], { packageJson: pinned('pnpm@latest') }),
    );
    expect(resolved?.evidence).toBe('lockfile');
  });

  it('survives a package.json that is not valid JSON', () => {
    const resolved = resolvePackageManager(
      inputs(['package.json', 'yarn.lock'], { packageJson: '{ not json' }),
    );
    expect(resolved?.manager).toBe('yarn');
  });

  describe('yarn classic versus berry', () => {
    // The flags are not interchangeable: classic rejects --immutable and berry
    // rejects --frozen-lockfile, so guessing is a hard install failure.
    it('uses --frozen-lockfile for a v1 lockfile', () => {
      const resolved = resolvePackageManager(
        inputs(['package.json', 'yarn.lock'], {
          yarnLock: '# yarn lockfile v1\n\n\nleft-pad@1.3.0:\n',
        }),
      );
      expect(resolved?.manager).toBe('yarn');
      expect(resolved?.commands).toEqual([['yarn', 'install', '--frozen-lockfile']]);
    });

    it('uses --immutable for a berry lockfile', () => {
      const resolved = resolvePackageManager(
        inputs(['package.json', 'yarn.lock'], { yarnLock: '__metadata:\n  version: 8\n' }),
      );
      expect(resolved?.manager).toBe('yarn-berry');
      expect(resolved?.commands).toEqual([['yarn', 'install', '--immutable']]);
    });

    it('treats .yarnrc.yml as berry even without a readable lockfile', () => {
      const resolved = resolvePackageManager(inputs(['package.json', 'yarn.lock', '.yarnrc.yml']));
      expect(resolved?.manager).toBe('yarn-berry');
    });

    it('reads the major from a pinned packageManager field', () => {
      expect(
        resolvePackageManager(inputs(['package.json'], { packageJson: pinned('yarn@1.22.22') }))
          ?.manager,
      ).toBe('yarn');
      expect(
        resolvePackageManager(inputs(['package.json'], { packageJson: pinned('yarn@3.6.4') }))
          ?.manager,
      ).toBe('yarn-berry');
    });
  });

  describe('pnpm lockfile format', () => {
    // pnpm 11 refuses a v5 lockfile outright with ERR_PNPM_LOCKFILE_BREAKING_CHANGE,
    // and a repository with no packageManager field has no other version evidence.
    it('pins the major that can read an older lockfile format', () => {
      const v5 = resolvePackageManager(
        inputs(['package.json', 'pnpm-lock.yaml'], { pnpmLock: 'lockfileVersion: 5.4\n' }),
      );
      expect(v5?.version).toBe('7');
      expect(v5?.commands).toEqual([
        ['corepack', 'prepare', 'pnpm@7', '--activate'],
        ['pnpm', 'install', '--frozen-lockfile'],
      ]);

      const v6 = resolvePackageManager(
        inputs(['package.json', 'pnpm-lock.yaml'], { pnpmLock: "lockfileVersion: '6.0'\n" }),
      );
      expect(v6?.version).toBe('8');
    });

    it('leaves the current format to corepack rather than guessing a major', () => {
      const v9 = resolvePackageManager(
        inputs(['package.json', 'pnpm-lock.yaml'], { pnpmLock: "lockfileVersion: '9.0'\n" }),
      );
      expect(v9?.version).toBeNull();
      expect(v9?.commands).toEqual([['pnpm', 'install', '--frozen-lockfile']]);
    });
  });

  describe('npm', () => {
    it('uses npm ci when a lockfile pins the tree', () => {
      expect(resolvePackageManager(inputs(['package.json', 'package-lock.json']))?.commands).toEqual(
        [['npm', 'ci']],
      );
      expect(
        resolvePackageManager(inputs(['package.json', 'npm-shrinkwrap.json']))?.commands,
      ).toEqual([['npm', 'ci']]);
    });

    it('admits when npm is a guess rather than a finding', () => {
      const resolved = resolvePackageManager(inputs(['package.json']));
      expect(resolved?.manager).toBe('npm');
      expect(resolved?.evidence).toBe('default');
      expect(resolved?.commands).toEqual([['npm', 'install']]);
    });
  });
});

/**
 * The relaxation taken only after a strict install has already failed.
 *
 * Every mapping here must land on a command the same manager accepts, because
 * the fallback runs unattended: a typo becomes a second install failure.
 */
describe('relaxedInstall', () => {
  it('relaxes each manager onto a command that manager accepts', () => {
    expect(relaxedInstall(['npm', 'ci'])).toEqual(['npm', 'install']);
    expect(relaxedInstall(['yarn', 'install', '--frozen-lockfile'])).toEqual(['yarn', 'install']);
    expect(relaxedInstall(['yarn', 'install', '--immutable'])).toEqual(['yarn', 'install']);
    // pnpm needs the negation, not the absence: with CI=true set in the
    // environment, a bare `pnpm install` is frozen anyway.
    expect(relaxedInstall(['pnpm', 'install', '--frozen-lockfile'])).toEqual([
      'pnpm',
      'install',
      '--no-frozen-lockfile',
    ]);
    expect(relaxedInstall(['bun', 'install', '--frozen-lockfile'])).toEqual(['bun', 'install']);
  });

  it('has nothing to relax for a command that is already relaxed', () => {
    // Otherwise the same install runs twice and the second failure reads as new.
    expect(relaxedInstall(['npm', 'install'])).toBeNull();
    expect(relaxedInstall(['yarn', 'install'])).toBeNull();
    expect(relaxedInstall(['pnpm', 'install'])).toBeNull();
    expect(relaxedInstall(['bun', 'install'])).toBeNull();
  });

  it('refuses to invent a fallback for a command it does not understand', () => {
    // An operator-supplied install command is theirs. Retrying it with flags
    // stripped is this library guessing at somebody else's build.
    expect(relaxedInstall(['corepack', 'prepare', 'pnpm@9.15.0', '--activate'])).toBeNull();
    expect(relaxedInstall(['sh', '-c', 'make install'])).toBeNull();
    expect(relaxedInstall([])).toBeNull();
  });

  it('relaxes an install and nothing else, however familiar the flags look', () => {
    // A lockfile flag is not what makes a command relaxable -- being an install
    // is. Rewriting one of these into `yarn install` would run a different
    // command than the one that failed, on a tree the operator did not ask for.
    expect(relaxedInstall(['yarn', 'workspaces', 'focus', '--immutable'])).toBeNull();
    expect(relaxedInstall(['pnpm', 'deploy', '--frozen-lockfile', './out'])).toBeNull();
    expect(relaxedInstall(['bun', 'add', 'left-pad', '--frozen-lockfile'])).toBeNull();
    expect(relaxedInstall(['npm', 'audit', '--production'])).toBeNull();
  });

  it('keeps flags it does not recognise when it does relax one', () => {
    // The operator put them there. Only the lockfile flag is this function's
    // business; dropping a registry or a workspace selector alongside it would
    // change what gets installed as well as how strictly.
    expect(relaxedInstall(['npm', 'ci', '--workspaces', '--foreground-scripts'])).toEqual([
      'npm',
      'install',
      '--workspaces',
      '--foreground-scripts',
    ]);
    expect(relaxedInstall(['pnpm', 'install', '--frozen-lockfile', '--filter', 'web'])).toEqual([
      'pnpm',
      'install',
      '--no-frozen-lockfile',
      '--filter',
      'web',
    ]);
  });

  /**
   * Every install the resolver can produce has a known relaxation, or is
   * deliberately already the relaxed one.
   *
   * This called itself the guard against a resolver change outrunning
   * `relaxedInstall`, and it was a hand-written list of five commands: a
   * resolver that started emitting a sixth strict install would leave it
   * passing on the five it still knew, which is precisely what it says it
   * prevents. So the commands are now ASKED OF the resolver -- every branch of
   * it is driven below -- and the set it produces is compared with this table
   * in both directions. A new command has no row and fails; a row for a
   * command the resolver no longer emits fails too.
   *
   * `corepack prepare` is not an install and carries a version, so it is
   * excluded by name and its own null is asserted above.
   */
  it('resolves a fallback for every install command the resolver can produce', () => {
    const RELAXATION: Readonly<Record<string, readonly string[] | null>> = {
      'npm ci': ['npm', 'install'],
      // Already the relaxed form: no lockfile, nothing to drop.
      'npm install': null,
      'pnpm install --frozen-lockfile': ['pnpm', 'install', '--no-frozen-lockfile'],
      'yarn install --frozen-lockfile': ['yarn', 'install'],
      'yarn install --immutable': ['yarn', 'install'],
      'bun install --frozen-lockfile': ['bun', 'install'],
      'bun install': null,
    };

    const berryLock = '__metadata:\n  version: 6\n';
    const every: readonly ToolchainInputs[] = [
      inputs(['package.json']),
      inputs(['package.json', 'package-lock.json']),
      inputs(['package.json', 'npm-shrinkwrap.json']),
      inputs(['package.json', 'package-lock.json'], { packageJson: pinned('npm@10.9.0') }),
      inputs(['package.json'], { packageJson: pinned('npm@10.9.0') }),
      inputs(['package.json', 'pnpm-lock.yaml'], { pnpmLock: "lockfileVersion: '5.4'\n" }),
      inputs(['package.json', 'pnpm-lock.yaml'], { pnpmLock: "lockfileVersion: '9.0'\n" }),
      inputs(['package.json'], { packageJson: pinned('pnpm@9.1.0') }),
      inputs(['package.json', 'yarn.lock'], { yarnLock: '# yarn lockfile v1\n' }),
      inputs(['package.json', 'yarn.lock'], { yarnLock: berryLock }),
      inputs(['package.json', '.yarnrc.yml']),
      inputs(['package.json'], { packageJson: pinned('yarn@1.22.22') }),
      inputs(['package.json'], { packageJson: pinned('yarn@4.1.0') }),
      inputs(['package.json', 'bun.lockb']),
      inputs(['package.json', 'bun.lock']),
      inputs(['package.json'], { packageJson: pinned('bun@1.1.30') }),
    ];

    const produced = new Set<string>();
    for (const one of every) {
      const resolved = resolvePackageManager(one);
      expect(resolved, 'a package.json always resolves to something').not.toBeNull();
      for (const command of resolved?.commands ?? []) {
        if (command[0] === 'corepack') continue;
        produced.add(command.join(' '));
      }
    }

    // The subject, before anything is asserted about it: an `every` list that
    // stopped resolving would make every check below vacuous.
    expect(produced.size).toBe(Object.keys(RELAXATION).length);
    expect([...produced].sort()).toEqual(Object.keys(RELAXATION).sort());

    for (const command of produced) {
      expect(relaxedInstall(command.split(' ')), command).toEqual(RELAXATION[command] ?? null);
    }
  });
});
