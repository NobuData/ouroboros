# ouroboros-rest

> **Status:** directory reserved — the service scaffold lands in
> [#27](https://github.com/NobuData/ouroboros/issues/27) (epic
> [#4](https://github.com/NobuData/ouroboros/issues/4)). Until then this README is the
> contract the scaffold must satisfy.

## Purpose

The **communications layer** — the single boundary between the browser and everything
behind it. It owns authentication, sessions, tenant-context resolution, the tenancy API,
and the gateway to `ouroboros-engine`.

It is the **only** module that talks to `ouroboros-db` and the **only** module that
talks to `ouroboros-engine`. Concentrating both there is what keeps tenancy enforcement
in a single, auditable place.

## Stack

| Concern | Choice |
|---|---|
| Framework | NestJS 11 |
| Language | TypeScript 5, `strict` |
| Package manager | Yarn 4 via corepack (`nodeLinker: node-modules`) |
| Runtime | Node 24 |
| Data access | Kysely over `pg` — no ORM; Flyway owns the schema |
| Config | `@nestjs/config` + zod validation, fail-fast at boot |
| API docs | `@nestjs/swagger` → `/api/docs` + exported `openapi.json` |
| Tests | Jest (unit) + Supertest & Testcontainers (integration) |
| Lint | ESLint flat config + Prettier |
| Container | Multi-stage Dockerfile, non-root, `HEALTHCHECK` on `/health/live` |

## Run

```bash
yarn install    # immutable install from the committed lockfile
yarn dev        # http://localhost:4000/api/v1
yarn lint
yarn typecheck
yarn test
yarn build && yarn start
```

`lint`, `typecheck`, `test` and `build` are what `ci/rest` runs on every pull request
touching this directory — see [conventions](../docs/CONVENTIONS.md#9-ci).

The scaffold lands this directory as a **Yarn workspace**
([#13](https://github.com/NobuData/ouroboros/issues/13)): the `package.json` it adds
carries no `packageManager` and no lockfile of its own — the repo-root `package.json`,
`yarn.lock` and `.yarnrc.yml` are what the commands above resolve through, and the
workspace list at the root already names this directory, so nothing has to be wired up
when it arrives. `ouroboros-ui` is the reference implementation.

A running database is required for anything past the heartbeat. `yarn dev` from the repo
root brings one up, migrated, before it starts this service — and starts
`ouroboros-engine` beside it, which is the other thing this module needs
([conventions § 1](../docs/CONVENTIONS.md#1-repository-shape)). `docker compose up db`
([#10](https://github.com/NobuData/ouroboros/issues/10)) is the data tier on its own.

## Configuration

Development default port: **4000** (`PORT`). All service configuration is validated at
boot; a missing or malformed variable exits non-zero naming the exact variable.

| Variable | Purpose |
|---|---|
| `PORT` | HTTP listen port |
| `NODE_ENV` | `development` \| `production` \| `test` |
| `OURO_DATABASE_URL` | PostgreSQL connection string for `ouroboros-db` |
| `OURO_ENGINE_URL` | Base URL of `ouroboros-engine`, e.g. `http://localhost:8000` |
| `OURO_ENGINE_SHARED_SECRET` | Shared secret for the internal engine call |
| `OURO_SESSION_SECRET` | Signing key for the session cookie |
| `OURO_GITHUB_CLIENT_ID` / `OURO_GITHUB_CLIENT_SECRET` | GitHub OAuth application |

Secrets are redacted from any configuration logging and never committed.

## Layout (target)

```
ouroboros-rest/
├── src/
│   ├── main.ts             # bootstrap, /api/v1 prefix, shutdown hooks
│   └── modules/
│       ├── app/            # heartbeat
│       ├── config/         # validated OURO_* config
│       ├── health/         # /health/live, /health/ready
│       ├── db/             # Kysely instance + pool lifecycle
│       ├── tenancy/        # tenants, domains, members, org enablement
│       ├── auth/           # GitHub OAuth, sessions, guards
│       └── engine/         # typed internal client to ouroboros-engine
└── Dockerfile
```

## Related issues

Scaffold [#27](https://github.com/NobuData/ouroboros/issues/27) ·
config [#28](https://github.com/NobuData/ouroboros/issues/28) ·
health [#29](https://github.com/NobuData/ouroboros/issues/29) ·
data access [#30](https://github.com/NobuData/ouroboros/issues/30) ·
tenancy API [#31](https://github.com/NobuData/ouroboros/issues/31) ·
auth [#33](https://github.com/NobuData/ouroboros/issues/33) ·
full epic [#4](https://github.com/NobuData/ouroboros/issues/4).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
