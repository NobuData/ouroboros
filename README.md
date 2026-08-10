# Ouroboros

**Infinity in Autonomy** — an autonomous software delivery loop: issues in, verified
pull requests out, continuously.

This repository is a monorepo of independent modules. Each one owns its toolchain and
builds on its own; there is no workspace runner between them. See
[`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) for the rules they share and
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
├── docker-compose.yml # local development data tier — PostgreSQL + Flyway
├── .env.example       # every OURO_* variable, with development defaults
├── .editorconfig      # repo-wide editor conventions
└── .gitignore         # repo-wide ignores
```

## Getting started

The database is the one piece that runs today. From a clean checkout, with Docker
running:

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

Each module is built and run on its own — see its README for the specifics:

```bash
# TypeScript modules (ouroboros-ui, ouroboros-rest, ouroboros-web)
yarn install --immutable && yarn dev

# Python module (ouroboros-engine)
uv sync && uv run dev
```

Only `ouroboros-web` is scaffolded today; the other commands become live as their
scaffolding issues land ([#39](https://github.com/NobuData/ouroboros/issues/39),
[#27](https://github.com/NobuData/ouroboros/issues/27),
[#50](https://github.com/NobuData/ouroboros/issues/50)). The full-stack compose file
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
| `ouroboros-db/**` | `ci/db` | the migration and data-tier contract, then the module's tooling tests |
| `ouroboros-web/**` | `ouroboros-web · build & publish` | the marketing site's own build and image push |

A change to `docs/` or to `scripts/` queues none of them; a change to the pipeline the
TypeScript modules share queues both of the modules that run it.

Three of the four modules are still a README, so each workflow looks for its module's
manifest first and reports why it stopped when there is not one. Nothing has to be
edited when a scaffold lands — the pull request that adds a `package.json` or a
`pyproject.toml` is the one that turns that module's checks on.

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
