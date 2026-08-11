# ouroboros-rest

> **Status:** the service scaffold landed with
> [#27](https://github.com/NobuData/ouroboros/issues/27) (epic
> [#4](https://github.com/NobuData/ouroboros/issues/4)). What runs today is the skeleton —
> a NestJS application answering a heartbeat on `/api/v1`, with the lint, typecheck, test
> and build pipeline `ci/rest` runs. The feature modules listed under
> [Layout](#layout) are what land on it.

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
| Data access | Kysely over `pg` — no ORM; Flyway owns the schema ([#30](https://github.com/NobuData/ouroboros/issues/30)) |
| Config | `@nestjs/config` + zod validation, fail-fast at boot ([#28](https://github.com/NobuData/ouroboros/issues/28)) |
| API docs | `@nestjs/swagger` → `/api/docs` + exported `openapi.json` ([#34](https://github.com/NobuData/ouroboros/issues/34)) |
| Tests | Jest (unit) + Supertest & Testcontainers (integration, [#37](https://github.com/NobuData/ouroboros/issues/37)) |
| Lint | ESLint flat config + Prettier |
| Container | Multi-stage Dockerfile, non-root, `HEALTHCHECK` on `/health/live` ([#36](https://github.com/NobuData/ouroboros/issues/36)) |

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

`yarn dev` is `nest start --watch`; `yarn start` runs the compiled `dist/main.js`, which
is also what the container ([#36](https://github.com/NobuData/ouroboros/issues/36)) will
run. The heartbeat is the whole of the surface today:

```console
$ curl http://localhost:4000/api/v1
{"service":"ouroboros-rest","version":"0.1.0","status":"ok","uptimeSeconds":3.885}
```

Formatting is not a separate check: Prettier runs as a lint rule, so `yarn lint` fails on
a badly formatted file and `yarn format` is the fixer. `yarn test:watch` re-runs the unit
suite on save.

This directory is a **Yarn workspace**
([#13](https://github.com/NobuData/ouroboros/issues/13)): its `package.json` carries no
`packageManager` and no lockfile of its own — the repo-root `package.json`, `yarn.lock`
and `.yarnrc.yml` are what the commands above resolve through, and the workspace list at
the root already names this directory. `ouroboros-ui` is the sibling implementation.

A running database is required for anything past the heartbeat. `yarn dev` from the repo
root brings one up, migrated, before it starts this service — and starts
`ouroboros-engine` beside it, which is the other thing this module needs
([conventions § 1](../docs/CONVENTIONS.md#1-repository-shape)). `docker compose up db`
([#10](https://github.com/NobuData/ouroboros/issues/10)) is the data tier on its own.

## Configuration

Development default port: **4000** (`PORT`). All service configuration is validated at
boot; a missing or malformed variable exits non-zero naming the exact variable.

| Variable | Purpose | Read today |
|---|---|:---:|
| `PORT` | HTTP listen port | yes |
| `NODE_ENV` | `development` \| `production` \| `test` | yes |
| `OURO_DATABASE_URL` | PostgreSQL connection string for `ouroboros-db` | [#28](https://github.com/NobuData/ouroboros/issues/28) |
| `OURO_ENGINE_URL` | Base URL of `ouroboros-engine`, e.g. `http://localhost:8000` | [#28](https://github.com/NobuData/ouroboros/issues/28) |
| `OURO_ENGINE_SHARED_SECRET` | Shared secret for the internal engine call | [#28](https://github.com/NobuData/ouroboros/issues/28) |
| `OURO_SESSION_SECRET` | Signing key for the session cookie | [#28](https://github.com/NobuData/ouroboros/issues/28) |
| `OURO_GITHUB_CLIENT_ID` / `OURO_GITHUB_CLIENT_SECRET` | GitHub OAuth application | [#28](https://github.com/NobuData/ouroboros/issues/28) |

Every one of them is documented with a development default in the repo-root
[`.env.example`](../.env.example). The scaffold reads the two unprefixed platform
variables only, in [`src/env.ts`](src/env.ts), and validates them to the rule the rest
will follow: `PORT` must be a whole number between 1 and 65535, and anything else names
the variable and exits `2`. `NODE_ENV` decides which interface is bound — every interface
in production, where the platform routes to the container; loopback everywhere else, so a
development machine does not answer to the network it is on.

The `OURO_*` variables arrive with the typed, zod-validated configuration module in
[#28](https://github.com/NobuData/ouroboros/issues/28). Secrets are redacted from any
configuration logging and never committed.

## Layout

```
ouroboros-rest/
├── src/
│   ├── main.ts             # entry point: read the environment, listen, report
│   ├── application.ts      # /api/v1 prefix, URI versioning, shutdown hooks
│   ├── env.ts              # PORT and NODE_ENV, validated (#28 takes the rest)
│   ├── version.ts          # the running build, read from package.json
│   └── modules/
│       ├── app/            # heartbeat — controller, service, root module
│       ├── config/         # validated OURO_* config          · #28
│       ├── health/         # /health/live, /health/ready       · #29
│       ├── db/             # Kysely instance + pool lifecycle  · #30
│       ├── tenancy/        # tenants, domains, members         · #31
│       ├── auth/           # GitHub OAuth, sessions, guards    · #33
│       └── engine/         # typed internal client             · #35
├── eslint.config.mjs       # flat config; Prettier runs as a lint rule
├── jest.config.mjs         # unit suite — src/**/*.spec.ts
├── nest-cli.json
├── tsconfig.json           # strict; what typecheck, ts-jest and the linter read
└── tsconfig.build.json     # the same, minus the specs — what ships
```

Everything below `src/modules/` after `app/` is named above and does not exist yet; each
arrives as one directory and one entry in `AppModule`'s `imports`.

Unit tests sit beside the code they cover as `*.spec.ts`, which is the Nest convention
and what the CLI's schematics generate. They start nothing and need nothing — the
integration suite that wants a database is
[#37](https://github.com/NobuData/ouroboros/issues/37).

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
