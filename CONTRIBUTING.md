# Contributing

Issues and pull requests are welcome. This is a small package with a specific
shape, so it is worth knowing the shape before you spend an afternoon on it.

## Run it

```
npm install
npm run check    # typecheck, then 146 tests, then build
```

`npm run example` builds and runs four real-shaped runs through the classifier
and prints the verdicts. The same four are asserted in `test/verdict.test.ts`,
so the README cannot drift away from what the code does.

## The four rules that are not negotiable

These are the reasons the package is worth depending on. A change that breaks
one of them will be declined however good it is otherwise.

1. **It imports nothing. Not even Node builtins.** No module in `src/` may name
   a specifier that is not a relative path inside `src/`. `test/package.test.ts`
   reads every source file and fails if one appears. This is what makes the
   package run unchanged on Node, Deno, Bun, a browser and an edge worker. If
   your change needs an import, it belongs somewhere else.
2. **A heuristic may only reject.** `classifyFailingStep` and
   `classifyFailureLog` return `CiRejection | null`, and `CiRejection` has no
   member meaning "approved", so a heuristic that tried to vouch for a run does
   not compile. Do not widen those return types. The cost argument is in the
   README and it is the whole design.
3. **Nothing throws, and nothing is interpolated.** Every reader in
   `payload.ts` is total: bad JSON becomes absent facts. Every `explanation` is
   one of this library's own sentences, never text off the payload, because
   those strings end up in somebody's log lines and database rows.
4. **Layer 1 cites its sources.** Every enum value the classifier compares
   against is read from GitHub's REST documentation and recorded, with its URL
   and the date it was read, in the docblock of `src/attribution.ts`. If you add
   a value, add the citation.

## Adding a pattern to layer 2

The step-name and log patterns are the parts most likely to need help, and the
easiest to get subtly wrong. Before adding one, ask:

- **Does it name a resource the repository does not control?** DNS, a registry,
  a mirror, a runner, a credential, a disk. If it could also be printed by a
  failing test, a compiler or a linter, it does not belong here -- a false
  rejection hides a real defect, and this list is only allowed to be wrong in
  the other direction.
- **Is it anchored and literal?** These run against attacker-influenced log
  text. No quantifier applied to a group that can also match empty.
- **Have you added a test that fails without it?** `test/attribution.test.ts` is
  where the classifier's 94 tests live.

Out-of-memory is deliberately absent, and the test that pins that is deliberate
too: a suite that exhausts the runner's memory may be a leak you introduced or a
runner smaller than the job needs, and this package cannot tell which.

## Style

Comments explain *why*, not *what*. Where a decision could reasonably have gone
the other way, the code says which way it went and what the alternative would
have cost. That is the house style across Credda's repositories and it is the
main thing reviewers will ask you for.

## Licence

Contributions are accepted under Apache-2.0, the same licence as the package.
