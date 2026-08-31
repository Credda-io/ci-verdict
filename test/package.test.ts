/**
 * The zero-dependency claim, checked by machine rather than asserted in prose.
 *
 * The README says this package has no runtime dependencies and imports nothing
 * outside itself, including Node builtins. That is a property somebody can
 * break in one careless line, so it is a test.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(): readonly string[] {
  const dir = join(root, 'src');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(dir, name));
}

/** Every module specifier in a file: static imports, re-exports, dynamic. */
function specifiersIn(source: string): readonly string[] {
  const found: string[] = [];
  const patterns = [
    /^\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1] as string);
  }
  return found;
}

describe('the package stands alone', () => {
  it('declares no runtime dependencies', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
  });

  it('imports nothing from outside src/, not even a Node builtin', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      for (const specifier of specifiersIn(readFileSync(file, 'utf8'))) {
        // A relative specifier that stays inside the package is the only kind
        // allowed. `node:*`, a bare package name, and `../` out of src/ are not.
        const local = specifier.startsWith('./') && !specifier.includes('..');
        if (!local) offenders.push(`${file}: ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('finds the source it is auditing, so an empty pass cannot be a false one', () => {
    const files = sourceFiles().map((f) => f.slice(f.lastIndexOf('src')));
    expect(files.length).toBeGreaterThanOrEqual(5);
    // And the audit above really does see the imports that are there.
    const index = readFileSync(join(root, 'src', 'index.ts'), 'utf8');
    expect(specifiersIn(index).length).toBeGreaterThan(0);
  });

  /**
   * The entry point's runtime exports, both directions.
   *
   * This read `src/index.ts` AS TEXT and asserted `toContain(name)` for a list
   * of fifteen. A name that survives only in a docblock passes that; so does an
   * export renamed while the old spelling lingers in a comment; and two real
   * exports -- `MAX_EVIDENCE_LENGTH` and `jobFactsFrom` -- were missing from
   * the list without anything noticing, which is the other direction of the
   * same hole. So the module is IMPORTED and its own binding names are
   * compared, which is what a consumer of the package actually gets.
   *
   * Types are absent on purpose: they do not exist at run time, and holding
   * them is `npm run typecheck`'s job, not this one's.
   */
  it('re-exports the whole public surface from the entry point, and nothing else', async () => {
    const surface = (await import('../src/index.js')) as Record<string, unknown>;
    const exported = Object.keys(surface).sort();

    expect(exported).toEqual(
      [
        'CI_NOT_A_DEFECT_REASONS',
        'MAX_EVIDENCE_LENGTH',
        'MAX_LOG_SCAN_BYTES',
        'PACKAGE_MANAGERS',
        'ciVerdict',
        'classifyFailingStep',
        'classifyFailureLog',
        'classifyJobOutcome',
        'classifyWorkflowRun',
        'findFailedJob',
        'findFailedStep',
        'jobFactsFrom',
        'jobFactsListFrom',
        'logTail',
        'relaxedInstall',
        'resolvePackageManager',
        'workflowRunFactsFrom',
      ].sort(),
    );

    /* And every one of them is really there to be called or read, rather than
     * being a name the module system left behind. */
    for (const name of exported) expect(surface[name], name).toBeDefined();
  });
});
