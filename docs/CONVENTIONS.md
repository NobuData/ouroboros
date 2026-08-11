# Ouroboros — repository conventions

The rules every module in this monorepo follows. They exist so a developer moving
between `ouroboros-ui`, `ouroboros-rest`, `ouroboros-engine` and `ouroboros-db` finds
the same shapes in the same places, and so four modules across three toolchains do not
each invent their own.

Filed as issue [#8](https://github.com/NobuData/ouroboros/issues/8). The system design
these conventions serve is described in
[`ARCHITECTURE.md`](ARCHITECTURE.md) ([#12](https://github.com/NobuData/ouroboros/issues/12));
the plan that produced them is
[`ROADMAP_OUROBOROS_APPLICATION_SCAFFOLDING.md`](ROADMAP_OUROBOROS_APPLICATION_SCAFFOLDING.md).

## 1. Repository shape

```
ouroboros/
├── docs/              # mockups, roadmaps, architecture, conventions, brand
├── ouroboros-web/     # marketing site — ouroboros.build (already live)
├── ouroboros-ui/      # Next.js product UI            · epic #5
├── ouroboros-rest/    # NestJS communications layer   · epic #4
├── ouroboros-engine/  # Python/FastAPI backend        · epic #6
├── ouroboros-db/      # Flyway migrations             · epic #3
├── scripts/           # repo-level tooling
├── package.json       # the Yarn workspace and the repo-level verbs
├── turbo.json         # the task graph between the modules
└── yarn.lock          # one resolution for every workspace
```

**Each module still owns its work.** Its lint and test configuration, its `Dockerfile`,
its `.dockerignore`, and the commands its verbs actually run are all its own — the four
application modules are three toolchains, and nothing at the root knows how to run any of
them. What the root owns is the *graph*: which verb runs in which order, and where the
one Node resolution comes from.

**The workspace runner is Turborepo** ([#13](https://github.com/NobuData/ouroboros/issues/13)),
over Yarn 4 workspaces — [`DECISION_WORKSPACE_TOOLING.md`](DECISION_WORKSPACE_TOOLING.md)
is the evaluation behind that choice, what it was measured against, and what would reopen
it. It buys exactly one thing that per-module commands could not:

```bash
yarn install    # every workspace, from one lockfile
yarn dev        # the whole application stack, in order, in one terminal
```

`yarn dev` starts the database, waits for its healthcheck, applies the pending
migrations, and only then brings up `ouroboros-rest` and `ouroboros-engine` and
`ouroboros-ui` side by side — the ordering expressed in `turbo.json` rather than in a
paragraph of a README nobody re-reads. `yarn build`, `yarn lint`, `yarn typecheck` and
`yarn test` run their verb across every module that has one.

Three limits on it are deliberate:

1. **`ouroboros-web` is not a workspace.** It is the marketing site, it deploys on its
   own pipeline, and it wants the same port 3000 the product UI does, so it keeps its own
   lockfile and its own `.yarnrc.yml` and `yarn dev` never starts it. `yarn dev:web` does.
2. **CI does not go through turbo.** Each module's workflow runs that module's verbs from
   inside that module's directory, the way a developer does. A break in the task graph
   must not be the thing that makes a module's checks pass (§ 9).
3. **The non-JavaScript modules are adapters, not ports.** `ouroboros-engine` and
   `ouroboros-db` carry a `package.json` whose scripts are one line each — `uv run dev`,
   `scripts/dev` — so the graph can reach them. `pyproject.toml` and `flyway.toml` remain
   those modules' real manifests, and neither adapter carries a version, so § 8 still has
   one place per module where a version is written down.

**Directory names are kebab-case and prefixed `ouroboros-`.** A module directory is
never nested inside another module.

## 2. Every module directory contains

| File | Required | Why |
|---|:---:|---|
| `README.md` | yes | Purpose, stack, run instructions, configuration — the entry point |
| `Dockerfile` | yes, once scaffolded | Every module ships as a container |
| `.dockerignore` | yes, with the Dockerfile | Keeps build context small and secrets out |
| `.gitignore` | yes | Module-local artefacts, so the directory is portable |
| Lockfile | see below | `uv.lock` (Python) and `ouroboros-web/yarn.lock` are module-local; the workspace modules share the root `yarn.lock` |

There is exactly one `yarn.lock` per Yarn project, so making `ouroboros-ui` and
`ouroboros-rest` workspaces moved theirs to the root (§ 1). It is still committed and
installs are still immutable — `yarn install --immutable` from inside either module
resolves it, because Yarn finds the workspace root from anywhere inside it. The rule that
did not survive is that a module directory can be lifted out of the repo and still
install; for those two that now takes the root `package.json`, `yarn.lock` and
`.yarnrc.yml` with it. `ouroboros-web` is untouched by this and remains genuinely
self-contained.

The repo-root [`.gitignore`](../.gitignore) covers artefacts any module can produce;
module-level `.gitignore` files add what only that toolchain emits. Both exist on
purpose — a module directory should still behave correctly if lifted out of the repo.

### README structure

Module READMEs follow the same five sections so they are skimmable side by side:
**Purpose** → **Stack** → **Run** → **Configuration** → **Layout**, closing with
**Related issues**. `scripts/verify-layout.sh` checks that the first three are present.

## 3. Toolchains

| Module | Language | Package manager | Runtime pin |
|---|---|---|---|
| `ouroboros-ui` | TypeScript | Yarn 4 via corepack | Node 24 |
| `ouroboros-rest` | TypeScript | Yarn 4 via corepack | Node 24 |
| `ouroboros-web` | TypeScript | Yarn 4 via corepack | Node 24 |
| `ouroboros-engine` | Python 3.12 | [uv](https://docs.astral.sh/uv/) | Python 3.12 |
| `ouroboros-db` | SQL | — (Flyway container) | PostgreSQL 17 |

**TypeScript modules use Yarn 4**, enabled through corepack and pinned by the
`packageManager` field, with `nodeLinker: node-modules` in `.yarnrc.yml`. Both of those
now live in the repo-root `package.json` and `.yarnrc.yml`, once, for every workspace —
a module that carried its own copy could drift from the version the lockfile was written
by. `ouroboros-web` is not a workspace and keeps both files itself. CI and Docker builds
run `yarn install --immutable`; a lockfile that does not match the manifests it resolves
fails the build rather than silently updating.

**Python uses uv** — `uv sync` for install, `uv run <cmd>` for everything else. `uv.lock`
is committed. Lint and format are ruff; tests are pytest.

**SQL uses Flyway from its container**, so no module requires a local Java install — a
Flyway on the developer's own PATH is used when there is one, and neither is needed to
work on anything else. `ouroboros-db` is a Flyway project in the ordinary sense:
[`flyway.toml`](../ouroboros-db/flyway.toml) holds every setting that is a rule rather
than a connection, [`migrations/`](../ouroboros-db/migrations) holds the SQL, and
[`scripts/`](../ouroboros-db/scripts) names the things anyone does to a database —
`migrate`, `info`, `validate`, a `clean-dev` that refuses anything but a development one,
and the `dev` that brings the compose stack up and migrates it in one step. Its tests are
POSIX shell, run by `scripts/run-tests.sh ouroboros-db/tests`.

### Standard task names

Each toolchain exposes the same verbs, so CI, the workspace runner and humans can all
rely on them:

| Task | TypeScript | Python | SQL | From the repo root |
|---|---|---|---|---|
| install | `yarn install --immutable` | `uv sync` | — | `yarn install` |
| dev | `yarn dev` | `uv run dev` | `scripts/dev` | `yarn dev` |
| lint | `yarn lint` | `uv run ruff check .` | — | `yarn lint` |
| typecheck | `yarn typecheck` | — (ruff only; a type checker is post-MVP) | — | `yarn typecheck` |
| format | (Prettier, via `yarn lint`) | `uv run ruff format --check .` | — | (with `lint`) |
| test | `yarn test` | `uv run pytest` | `scripts/run-tests.sh` | `yarn test` |
| build | `yarn build` | (container build) | — | `yarn build` |

The last column is the same verb run across every module at once, through Turborepo
(§ 1). It is a fan-out, not a reimplementation: `yarn lint` at the root runs each
module's own `lint`, so there is no second definition of what linting means.

The `dev` verb is the one with an ordering. `ouroboros-db`'s is not a process — it starts
PostgreSQL from the compose stack, waits for the healthcheck, migrates, and exits — which
is what lets the other three declare it as a dependency and start against a database that
is already current.

CI runs the locked form of each install — `yarn install --immutable` and
`uv sync --locked` — so a lockfile that has drifted from its manifest fails the run
instead of being silently refreshed.

## 4. Configuration & environment variables

Two rules, no exceptions:

1. **`PORT` is unprefixed.** Every service reads its listen port from `PORT`, because
   that is what container platforms set. Standard platform variables (`NODE_ENV`,
   `HOSTNAME`) likewise stay unprefixed.
2. **Everything Ouroboros-specific is prefixed `OURO_`.** `OURO_DATABASE_URL`,
   `OURO_ENGINE_URL`, `OURO_SESSION_SECRET`, and so on. The prefix makes it obvious at a
   glance which variables belong to this system, and lets a container inherit unrelated
   environment without collision.

Configuration is **validated at boot and fails fast** — zod in the NestJS layer,
pydantic-settings in the engine. A missing or malformed variable exits non-zero naming
the exact variable; it never surfaces as a stack trace on the first request.

Real `.env` files are never committed; the repo-root [`.env.example`](../.env.example)
documents every `OURO_*` variable with its development default and is the file that is.
A module may add its own `.env.example` for the variables only its tooling reads — as
[`ouroboros-db`](../ouroboros-db/.env.example) does for the database `run.sh` migrates —
but the root file stays the complete list, and the module's is a subset of it. The more
specific file wins where both declare a variable.
A variable that no longer appears there is a variable a developer cannot discover, so
[`verify-dev-env.sh`](../scripts/verify-dev-env.sh) fails the build when the template
falls behind either the compose stack or a module README. Secrets are redacted from any
configuration logging.

### Port map (development defaults)

| Service | Port |
|---|---|
| `ouroboros-ui` | 3000 |
| `ouroboros-rest` | 4000 |
| `ouroboros-engine` | 8000 |
| `ouroboros-db` (PostgreSQL) | 5432 |

`ouroboros-web` also defaults to 3000; it is the marketing site and is not part of the
application compose stack, so the two are never up at once.

## 5. Containers

Every module ships a **multi-stage** `Dockerfile` following the pattern already proven
in [`../ouroboros-web/Dockerfile`](../ouroboros-web/Dockerfile):

- separate `deps` → `build` → `runtime` stages, so the runtime image carries no
  toolchain;
- installs are **immutable** from the committed lockfile;
- the process runs as a **non-root user**;
- a `HEALTHCHECK` hits the service's liveness endpoint;
- a `.dockerignore` keeps `.git`, `node_modules`, build output and `.env*` out of the
  build context.

**A workspace module builds from the repository root.** `ouroboros-ui` and
`ouroboros-rest` install from the lockfile at the root (§ 3), so their build context has
to contain it — a context of the module directory alone cannot run an immutable install
at all:

```bash
docker build -f ouroboros-ui/Dockerfile -t ouroboros-ui .    # from the repo root
```

Two consequences, both of which the first such image
([#47](https://github.com/NobuData/ouroboros/issues/47)) settles for the ones that
follow:

- **The ignore file is named for the Dockerfile**, as
  [`ouroboros-ui/Dockerfile.dockerignore`](../ouroboros-ui/Dockerfile.dockerignore).
  BuildKit reads `<dockerfile>.dockerignore` in preference to
  `<context>/.dockerignore`, which is what keeps the ignores in the module they belong
  to: a root `.dockerignore` would apply to every image in the repo, and a
  `<module>/.dockerignore` would apply to nothing while looking exactly like the file
  that governs the build.
- **It is an allow-list** — `*`, then the paths the build reads. With the whole
  repository as the context, a deny-list grows a hole every time a directory is added at
  the root, and what leaks past it is not only size.

This applies only to the modules that *install* through the root lockfile.
`ouroboros-engine`'s `package.json` is a workspace adapter over a `uv` project and
`ouroboros-db`'s is one over Flyway, so neither image needs anything at the root, and
`ouroboros-web` is not a workspace at all: all three build from their own directory with
a plain `.dockerignore` beside the Dockerfile.

### The local development stack

The repo-root [`docker-compose.yml`](../docker-compose.yml) is the development data tier
— PostgreSQL 17 plus the Flyway pass that migrates it
([#10](https://github.com/NobuData/ouroboros/issues/10)). The application services are
added to this same file by [#55](https://github.com/NobuData/ouroboros/issues/55) rather
than to a second one, so there is only ever one stack to bring up:

```bash
docker compose up            # database, migrated and listening on :5432
docker compose down -v       # reset — drops the named volume and all data
```

`yarn dev` (§ 1) drives this same file rather than a second one:
[`ouroboros-db/scripts/dev`](../ouroboros-db/scripts/dev) is `up --detach --wait db`
followed by the compose stack's own `flyway` service. Going through compose for both is
what guarantees the migration lands in the database that was just started: this file
interpolates one set of database credentials, and it reaches the server and the migrator
alike.
[`ouroboros-db/run.sh`](../ouroboros-db/run.sh) answers the other question, migrating a
database wherever it happens to be, and reads the module's own `.env` to do it.

Three rules keep it reproducible:

1. **Images are pinned** to a major version (`postgres:17-alpine`, `flyway/flyway:11`),
   never `latest`, so two developers a month apart get the same database.
2. **Dependencies wait on healthchecks, never on sleeps.** The migrator starts on
   `condition: service_healthy`, which is what stops the first migration racing the
   restart PostgreSQL performs at the end of its own initialisation.
3. **Every credential is interpolated with a development default** —
   `${OURO_DB_USER:-ouroboros}`. A clean checkout runs with no `.env` at all, and a
   literal credential never enters the file.
4. **Published ports name the loopback interface** — `127.0.0.1:5432:5432`. A
   development password is a real password to anything that can reach the port, and
   Docker's default is every interface on the machine.

## 6. Code style

[`.editorconfig`](../.editorconfig) at the repo root is authoritative for indentation,
encoding, line endings and final newlines. Language formatters must agree with it rather
than override it. **Line length is a linter's concern, not EditorConfig's** — it is
declared only where a formatter genuinely enforces it, so prose, tables and generated
markup are not flagged for being unwrappable.

- **TypeScript** — 2 spaces, double quotes (matching `ouroboros-web`), wrapped at ~100
  columns. ESLint flat config; Prettier in the NestJS layer.
- **Python** — 4 spaces, 88 columns, enforced by ruff, which both lints and formats.
- **SQL** — 2 spaces, 100 columns, lower-case keywords, one concern per migration.
- **Markdown** — prose wrapped at ~90 columns by review convention; tables and link-heavy
  lines are exempt. Trailing whitespace is preserved because two trailing spaces are a
  hard line break, and indentation is left unset because list markers dictate it.
- **YAML** — 2 spaces, never tabs.
- **Lockfiles and `LICENSE`** — every rule unset; they are never reformatted.

CSS carries **no hard-coded colour or spacing values** — everything is a design token
from the shared token sheet [`design/tokens.css`](design/tokens.css)
([#16](https://github.com/NobuData/ouroboros/issues/16), documented in
[`DESIGN_TOKENS.md`](DESIGN_TOKENS.md)), so light and dark themes swap by redefining
variables. A colour literal belongs in that sheet's three palette blocks and nowhere else;
[`verify-tokens.sh`](../scripts/verify-tokens.sh) fails a build where one escapes, and
re-derives every published contrast ratio from the sheet so a palette edit cannot quietly
drop below WCAG AA. Font sizes are rem-based; px font sizes are lint-banned so the user
font-scale preference scales every surface.

## 7. Git & GitHub

- **Branches:** `ticket-<issue-number>`, cut from `main`.
- **Commits:** `Fix #<number> - <concise title>`.
- **Pull requests:** into `main`, body carries what/why, how to test, risks, and
  `Closes #<number>`.
- **Issue titles:** `<project>: [<epic>.<issue>] <title>`, e.g.
  `ouroboros-db: [3.2] Baseline tenancy schema — tenants & domains`.
- **Labels:** scope (`mvp`, `v2`), module (`ui`, `rest`, `db`, `engine`), cross-cutting
  (`infra`, `design`, `ci`, `documentation`), plus `epic` on parent issues.
- **Roadmap status:** the roadmap documents in `docs/` carry 🟡 Open / 🟢 Done markers
  per issue; closing an issue updates its marker in the same PR.

### Templates

The new-issue page offers two YAML issue forms
([`.github/ISSUE_TEMPLATE/`](../.github/ISSUE_TEMPLATE)) that collect the anatomy every
roadmap issue shares — release scope, effort, affected systems, problem statement,
solution, acceptance criteria, dependencies, stack. **Feature** files a Feature and
seeds the title convention; **Bug** files a Bug. Blank issues are disabled so nothing
arrives without that structure; re-type a Feature to **Task** for scaffolding,
infrastructure, CI or documentation work.

[`.github/pull_request_template.md`](../.github/pull_request_template.md) auto-populates
every pull request with what/why, changes, how to test, risk notes, `Closes #<number>`,
and the checklist for the conventions above.

### Labels are code

The label set lives in [`.github/labels.yml`](../.github/labels.yml) — name, colour and
description for every label this repository defines — so it is reviewable in a diff and
can be rebuilt from the checkout:

```bash
scripts/sync-labels.sh --dry-run   # report drift
scripts/sync-labels.sh             # create what is missing, update what has drifted
```

The sync is idempotent and **never deletes**: a label on GitHub that the file does not
define is reported and left alone, because deleting one silently strips it from every
issue carrying it. Colours are six hex digits with no leading `#`; `mvp` is the brand
accent cyan `#3dd6f5`.

## 8. Versioning

Each module is versioned **independently** with semver in its own manifest
(`package.json` / `pyproject.toml`). There is no repo-wide version. A change to
`ouroboros-rest` bumps only `ouroboros-rest`. Pre-1.0 modules use `0.x` and may break
between minors.

## 9. CI

Workflows are **path-filtered** so a PR only runs the checks it can affect
([#11](https://github.com/NobuData/ouroboros/issues/11)):

```
ouroboros-ui/**     ─▶ ci/ui      lint · typecheck · test · build
ouroboros-rest/**   ─▶ ci/rest    lint · typecheck · test · build
ouroboros-engine/** ─▶ ci/engine  ruff · pytest
ouroboros-db/**     ─▶ ci/db      flyway migrate · validate · constraints

package.json        ─▶ ci/ui + ci/rest   the workspace both resolve through
yarn.lock
turbo.json
.yarnrc.yml
```

Those four are the one filter that is not a directory. Since the TypeScript modules
became workspaces (§ 1) the lockfile they install from lives at the root, so a change to
it can break both builds without touching either module — and a filter that misses it
would report nothing at all. `ouroboros-web` is unaffected: it is not a workspace, and
`docker-publish.yml` watches only its own directory.

One file per module — [`ui.yml`](../.github/workflows/ui.yml),
[`rest.yml`](../.github/workflows/rest.yml),
[`engine.yml`](../.github/workflows/engine.yml),
[`db.yml`](../.github/workflows/db.yml) — each watching its own directory and its own
definition. Four rules keep them interchangeable:

1. **The job name is the status check name.** `ci/ui`, `ci/rest`, `ci/engine`, `ci/db`
   are what GitHub names the check runs and therefore what branch protection is
   configured against; renaming a job silently un-requires the check.
2. **A version is pinned once.** Node lives in the `node-version` default of
   [`.github/actions/node-module`](../.github/actions/node-module/action.yml), the
   pipeline `ouroboros-ui` and `ouroboros-rest` share; Python lives in `engine.yml`'s
   `PYTHON_VERSION`. No workflow carries a pin of its own.
3. **A module's checks activate with its scaffold.** `ouroboros-rest` is still a README,
   so each workflow asks
   [`.github/actions/scaffold-gate`](../.github/actions/scaffold-gate/action.yml) for
   the module's manifest first and reports why it stopped when there is not one. The
   pull request that adds the `package.json` or `pyproject.toml` is the one that turns
   the checks on — no workflow is edited.
4. **Actions are pinned to a release**, never to `@main`, and every workflow asks for no
   more than `contents: read`.

`ci/db` runs in two halves, and the order is deliberate — the cheap half first, so a
misnamed migration is reported before a database is waited on.

**What needs no database** — migration naming, the pinned images and healthcheck gate,
the Flyway project's own settings, credential hygiene, the environment template — then
the module's tooling tests ([`ouroboros-db/tests`](../ouroboros-db/tests)), which
exercise the migration runner and its `scripts/` wrappers against stubbed runners.
Seconds, no daemon, no network.

**The live pass** ([#24](https://github.com/NobuData/ouroboros/issues/24)): a
`postgres:17-alpine` service container — the same image
[`docker-compose.yml`](../docker-compose.yml) pins, so a pull request proves what a
developer gets — migrated from empty by `ouroboros-db/scripts/migrate`, validated by
`ouroboros-db/scripts/validate`, then asked what it actually enforces by
[`tests/constraints.sql`](../ouroboros-db/tests/constraints.sql). A second database is
migrated twice with the dev-seed overlay and asserted by
[`tests/seed.sql`](../ouroboros-db/tests/seed.sql), which is both the seed's content
check and its idempotency check — every assertion in it says *exactly one*.

Two things about that pass are worth stating, because they are what make it worth
running. It uses the module's own `scripts/` commands rather than a `flyway` invocation
written into the workflow, so CI and a laptop apply the same checkout under the same
rules — both read [`flyway.toml`](../ouroboros-db/flyway.toml). And `validate` compares
checksums, not behaviour: a `unique` on the wrong columns, a cascade left off or a check
that accepts what it should reject passes it untouched, which is why the `.sql` suites
exist and why **a migration that adds a rule adds its assertion in the same change.**

One consequence of filtering by path is worth stating: **a check that does not run does
not report.** These four are advisory today. Marking one *required* in branch protection
would leave every pull request that does not touch its module waiting for a check that
will never arrive, so making them required means giving each one a companion job that
reports the skip — not simply ticking the box.

Repo-level checks are dependency-free POSIX shell and safe to run locally at any time:

| Script | What it asserts |
|---|---|
| [`verify-layout.sh`](../scripts/verify-layout.sh) | Module directories, README sections, root docs, `.editorconfig` coverage |
| [`verify-github-config.sh`](../scripts/verify-github-config.sh) | Label definitions parse and cover the taxonomy; issue forms and PR template carry their required sections |
| [`verify-dev-env.sh`](../scripts/verify-dev-env.sh) | Compose stack pins, healthchecks and interpolates its credentials; `.env.example` declares every variable read; migrations are named to the rule |
| [`verify-ci.sh`](../scripts/verify-ci.sh) | Status-check names; path filters route each change to exactly the workflows it can affect; toolchain pins live in one place; every step waits for its scaffold; `ci/db` still starts a database, migrates it, validates it and runs both `.sql` suites, against the PostgreSQL the development stack pins |
| [`verify-workspace.sh`](../scripts/verify-workspace.sh) | The decisions in [`DECISION_WORKSPACE_TOOLING.md`](DECISION_WORKSPACE_TOOLING.md) still hold: the roster is these four modules with `ouroboros-web` outside it, one lockfile, both versions pinned exactly, every repo-level verb reaching a declared task and every task a verb, nothing Docker-facing cached, and every script that reads above its own package declaring it in that task's inputs |
| [`verify-brand.sh`](../scripts/verify-brand.sh) | [`BRAND.md`](BRAND.md) and [`brand/`](brand) agree: every asset is a PNG with an alpha channel, at the size the document publishes, named and linked by it |
| [`verify-tokens.sh`](../scripts/verify-tokens.sh) | [`design/tokens.css`](design/tokens.css) parses to exactly three palette blocks with no literal outside them, both dark blocks are identical, every colour is themed in both palettes, the dark palette still matches the mockups' sheet, the preview page carries no literal, and every contrast ratio [`DESIGN_TOKENS.md`](DESIGN_TOKENS.md) publishes is the recomputed one, at or above its minimum |
| [`verify-favicons.sh`](../scripts/verify-favicons.sh) | The favicon set in [`../ouroboros-ui/public`](../ouroboros-ui/public) is the size and colour type each file promises, `favicon.ico` carries every resolution it should, the manifest names only files that exist, and [`BRAND.md`](BRAND.md) and the module README still describe the set on disk |
| [`verify-architecture.sh`](../scripts/verify-architecture.sh) | [`ARCHITECTURE.md`](ARCHITECTURE.md) carries its required sections, renders its diagrams, states every invariant, resolves every link, and documents exactly the `OURO_*` variables `.env.example` declares |
| [`run-tests.sh`](../scripts/run-tests.sh) | Runs every shell suite — `scripts/tests/*.test.sh` for the tooling above, and each module's own `tests/*.test.sh`, as [`ouroboros-db`](../ouroboros-db/tests) has. Name a directory to run one suite: `scripts/run-tests.sh ouroboros-db/tests` |

They share one assertion harness, [`scripts/lib/checks.sh`](../scripts/lib/checks.sh), so
every check reads and reports the same way.

## 10. Architectural invariants

These are properties of the system, not preferences, and a change that breaks one needs
an architecture decision rather than a code review:

1. **The UI never touches the database or the engine.** All browser traffic goes through
   `ouroboros-rest`.
2. **Flyway owns all DDL.** No application module creates or alters schema.
3. **The engine is internal.** It is reachable only from `ouroboros-rest`, authenticated
   by a shared secret.
4. **Tenancy is enforced in one place** — the REST layer's tenant-context resolution
   (with database row-level security as later defence in depth,
   [#25](https://github.com/NobuData/ouroboros/issues/25)).
