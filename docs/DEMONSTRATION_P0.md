# Demonstration — P0 · Repository Foundation

> A five-minute walkthrough of what phase **P0** of
> [`ROADMAP_OOE_MVP.md`](ROADMAP_OOE_MVP.md) delivered, and how to show it.
> **Status at the time of writing:** ✅ complete — 5 of 5 issues closed
> ([#8](https://github.com/NobuData/ouroboros/issues/8)–[#12](https://github.com/NobuData/ouroboros/issues/12)).

## Regeneration prompt

Copy this into Claude Code to rebuild this document, or swap the phase token to
generate another phase's script.

```text
Read `docs/ROADMAP_OOE_MVP.md` and produce `docs/DEMONSTRATION_P0.md` — a
walkthrough script for phase **P0** of the order-of-execution plan.

Rules:
1. Ground every claim in this repository. Before writing a step, open the file,
   route, endpoint, migration or fixture it names and confirm it exists at HEAD.
2. Confirm what actually shipped:
   `gh issue list --state closed --limit 1000 --json number --jq '.[].number'`
   (plain `gh issue view` fails on this repo — use `--json`). The roadmap's ✅ marks
   can be stale; GitHub wins. Demonstrate only closed issues, and say plainly what
   the phase still owes.
3. No fabricated numbers. Every figure the presenter reads aloud must come from a
   seed file, a fixture under `tests/e2e/support/`, or a live response.
4. The walkthrough must fit in 5 minutes. Give it timed beats summing to ≤ 4:45.
5. Structure: What shipped · Setup · Walkthrough (timed table of navigation +
   narration) · Prove it · Don't claim.
6. Narration is what the presenter says out loud, in full sentences. Navigation is
   what they click or type.
7. Where a later phase moved or replaced something this phase built, say so rather
   than demonstrating the old shape.

Swap the phase token to regenerate any other phase: P0 … P17.
```

## What shipped

| Ref | Issue | What landed | Where to see it |
|-----|:-----:|-------------|-----------------|
| `1.1` | [#8](https://github.com/NobuData/ouroboros/issues/8) | Monorepo layout & module scaffolding conventions | `package.json` workspaces, [`CONVENTIONS.md`](CONVENTIONS.md) |
| `1.2` | [#9](https://github.com/NobuData/ouroboros/issues/9) | GitHub labels & issue/PR templates | `.github/labels.yml`, `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md` |
| `1.3` | [#10](https://github.com/NobuData/ouroboros/issues/10) | Local dev environment — PostgreSQL + Flyway | `docker-compose.yml`, `ouroboros-db/flyway.toml` |
| `1.4` | [#11](https://github.com/NobuData/ouroboros/issues/11) | CI pipelines per module, path-filtered | `.github/workflows/*.yml`, `.github/actions/` |
| `1.5` | [#12](https://github.com/NobuData/ouroboros/issues/12) | Architecture documentation | [`ARCHITECTURE.md`](ARCHITECTURE.md) |

**The point of the phase.** `1.1` is the only genuine root of the whole 454-issue
graph. Nothing can be merged into a repository with no module directories, no CI and
no agreed contracts — so this phase creates the vocabulary every later issue is
written in.

This demo is entirely terminal and GitHub. There is no application yet — that is
P1.

## Setup

Five minutes before, on the presenting machine:

```bash
cd ouroboros
git switch main && git pull        # demo from main, not a feature branch
docker compose down -v             # so the cold start in beat 2 is genuinely cold
gh auth status                     # beat 4 opens a real issue form
```

Have open and ready to switch between:

- a terminal at the repository root,
- a browser on <https://github.com/NobuData/ouroboros/issues/new/choose>,
- an editor or pager for `docs/ARCHITECTURE.md`.

Docker must be running. Nothing else is required — no `.env`, no OAuth app, no
credentials.

## Walkthrough — 4:40

### Beat 1 · The shape of the repository — 0:00 → 0:50

**Navigate**

```bash
ls
sed -n '/"workspaces"/,/]/p' package.json
```

**Say**

> This is one repository holding four services across three toolchains. The
> directory names are the module names, and each one owns how it is built, run and
> tested — there is no repo-level build that knows Python. What the root owns is the
> graph: `package.json` declares the four workspaces, and `turbo.json` declares what
> has to happen before what.
>
> `ouroboros-web` is deliberately *not* in that list. It is the marketing site, it
> deploys on its own, and it wants the same port 3000 the product UI does — so it is
> not a workspace, and `yarn dev` never starts it.

### Beat 2 · One command brings the database up — 0:50 → 1:55

**Navigate**

```bash
docker compose up            # let it run; it applies migrations and the seed, then exits
```

Then, in a second pane:

```bash
ouroboros-db/scripts/info
```

**Say**

> `docker compose up` with no arguments is the data tier: PostgreSQL 17, plus a
> Flyway container that waits on the database's own healthcheck — not a sleep —
> applies every pending migration, and exits. A migrator is a task, not a service, so
> it must not come back after it succeeds.
>
> Note what is *not* in the compose file: how Flyway is configured. That lives in
> `ouroboros-db/flyway.toml`, which is the same file `ouroboros-db/scripts/info` just
> read. Two ways of applying migrations, one set of rules, so they cannot drift
> apart. What is passed on the command line is only what differs per machine — the
> url, the user, the password — because those are a machine's business and one of
> them is a secret.

### Beat 3 · CI that only runs what changed — 1:55 → 2:50

**Navigate**

```bash
ls .github/workflows/
sed -n '1,16p' .github/workflows/ui.yml
```

**Say**

> Five lanes, one per module plus the end-to-end suite, and each one is filtered by
> path. The UI lane triggers on `ouroboros-ui/**` — and also on
> `ouroboros-rest/openapi.json`, because the UI's typed client is generated from the
> API specification, so a contract change *is* a UI change even when no UI file
> moved.
>
> That is the pattern across all five: the filter lists what the lane's result
> actually depends on, not just the directory it is named after. A pull request that
> only touches `docs/` runs nothing, and a pull request that touches the auth
> configuration runs the database lane, because `ouroboros-rest/src/auth/**` is what
> the schema is generated from.

### Beat 4 · The vocabulary every issue is written in — 2:50 → 3:45

**Navigate**

```bash
grep -c "name:" .github/labels.yml
sed -n '1,25p' .github/ISSUE_TEMPLATE/feature.yml
```

Then switch to the browser tab on **New issue** and show the two forms.

**Say**

> Thirty-seven labels, defined as a file rather than clicked into the web UI, so the
> vocabulary is reviewable and restorable. The roadmaps you have seen — every issue
> table in `docs/` — are written against these labels and these forms.
>
> The forms are structured rather than free text. That is what makes an issue
> machine-readable later: the roadmap generator, and eventually the product itself,
> read these fields. This is the smallest issue in the phase and one of the most
> load-bearing, because 453 issues were filed through it.

### Beat 5 · The contracts, fixed before the code — 3:45 → 4:40

**Navigate**

```bash
grep -n "^## " docs/ARCHITECTURE.md
sed -n '76,82p' docs/ARCHITECTURE.md
```

**Say**

> Ten sections, written before there was an application to describe. The two that get
> quoted most are section 1's port table — UI on 3000, REST on 4000, engine on 8000
> and *not published*, PostgreSQL on 5432 bound to loopback — and section 6, the
> `OURO_*` configuration registry, which is why every environment variable in this
> system carries one prefix and can be declared in `turbo.json` with a single glob.
>
> The invariant worth naming out loud is in section 8: only `ouroboros-rest` talks to
> the database and to the engine. The UI reaches neither. That single boundary is
> what keeps tenancy enforcement in one auditable place — and in P1 you will see it
> made true by the topology rather than by a rule someone has to remember.

## Prove it

Claims a viewer can check on the spot:

```bash
scripts/run-tests.sh                  # the repo-level shell suites
ouroboros-db/scripts/validate         # migration checksums and naming rules
docker compose config --profiles      # `full` and `ollama`; db + flyway are the default up
```

`ouroboros-db/tests/scripts.test.sh` asserts the wrapper commands behave as
documented, and `.github/actions/scaffold-gate/` is what every module lane runs
first — the check that a module still has the shape `1.1` gave it.

## Don't claim

- **There is no application here.** Nothing serves a page and nothing answers an
  API call at the end of P0. The services arrive in P1.
- **`docker compose up` in this phase is the database only.** The three service
  containers are behind `--profile full` and did not exist until P1.
- **The seed data is not P0's.** The `acme-robotics` workspace arrives with
  `R__dev_seed.sql` in P1 and is rewritten auth-aware in P2.
- **The e2e workflow exists but P0 did not fill it.** `tests/e2e/` is `7.2`
  ([#56](https://github.com/NobuData/ouroboros/issues/56)), which lands in P1/P2.
