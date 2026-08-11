# Ouroboros

**Infinity in Autonomy** — an autonomous software delivery loop: issues in, verified
pull requests out, continuously.

This repository is a monorepo of modules across three toolchains, each owning how it is
built, run and tested, with [Turborepo](https://turborepo.com) over them so that one
command starts the whole stack:

```bash
yarn install    # every workspace, from one lockfile
yarn dev        # PostgreSQL, migrated · engine · rest · UI — in order, in one terminal
```

See [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) for the rules the modules share and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the system design in depth — the
modules, the boundaries between them, the request paths, and the `OURO_*` registry.

## Module map

| Directory | Purpose | Stack | Port | Epic |
|---|---|---|:---:|:---:|
| [`ouroboros-ui/`](ouroboros-ui) | Product UI — the application users sign into | Next.js (App Router), TypeScript, Yarn | 3000 | [#5](https://github.com/NobuData/ouroboros/issues/5) |
| [`ouroboros-rest/`](ouroboros-rest) | Communications layer — auth, tenancy, gateway | NestJS 11, TypeScript, Kysely, Yarn | 4000 | [#4](https://github.com/NobuData/ouroboros/issues/4) |
| [`ouroboros-engine/`](ouroboros-engine) | Backend work execution | Python 3.12, FastAPI, uv | 8000 | [#6](https://github.com/NobuData/ouroboros/issues/6) |
| [`ouroboros-db/`](ouroboros-db) | Tenancy schema and migrations | PostgreSQL 17, Flyway 11, SQL | 5432 | [#3](https://github.com/NobuData/ouroboros/issues/3) |
| [`ouroboros-web/`](ouroboros-web) | Marketing site — [ouroboros.build](https://ouroboros.build) | Next.js, TypeScript, Yarn | 3000 | — |
| [`docs/`](docs) | Mockups, design system, brand assets, roadmaps, architecture | Markdown, HTML | — | — |

`ouroboros-web` is the public marketing site and is **not** part of the application
stack — it ships and deploys on its own.

The four application modules are scaffolded by their epics; today each directory holds
the README that defines the contract its scaffold must satisfy.

## Architecture

```mermaid
flowchart LR
    subgraph Browser
        UI["ouroboros-ui<br/>Next.js · light/dark themes"]
    end
    subgraph "Communications layer"
        REST["ouroboros-rest<br/>NestJS · auth · tenancy · gateway"]
    end
    subgraph Backend
        ENGINE["ouroboros-engine<br/>Python · FastAPI"]
    end
    subgraph Data
        DB[("ouroboros-db<br/>PostgreSQL 17 · Flyway")]
    end

    UI -- "HTTPS / JSON<br/>(generated TS client)" --> REST
    REST -- "internal HTTP<br/>(shared secret)" --> ENGINE
    REST -- "Kysely / pg" --> DB
```

Only `ouroboros-rest` talks to the database and to the engine. The UI reaches neither
directly — that single boundary is what keeps tenancy enforcement in one auditable
place. The full set of invariants is in
[`docs/CONVENTIONS.md`](docs/CONVENTIONS.md#10-architectural-invariants).

## Repository layout

```
ouroboros/
├── docs/              # mockups, design system, brand assets, roadmaps, conventions
├── ouroboros-web/     # marketing site (deployed at ouroboros.build)
├── ouroboros-ui/      # Next.js product UI
├── ouroboros-rest/    # NestJS communications layer
├── ouroboros-engine/  # Python/FastAPI backend
├── ouroboros-db/      # Flyway migrations
├── scripts/           # repo-level tooling
├── .github/           # labels, issue forms, PR template, workflows
├── package.json       # the Yarn workspace and the repo-level verbs
├── turbo.json         # the task graph — what `yarn dev` starts, and in what order
├── yarn.lock          # one resolution for every workspace
├── docker-compose.yml # local development data tier — PostgreSQL + Flyway
├── .env.example       # every OURO_* variable, with development defaults
├── .editorconfig      # repo-wide editor conventions
└── .gitignore         # repo-wide ignores
```

## Getting started

You need [Node 24](https://nodejs.org) with corepack, [uv](https://docs.astral.sh/uv/)
and Docker. From a clean checkout:

```bash
corepack enable      # Yarn 4, pinned by package.json
yarn install         # every workspace, from the committed lockfile
yarn dev             # the whole application stack
```

`yarn dev` starts PostgreSQL, waits for its healthcheck, applies every pending
migration, and then brings the services up side by side, streaming all of their logs
into one terminal:

| | |
|---|---|
| `ouroboros-ui` | http://localhost:3000 |
| `ouroboros-rest` | http://localhost:4000 — once [#27](https://github.com/NobuData/ouroboros/issues/27) lands |
| `ouroboros-engine` | http://127.0.0.1:8000 |
| `ouroboros-db` | `postgresql://ouroboros:ouroboros@localhost:5432/ouroboros` |

`Ctrl-C` stops the services; the database is a container and keeps running, which is
usually what you want between restarts. `yarn dev:stop` stops it too, and
`yarn dev:reset` drops the volume with it. If something else on the machine already
holds 5432, publish this one somewhere else — `OURO_DB_PORT=45432 yarn dev`.

The marketing site is deliberately not part of that stack: it deploys on its own and
wants the same port 3000 the product UI does. `yarn dev:web` runs it by itself.

Repo-level verbs fan the same task out across every module — `yarn build`, `yarn lint`,
`yarn typecheck`, `yarn test`. Each one runs that module's own script, so there is no
second definition of what any of them means, and results are cached: a second
`yarn test` with nothing changed replays rather than re-runs.

### The database on its own

The data tier also comes up without the rest of the stack, which is what `yarn dev` uses
underneath:

```bash
docker compose up            # PostgreSQL 17 on :5432, Flyway migrations applied
docker compose down -v       # reset — stops everything and drops the volume
```

That is the whole setup: `up` starts PostgreSQL, waits for its healthcheck, applies
every migration in [`ouroboros-db/migrations/`](ouroboros-db/migrations), and leaves the
database listening. It needs no `.env` — every value has a development default — and
is safe to repeat, because Flyway applies only what is pending. `docker compose up db`
brings up the database alone, without a migration pass. See
[`ouroboros-db/README.md`](ouroboros-db/README.md) for how to connect and how to read
the applied versions.

To migrate a database that is already running — the compose one, a PostgreSQL installed
on your machine, or a server across the network — use the module's own commands, which
need nothing containerised:

```bash
ouroboros-db/scripts/migrate     # apply pending migrations
ouroboros-db/scripts/info        # applied and pending versions
ouroboros-db/scripts/validate    # checksums and naming rules
ouroboros-db/scripts/clean-dev   # drop everything — development databases only
```

They are named commands over [`ouroboros-db/run.sh`](ouroboros-db/run.sh), which is
still there for anything they do not cover. All of them read one configuration —
[`ouroboros-db/flyway.toml`](ouroboros-db/flyway.toml), the same file the compose stack
above applies its migrations with.

Where there is no checkout to run those from — a deployment, a pipeline elsewhere —
there is the published migration image, which carries the same migrations and the same
configuration and takes the same `OURO_*` variables:

```bash
docker run --rm \
  -e OURO_DB_HOST=db.internal -e OURO_DB_USER=ouroboros -e OURO_DB_PASSWORD=… \
  "$DOCKER_HOSTNAME"/ouroboros-db:latest
```

It is a task, not a service: it applies what is pending and exits. `ci/db` builds it on
every run and pushes it once the whole job is green on `main` — see
[`ouroboros-db/README.md`](ouroboros-db/README.md#the-image).

Every module also builds and runs on its own, which is how CI runs them and how you work
on one in isolation — see its README for the specifics:

```bash
# TypeScript modules (ouroboros-ui, ouroboros-rest, ouroboros-web)
yarn install --immutable && yarn dev

# Python module (ouroboros-engine)
uv sync && OURO_ENGINE_SHARED_SECRET=dev-engine-shared-secret-change-me uv run dev
```

`ouroboros-engine` is the one module that will not start on defaults alone: it is
internal-only, every path but `/healthz` requires the shared secret, and a process
without one could serve nothing — so it names the missing variable and exits rather than
starting. Export it (`.env.example` carries the development value) and `yarn dev` runs
the whole stack as before.

`ouroboros-web`, `ouroboros-ui` ([#39](https://github.com/NobuData/ouroboros/issues/39))
and `ouroboros-engine` ([#50](https://github.com/NobuData/ouroboros/issues/50)) are
scaffolded; `ouroboros-rest` becomes live when
[#27](https://github.com/NobuData/ouroboros/issues/27) lands. The full-stack compose file
that adds those services to this one is
[#55](https://github.com/NobuData/ouroboros/issues/55).

Environment variables are prefixed `OURO_` (except `PORT` and platform standards), are
validated at boot, and are documented with their development defaults in
[`.env.example`](.env.example). Copy it to `.env` to override any of them; real `.env`
files are never committed.

Repository structure and GitHub configuration can be checked at any time, and the
repo-level tooling has its own tests:

```bash
scripts/verify-layout.sh          # module layout, READMEs, .editorconfig coverage
scripts/verify-github-config.sh   # label definitions, issue forms, PR template
scripts/verify-dev-env.sh         # compose stack, .env.example, migration naming
scripts/verify-ci.sh              # workflow status checks, path routing, toolchain pins
scripts/verify-workspace.sh       # the workspace roster, the task graph, the cache boundaries
scripts/verify-architecture.sh    # architecture doc sections, port map, env registry, links
scripts/verify-brand.sh           # brand assets carry alpha, at the sizes BRAND.md publishes
scripts/verify-favicons.sh        # favicon set, manifest and the documents that describe them
scripts/run-tests.sh              # every shell suite: scripts/tests and each module's
```

`verify-dev-env.sh` reads files and starts nothing, so it runs with Docker stopped —
whether the stack really comes up is what `docker compose up` answers.

## Continuous integration

Every module has its own workflow, filtered to its own directory, so a pull request runs
only the checks it can affect:

| Change | Status check | What runs |
|---|---|---|
| `ouroboros-ui/**` | `ci/ui` | `yarn install --immutable` → lint → typecheck → test → build |
| `ouroboros-rest/**` | `ci/rest` | the same pipeline, against `ouroboros-rest` |
| `ouroboros-engine/**` | `ci/engine` | `uv sync --locked` → `ruff check` → `ruff format --check` → `pytest` |
| `ouroboros-db/**` | `ci/db` → `publish/db` | the migration and data-tier contract, then the module's tooling tests, then a live migration pass; the migration image is built on every run and pushed once `ci/db` is green on `main` |
| `ouroboros-web/**` | `ouroboros-web · build & publish` | the marketing site's own build and image push |
| `package.json`, `yarn.lock`, `turbo.json`, `.yarnrc.yml` | `ci/ui` + `ci/rest` | the workspace both TypeScript modules resolve through |

A change to `docs/` or to `scripts/` queues none of them; a change to the pipeline the
TypeScript modules share queues both of the modules that run it, and so does a change to
the workspace root they install from.

Each module's checks run that module's own verbs from inside its own directory, not
through `turbo run`. That is deliberate: a break in the task graph must never be what
makes a module's checks pass.

`ouroboros-rest` is still a README, so each workflow looks for its module's manifest
first and reports why it stopped when there is not one. Nothing has to be edited when a
scaffold lands — the pull request that adds a `package.json` or a `pyproject.toml` is the
one that turns that module's checks on, as this one did for `ci/engine`.

`scripts/verify-ci.sh` asserts all of the above from the checkout: the check names, the
routing table, the Node and Python pins, and that every step waits for its scaffold.

## Documentation

| Document | What it covers |
|---|---|
| [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) | Toolchains, env vars, containers, code style, git workflow |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System diagram, module contracts, request paths, auth flow, API contracts, port map, `OURO_*` registry, invariants |
| [`docs/BRAND.md`](docs/BRAND.md) | The logo asset set, which treatment goes on which surface, clear space, minimum sizes |
| [`docs/DESIGN_TOKENS.md`](docs/DESIGN_TOKENS.md) | The light and dark palettes as CSS custom properties, the type, spacing and shape scales, and the measured WCAG contrast for both |
| [`docs/DESIGN_SYSTEM_APP_SHELL.md`](docs/DESIGN_SYSTEM_APP_SHELL.md) | The application shell specification |
| [`docs/DECISION_WORKSPACE_TOOLING.md`](docs/DECISION_WORKSPACE_TOOLING.md) | Why the workspace runner is Turborepo and not Nx or plain scripts — what was measured, what it does not buy, and what would reopen the question |
| [`docs/mockups/`](docs/mockups) | 22 designed screens plus the design-system stylesheet |
| [`docs/ROADMAP_OUROBOROS_APPLICATION_SCAFFOLDING.md`](docs/ROADMAP_OUROBOROS_APPLICATION_SCAFFOLDING.md) | The plan this repository is executing |

## Contributing

Work is tracked as GitHub issues grouped into epics. File one with the **Feature** or
**Bug** form on the new-issue page, branch `ticket-<number>` from `main`, commit as
`Fix #<number> - <title>`, and open a pull request that closes the issue — the pull
request template carries the checklist. The conventions doc has the details.

Labels are defined in [`.github/labels.yml`](.github/labels.yml) rather than only in
GitHub's settings, so the set is reviewable and can be rebuilt:

```bash
scripts/sync-labels.sh --dry-run   # what would change
scripts/sync-labels.sh             # create what is missing, update what has drifted
```

## License

[Apache License 2.0](LICENSE).
