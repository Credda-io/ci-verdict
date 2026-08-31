# Security

## Reporting a vulnerability

Use **GitHub's private vulnerability reporting** on this repository: the
Security tab, then "Report a vulnerability". That opens a private advisory
visible to the maintainers and to you, and nowhere else.

Please do not open a public issue for something exploitable, and please do not
wait for us to be ready before you tell us.

What helps, in rough order:

- what an attacker gets, stated first
- the smallest input that demonstrates it
- the version or commit you were on

If you would rather not use GitHub, email
[security@credda.io](mailto:security@credda.io?subject=Security%20disclosure).
It is a small internal group, not a personal mailbox, and it is the address
published at
[credda.io/.well-known/security.txt](https://credda.io/.well-known/security.txt)
under RFC 9116 — so you can confirm it against a served artifact rather than
trusting a file in a repository.

**What to expect**, and these are commitments we can meet rather than
aspirational ones: acknowledgement within **3 business days**, an initial
assessment and severity call within **10 business days**, progress updates while
we work a confirmed issue, and credit if you want it once a fix has shipped.
There is no paid bounty programme; we would rather say that plainly than let you
find it out after the work.

The full org-wide policy — scope, safe harbor, and how we handle a report about
ourselves — is
[`Credda-io/.github/SECURITY.md`](https://github.com/Credda-io/.github/blob/main/SECURITY.md).

## What this package is, and therefore what its attack surface is

`ci-verdict` is a pure classifier with **no runtime dependencies at all** -- not
even Node builtins. It performs no I/O, opens no socket, reads no clock, spawns
nothing, and throws nothing. It takes JSON you already hold and returns a
verdict.

Two consequences worth knowing:

- **Its whole input is attacker-influenced.** A `workflow_run` payload carries
  branch names, step names, job names and log text, all of which somebody who
  can open a pull request can choose. Every reader in `src/payload.ts` is total:
  a field of the wrong type, a missing object or an array of nulls becomes the
  absence of a fact, never an exception. A throw in an unauthenticated ingest
  path turns a routine platform change into an outage.
- **No payload text is ever interpolated into a verdict.** The `explanation`
  strings are this library's own sentences, because they end up in your log
  lines and your database rows. There is a test that pins that.

The regular expressions in `src/attribution.ts` run against log text an attacker
can influence. They are deliberately literal and un-nested: no pattern here has
a quantifier applied to a group that can also match the empty string, which is
the shape that backtracks catastrophically. `logTail()` bounds what is scanned.
If you find one that does not hold to that, it is a vulnerability and we want to
know.

## Supported versions

The latest published minor. This package is pre-1.0; fixes go to `main` and to a
new release rather than to a branch.
