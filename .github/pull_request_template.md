<!--
Title this pull request the way its issue is titled:
    <project>: [<epic>.<issue>] <title>
e.g. ouroboros-db: [3.2] Baseline tenancy schema — tenants & domains
Conventions: docs/CONVENTIONS.md § 7.
-->

## What & why

<!-- What this changes, and the problem it solves. One short paragraph. -->

## Changes

<!-- One line per file or group of files, in the order a reviewer should read them. -->

-

## How to test

<!-- Numbered steps a reviewer can follow from a clean checkout, with the commands to run
     and the example data to enter. -->

1.

## Risk & notes

<!-- What could break, what is deliberately out of scope, and anything a reviewer should
     watch for. Write "None." if there is genuinely nothing. -->

## Issue

Closes #

## Checklist

- [ ] Branch is `ticket-<issue-number>`, cut from `main`
- [ ] Commit message is `Fix #<number> - <concise title>`
- [ ] Labels on the issue match the work: scope (`mvp`/`v2`), module, cross-cutting
- [ ] Roadmap status marker updated (🟡 Open → 🟢 Done) for the issue this closes
- [ ] `scripts/verify-layout.sh` and `scripts/verify-github-config.sh` pass
- [ ] Module documentation updated where behaviour changed
- [ ] Module version bumped (semver, in its own manifest) if its code changed
- [ ] No credentials, tokens or real `.env` values are committed
