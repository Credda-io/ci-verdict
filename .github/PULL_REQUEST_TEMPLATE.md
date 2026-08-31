<!--
CONTRIBUTING.md has four rules that are not negotiable, and the checklist below
is just those four in a form you can tick. Reading them before you write the
code is cheaper than reading them after: a change that breaks one will be
declined however good it is otherwise.

The one worth repeating here, because it is the one that looks like an
improvement: A HEURISTIC MAY ONLY REJECT. `CiRejection` has no member meaning
"approved", so a heuristic that tried to vouch for a run does not compile.
Widening those return types is not a bigger version of this package. It is a
different one.

And the direction of error, for anything you add to layer 2: a false rejection
hides a real defect, and this list is only allowed to be wrong the other way.
If a pattern could also be printed by a failing test, a compiler or a linter, it
does not belong.
-->

**What is wrong today.** <!-- The behaviour, not the change. -->

**What this changes.**

**How you know it works.** <!-- Name the test that fails without this. -->

- [ ] `npm run check` passes on Node 20, 22 and 24.
- [ ] No module in `src/` names a specifier that is not a relative path inside `src/` — not even a Node builtin.
- [ ] Nothing gained a way to say "approved"; `classifyFailingStep` and `classifyFailureLog` still return `CiRejection | null`.
- [ ] Nothing throws, and no payload text is interpolated into an `explanation`.
- [ ] Any enum value compared against is cited in the `src/attribution.ts` docblock, with its URL and the date it was read.
- [ ] A new layer-2 pattern names a resource the repository does not control, is anchored and literal, and has a test that fails without it.
- [ ] Comments explain *why*, not *what*.
