# Ouroboros — repository conventions

The rules every module in this monorepo follows. They exist so a developer moving
between `ouroboros-ui`, `ouroboros-rest`, `ouroboros-engine` and `ouroboros-db` finds
the same shapes in the same places, and so four modules across three toolchains do not
each invent their own.

Filed as issue [#8](https://github.com/NobuData/ouroboros/issues/8). The system design
these conventions serve is described in
[`ARCHITECTURE.md`](ARCHITECTURE.md) (landing in
[#12](https://github.com/NobuData/ouroboros/issues/12)); the plan that produced them is
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
└── scripts/           # repo-level tooling
```

**Each module is self-contained.** It owns its toolchain, its lockfile, its lint and
test configuration, its `Dockerfile`, and its `.dockerignore`. There is deliberately no
workspace runner (Turborepo/Nx) yet — adopting one is a post-MVP decision tracked in
[#13](https://github.com/NobuData/ouroboros/issues/13). Duplication of a few scripts is
the price of every module staying independently buildable.

**Directory names are kebab-case and prefixed `ouroboros-`.** A module directory is
never nested inside another module.

## 2. Every module directory contains

| File | Required | Why |
|---|:---:|---|
| `README.md` | yes | Purpose, stack, run instructions, configuration — the entry point |
| `Dockerfile` | yes, once scaffolded | Every module ships as a container |
| `.dockerignore` | yes, with the Dockerfile | Keeps build context small and secrets out |
| `.gitignore` | yes | Module-local artefacts, so the directory is portable |
| Lockfile | yes | `yarn.lock` (TS) or `uv.lock` (Python) — committed, installs are immutable |

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
`packageManager` field, with `nodeLinker: node-modules` in `.yarnrc.yml` — matching
`ouroboros-web`, which is the reference implementation. CI and Docker builds run
`yarn install --immutable`; a lockfile that does not match `package.json` fails the
build rather than silently updating.

**Python uses uv** — `uv sync` for install, `uv run <cmd>` for everything else. `uv.lock`
is committed. Lint and format are ruff; tests are pytest.

**SQL uses Flyway from its container**, so no module requires a local Java install.

### Standard task names

Each toolchain exposes the same five verbs, so CI and humans can rely on them:

| Task | TypeScript | Python |
|---|---|---|
| install | `yarn install --immutable` | `uv sync` |
| dev | `yarn dev` | `uv run dev` |
| lint | `yarn lint` | `uv run ruff check .` |
| test | `yarn test` | `uv run pytest` |
| build | `yarn build` | (container build) |

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
from the shared token sheet ([#16](https://github.com/NobuData/ouroboros/issues/16)), so
light and dark themes swap by redefining variables. Font sizes are rem-based; px font
sizes are lint-banned so the user font-scale preference scales every surface.

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
```

Repo-level checks are dependency-free POSIX shell and safe to run locally at any time:

| Script | What it asserts |
|---|---|
| [`verify-layout.sh`](../scripts/verify-layout.sh) | Module directories, README sections, root docs, `.editorconfig` coverage |
| [`verify-github-config.sh`](../scripts/verify-github-config.sh) | Label definitions parse and cover the taxonomy; issue forms and PR template carry their required sections |
| [`verify-dev-env.sh`](../scripts/verify-dev-env.sh) | Compose stack pins, healthchecks and interpolates its credentials; `.env.example` declares every variable read; migrations are named to the rule |
| [`run-tests.sh`](../scripts/run-tests.sh) | Runs `scripts/tests/*.test.sh` — the unit and integration tests for the tooling above |

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
