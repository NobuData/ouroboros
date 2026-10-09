---
name: implement
description: Fetches the GitHub Issue for the current repo, implements the work to be done.
---

# Implement (`/implement <number>`)

When user invokes **implement** with issue number, treat number as **GitHub issue** in **current repository**. Follow workflow end to end unless user terminates or environment blocks (auth, permissions, missing `gh`, etc.).

## Guidelines

- Apply **AGENTS.md**
- Only change what ticket requires: avoid unnecessary refactors.
- Never commit credentials or tokens.
- If blocked, stop, explain.

## Phase 1: Fetch issue

- Identify current repository from workspace context.
- Fetch full issue **title, body, labels, and any linked/previous discussion**:

```
gh issue view <number> --repo <owner>/<repo>
```

- Summarize issue clearly in conversation so full intent in context.
- **NEVER invent requirements.**  If issue **ambiguous, underspecified, or contradicts the codebase**, SWITCH TO PLAN MODE, clarify, and stop.

## Phase 2: Branch setup

- Fetch and checkout latest default branch:

```bash
git checkout main
git pull origin main
```

- Create and switch to `ticket-<number>`:

```bash
git checkout -b ticket-<number>
```

- If branch already exists, report it and ask whether to reset or reuse.
- All implementation commits for ticket belong on this branch.

## Phase 3: Implementation

- Implement behavior **as specified in issue**, do not deviate.
- If description is **large or risky**, SWITCH TO PLAN MODE, outline a short plan in chat.
- Split code into separate modules, helper functions, or utility classes if context too large.
- Keep implementation **simple** - keep code easy to read and understand, fully document methods, inputs, and return variables.
- Create **comprehensive test cases** for all new and changed functionality.
- UI: Create integration UI tests when working on UI/UX features.
- **Documentation** (`ouroboros-docs` — see `docs/CONVENTIONS.md` § 11 and `ouroboros-docs/README.md` § Authoring):
  - For **every user-visible change** — a UI route, label, flow or setting; a CLI flag; an `OURO_*` variable; an API behaviour — create or update the page in `ouroboros-docs/docs/`, in the section the reader needs it from: uses the product UI → `user-guide/`; operates or configures the deployment or a workspace → `administration/`; types a command → `cli/`. A topic with more than one side gets a page in each, cross-linked.
  - Name the **concrete page paths** before editing (e.g. `ouroboros-docs/docs/user-guide/finding-your-way.mdx`), and keep every label, route, flag and variable on the page exactly as implemented.
  - **Screenshots:** add or refresh the entry in `ouroboros-docs/screenshots/screenshots.manifest.json` and recapture **only the affected ids** with `yarn screenshots --only <id>` from `ouroboros-docs/`, against the seeded stack already running for the UI checks. Never recapture unrelated ids; Read both theme PNGs afterwards.
  - A new or changed `OURO_*` variable: edit `.env.example` (and the top-level one), then `yarn gen:config-reference`. A new CLI flag: add it to the command page's `flags:` front matter (`yarn check:cli-flags`).
  - Update the `docs-coverage` entries once `ouroboros-docs/docs-coverage.json` exists (DE.4, #1212); until then say so in the PR.
  - An **internal-only change** needs no docs — say so in the PR's Documentation section.
- Lint the code.
- DO NOT RUN END TO END TESTS

## Phase 4: Internal Audit

- Ensure potential misuses of new code are safeguarded, covered, noted.
- UI: Use **CSS classes** - no hard-coded values.
- Documentation must be complete and simple.
- Check for code reuse; extract repeated logic into separate reusable modules.
- **Docs match the implemented behaviour:** every page touched names labels, routes, flags and variables as built, and its screenshots are current (recaptured in this ticket, or unaffected).
- DO NOT RUN END TO END TESTS
- Only run unit tests.  End-to-end and integration are not necessary to run.  Tests should limit the number of threads run at the same time to 1/2 the threads available on the CPU.

## Phase 5: Verify and Test

From **repository root**, run project's standard checks:

- Build project:

```bash
yarn build
```

Run package-specific builds required by workspace rules.

- Run tests WITHOUT END TO END TESTS:

```bash
yarn test
```

Run package-specific tests the issue touches, per READMEs.

- When `ouroboros-docs/**` changed, run from `ouroboros-docs/` (it is outside the turbo graph): `yarn lint`, `yarn typecheck`, `yarn test`, every `yarn check:*` (`check:brand`, `check:screenshots`, `check:config-reference`, `check:cli-flags`) and `yarn build` — a broken link or anchor fails the build.
- DO NOT RUN END TO END TESTS
- Test all code, not just changes, so regressions are checked.  Tests should limit the number of threads run at the same time to 1/2 the threads available on the CPU.
- Fix **any failures introduced that block ticket** and **any tests or build issues** before proceeding.

## Phase 6: Note Work

- Mark ticket complete in **ROADMAP** and REMOVE ITS ENTRY FROM THE ISSUES TABLE matching the issue number if applicable.
- Update the **CHANGELOG** with a single line summary of what was done - it must be short and succinct, less than 80 characters.
- Bump semver versions in modified projects.
- Bump `ouroboros-docs/package.json`: **patch** for edits to existing pages or screenshots, **minor** for a new page.

## Phase 7: Commit, Push, Pull Request

### Commit

```bash
git add -A
git commit -m "Fix #<number> - <concise title>"
```

### Push

```bash
git push origin ticket-<number>
```

### Open the PR

Use `gh` to create Pull Request from `ticket-<number>` into default branch:

```bash
gh pr create \
  --title "Fix #<number> - <concise title>" \
  --body "<descriptive body>" \
  --base main \
  --head ticket-<number>
```

#### PR body must include:

- What was done and why
- How to test
- Risk/notes
- **Documentation**: the `ouroboros-docs` pages and screenshot ids created or changed, or "none — internal-only change" and why
- Issue link: `Closes #<number>` (or `Fixes #<number>`)
- Notate:
```
Made with <agent name> using model <model name>
Orchestrated through **Ouroboros**
```

## Phase 8: Explain How to Test

- Note how to test what was done.
- Include steps with each important piece boldfaced (e.g. "**click button X**" or "**browse to Y**")
- Note example data to put into forms to test.

## Phase 9: Switch to Main

Switch back to `main`:

```bash
git checkout main
```

- Report the link back to the output so it can be used with other skills.

