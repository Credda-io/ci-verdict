/**
 * The README's worked output, checked against the library rather than trusted.
 *
 * The README quotes what `npm run example` prints and then says the block
 * cannot drift. Until now nothing compared the two: the four cases were
 * asserted in the suite and in the example, so a changed explanation would fail
 * both of those -- and whoever fixed them could still leave the README quoting
 * the old sentence, which is the copy with the most readers and the one nobody
 * runs. So the block is rendered here from `examples/cases.mjs`, exactly as the
 * example renders it, and the README must contain it verbatim.
 *
 * This also checks the cases themselves against `src/`, which is why it needs
 * no build: the example asserts the same expectations against `dist/`.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JavaScript data, deliberately untyped and shared
// with `examples/three-runs.mjs`, which cannot import a TypeScript module.
import { cases } from '../examples/cases.mjs';
import { ciVerdict } from '../src/verdict.js';
import type { CiAttribution, CiVerdictInput } from '../src/index.js';

interface WorkedCase {
  readonly title: string;
  readonly input: CiVerdictInput;
  readonly expected: CiAttribution;
}

const worked = cases as readonly WorkedCase[];
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

/** What `examples/three-runs.mjs` prints for one case, character for character. */
function rendered(title: string, verdict: CiAttribution): string {
  return `\n${title}\n  ${JSON.stringify(verdict, null, 2).split('\n').join('\n  ')}\n`;
}

describe("the README's worked output", () => {
  it('quotes four cases, which is what the example runs', () => {
    // An empty `cases` would make every assertion below pass by having nothing
    // to check, so the count is asserted before anything is compared to it.
    expect(worked.length).toBe(4);
  });

  it('is what the library actually produces, case by case', () => {
    for (const { title, input, expected } of worked) {
      expect(ciVerdict(input), title).toEqual(expected);
    }
  });

  it('appears in README.md verbatim, block and all', () => {
    const block = worked.map(({ title, expected }) => rendered(title, expected)).join('');
    expect(readme).toContain(block.trim());
  });

  it('is inside the fenced block the README introduces as the example output', () => {
    const marker = '`npm run example` builds the package and runs';
    const start = readme.indexOf(marker);
    expect(start, 'the README no longer introduces the example output').not.toBe(-1);
    const open = readme.indexOf('\n```\n', start);
    const close = readme.indexOf('\n```', open + 5);
    expect(open, 'no fenced block follows').not.toBe(-1);
    expect(close).toBeGreaterThan(open);
    const quoted = readme.slice(open + 5, close);
    const printed = worked.map(({ title, expected }) => rendered(title, expected)).join('');
    expect(quoted.trim()).toBe(printed.trim());
  });
});
