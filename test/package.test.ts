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

  it('re-exports the whole public surface from the entry point', () => {
    const index = readFileSync(join(root, 'src', 'index.ts'), 'utf8');
    for (const name of [
      'ciVerdict',
      'classifyWorkflowRun',
      'classifyJobOutcome',
      'classifyFailingStep',
      'classifyFailureLog',
      'findFailedJob',
      'findFailedStep',
      'logTail',
      'MAX_LOG_SCAN_BYTES',
      'CI_NOT_A_DEFECT_REASONS',
      'workflowRunFactsFrom',
      'jobFactsListFrom',
      'resolvePackageManager',
      'relaxedInstall',
      'PACKAGE_MANAGERS',
    ]) {
      expect(index).toContain(name);
    }
  });
});
