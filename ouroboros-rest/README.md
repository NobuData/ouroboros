# ouroboros-rest

> **Status:** the service scaffold landed with
> [#27](https://github.com/NobuData/ouroboros/issues/27), validated configuration with
> [#28](https://github.com/NobuData/ouroboros/issues/28), the health probes with
> [#29](https://github.com/NobuData/ouroboros/issues/29), the database access layer with
> [#30](https://github.com/NobuData/ouroboros/issues/30), the tenancy API with
> [#31](https://github.com/NobuData/ouroboros/issues/31), GitHub sign-in with
> [#33](https://github.com/NobuData/ouroboros/issues/33) and the tenant context with
> [#32](https://github.com/NobuData/ouroboros/issues/32) (epic
> [#4](https://github.com/NobuData/ouroboros/issues/4)). What runs today is a NestJS
> application answering a heartbeat on `/api/v1`, publishing
> [the specification it is written against](#the-api-specification), reading every setting
> through [a typed, fail-fast configuration module](#configuration), reporting
> [whether it is live and whether its dependencies are reachable](#health-and-readiness),
> holding [a typed, pooled connection to the tenancy schema](#data-access), serving
> [the first real API of the system](#the-tenancy-api) over it,
> [signing people in with GitHub](#signing-in) and
> [scoping every request to one workspace](#the-tenant-context) — with the lint, typecheck,
> test and build pipeline `ci/rest` runs.
>
> **Every route requires a session, and every route but four requires a workspace.** A
> workspace you are not a member of answers `404` rather than `403`, and administering one
> needs `owner` or `admin`. The [engine gateway](#the-engine-gateway)
> ([#35](https://github.com/NobuData/ouroboros/issues/35)) is in: one typed client, one
> route, and every way the engine can fail answered as one `502`. It
> [ships as a container](#container)
> ([#36](https://github.com/NobuData/ouroboros/issues/36)) — multi-stage, non-root, healthy
> on `/health/live`, 226 MB against a 300 MB budget. The
> [integration harness](#running-the-integration-suite)
> ([#37](https://github.com/NobuData/ouroboros/issues/37)) is in: `yarn test:integration`
> starts its own migrated PostgreSQL, so the suite that proves the constraint mapping and
> the role matrix needs nothing but Docker. What is left in the epic is the security
> baseline ([#38](https://github.com/NobuData/ouroboros/issues/38)); the remaining feature
> modules are listed under [Layout](#layout).

## Purpose

The **communications layer** — the single boundary between the browser and everything
behind it. It owns authentication, sessions, tenant-context resolution, the tenancy API,
and the gateway to `ouroboros-engine`.

It is the **only** module that talks to `ouroboros-db` and the **only** module that
talks to `ouroboros-engine`. Concentrating both there is what keeps tenancy enforcement
in a single, auditable place.

## Stack

| Concern         | Choice                                                                                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework       | NestJS 11                                                                                                                                                                  |
| Language        | TypeScript 5, `strict`                                                                                                                                                     |
| Package manager | Yarn 4 via corepack (`nodeLinker: node-modules`)                                                                                                                           |
| Runtime         | Node 24                                                                                                                                                                    |
| Data access     | Kysely over `pg` — no ORM; Flyway owns the schema, and the `Database` interface mirrors the migrations ([#30](https://github.com/NobuData/ouroboros/issues/30))            |
| Config          | `@nestjs/config` + zod validation, fail-fast at boot ([#28](https://github.com/NobuData/ouroboros/issues/28))                                                              |
| Requests        | `class-validator` DTOs behind a global pipe — transform, whitelist, refuse the undeclared ([#31](https://github.com/NobuData/ouroboros/issues/31))                         |
| Health          | `@nestjs/terminus` — `/health/live` and `/health/ready`, with bounded database and engine probes ([#29](https://github.com/NobuData/ouroboros/issues/29))                  |
| Auth            | GitHub OAuth over bare `fetch` — no passport; a signed `HttpOnly` session cookie and a global guard ([#33](https://github.com/NobuData/ouroboros/issues/33))               |
| Auth (incoming) | `better-auth`, configured over the same `pg` pool and not yet mounted — see [BetterAuth](#betterauth) ([#700](https://github.com/NobuData/ouroboros/issues/700))            |
| Tenancy         | A request-scoped tenant context over `AsyncLocalStorage`, a global guard and `@Roles(…)` ([#32](https://github.com/NobuData/ouroboros/issues/32))                          |
| Engine gateway  | A typed client over bare `fetch` — shared secret, five-second deadline, one retry, zod-parsed answers, every failure a `502` ([#35](https://github.com/NobuData/ouroboros/issues/35)) |
| API spec        | **Spec-first**: [`openapi.yaml`](openapi.yaml) is authoritative and is served verbatim; [`openapi.json`](openapi.json) is rendered from it; Swagger UI at `/api/docs`      |
| Tests           | Jest (unit), plus a Supertest suite over a PostgreSQL the run starts for itself — Testcontainers, migrated by Flyway ([#37](https://github.com/NobuData/ouroboros/issues/37))  |
| Lint            | ESLint flat config + Prettier                                                                                                                                              |
| Container       | Multi-stage Dockerfile on `node:24-alpine`, production-only dependency tree, non-root, `HEALTHCHECK` on `/health/live` — see [Container](#container)                        |

## Run

```bash
yarn install           # immutable install from the committed lockfile
yarn dev               # http://localhost:4000/api/v1
yarn openapi           # re-render openapi.json from openapi.yaml
yarn lint
yarn typecheck
yarn test
yarn test:integration  # starts a PostgreSQL of its own — needs Docker
yarn build && yarn start
```

`lint`, `typecheck`, `test` and `build` are what `ci/rest` runs on every pull request
touching this directory — see [conventions](../docs/CONVENTIONS.md#9-ci).

`yarn dev` is `nest start --watch`; `yarn start` runs the compiled `dist/main.js`, which
is also what [the container](#container) runs.

```console
$ curl http://localhost:4000/api/v1
{"service":"ouroboros-rest","version":"0.7.0","status":"ok","uptimeSeconds":3.885}
```

| Path                                                | Purpose                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| `GET /api/v1`                                       | The heartbeat — service, build, uptime                                |
| `GET /health/live`                                  | [Liveness](#health-and-readiness) — the process, and nothing else     |
| `GET /health/ready`                                 | [Readiness](#health-and-readiness) — the process and its dependencies |
| `POST /api/auth/sign-in/social`                     | [Sign in](#signing-in) — BetterAuth's, outside the versioned API      |
| `GET /api/auth/callback/github`                     | Where GitHub returns; BetterAuth's, and what an OAuth App registers   |
| `GET /api/v1/auth/me`                               | Who is signed in, their memberships, and a tenant suggestion          |
| `POST /api/v1/auth/logout`                          | Sign out — removes the session cookie                                 |
| `GET POST /api/v1/tenants`                          | [Tenants](#the-tenancy-api) — list yours, create one                  |
| `GET PATCH /api/v1/tenants/{id}`                    | Read one; rename, re-slug or change its status                        |
| `GET POST /api/v1/tenants/{id}/domains`             | The email domains that resolve it at sign-in                          |
| `PATCH DELETE …/domains/{domainId}`                 | Set or clear the primary; give a domain up                            |
| `GET POST /api/v1/tenants/{id}/members`             | Who belongs to it; invite somebody                                    |
| `PATCH DELETE …/members/{userId}`                   | Change a role; remove a member                                        |
| `GET POST /api/v1/tenants/{id}/orgs`                | The GitHub organisations it has recorded                              |
| `PATCH …/orgs/{login}`                              | Enable or disable one                                                 |
| `GET …/orgs/{login}/repos`                          | The repositories under it                                             |
| `PATCH …/orgs/{login}/repos/{name}`                 | Enable or disable one, recording it if it is new                      |
| `/api/docs`                                         | Swagger UI over the committed specification                           |
| `/api/openapi.json`                                 | The specification the process serves, for a client generator          |
| `/api/openapi.yaml`                                 | The authoritative file itself, comments and all                       |

Formatting is not a separate check: Prettier runs as a lint rule, so `yarn lint` fails on
a badly formatted file and `yarn format` is the fixer. `yarn test:watch` re-runs the unit
suite on save. `yarn test:integration` is the one command that needs a database, and it
starts one; see [Running the integration suite](#running-the-integration-suite).

This directory is a **Yarn workspace**
([#13](https://github.com/NobuData/ouroboros/issues/13)): its `package.json` carries no
`packageManager` and no lockfile of its own — the repo-root `package.json`, `yarn.lock`
and `.yarnrc.yml` are what the commands above resolve through, and the workspace list at
the root already names this directory. `ouroboros-ui` is the sibling implementation.

A running database is required for anything past the heartbeat, and `/health/ready` is how
the service says whether it has one. `yarn dev` from the repo root brings one up, migrated,
before it starts this service — and starts `ouroboros-engine` beside it, which is the other
thing this module needs ([conventions § 1](../docs/CONVENTIONS.md#1-repository-shape)).
`docker compose up db` ([#10](https://github.com/NobuData/ouroboros/issues/10)) is the data
tier on its own.

## The API specification

**[`openapi.yaml`](openapi.yaml) is the specification, and the service serves it.** This
module is spec-first: `@nestjs/swagger` does not derive a document from whatever
decorators a controller happens to carry — the application loads the committed file and
hands it back unchanged. What `ouroboros-ui` generates its client from, what `/api/docs`
renders and what the process answers with are the same bytes, so the document can carry
things no decorator has a field for (prose written for a reader, an example, a `const`
constraint) and cannot be rewritten by a property nobody meant as a contract.

Two files, one document, both committed at this directory's root — the paths to hand a
catalogue, a linter or a diff tool:

| File                           | What it is                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| [`openapi.yaml`](openapi.yaml) | **Authoritative.** The one to edit — comments, block text, no escaping                          |
| [`openapi.json`](openapi.json) | Rendered from it by `yarn openapi`. What the process loads, and what `openapi-typescript` wants |

```bash
yarn openapi           # re-render openapi.json from the YAML
yarn openapi --check   # report drift without writing; exits non-zero
```

The JSON is committed rather than built on demand because the service reads it at boot:
both files sit beside `package.json`, resolved from the module directory the same way
[`src/version.ts`](src/version.ts) resolves the manifest, so the container
([#36](https://github.com/NobuData/ouroboros/issues/36)) has to copy them next to `dist/`
and an image built without them fails while the application is being constructed rather
than on the first request for the contract. Reading the JSON at runtime is also why the
served application needs no YAML parser — `yaml` is a devDependency, used by the renderer
and the tests and by nothing that handles a request.

Being spec-first costs the one thing a generated document gave away free: the guarantee
that it describes the routes that actually exist. `yarn test` is that guarantee, and
`ci/rest` runs it on every pull request. It fails when

- the two files have drifted apart, or `openapi.json` was hand-edited;
- `info.version` is not the version `package.json` declares, or `info.title` is not the
  service's name;
- the application serves a path or method the document does not describe — **or the
  document promises one the application does not serve**;
- the service answers with a status the document does not describe for that operation, or
  with a body that does not validate against the schema documented **for that status** —
  which includes a field the code returns and the document does not list (every schema is
  `additionalProperties: false`);
- a documented example is not a body the service could actually send;
- a documented path escapes `/api/v1` — other than the two health probes, which are
  enumerated in [`health.paths.ts`](src/modules/health/health.paths.ts) and have to _stay_
  described, so the exemption cannot quietly become a hole;
- the published development origin stops matching the port
  [`src/modules/config/configuration.ts`](src/modules/config/configuration.ts) defaults to;
- the document is not valid OpenAPI 3.1.

So adding a route is two edits — the controller and `openapi.yaml` — and forgetting the
second one is a red pipeline rather than a specification that quietly lies.

The specification is served in **every** environment, deliberately. It describes only what
the service already answers, holds no secret, and is committed in a public repository —
while hiding it in production would mean production served a different surface than
development, which is the drift being spec-first exists to prevent.

## Configuration

Development default port: **4000** (`PORT`). Every variable below is validated by a zod
schema at boot; a missing or malformed one exits `2` naming the exact variable, and the
service never starts half-configured.

| Variable                    | Purpose                                                  |      Required      | Rule                                                                        |
| --------------------------- | -------------------------------------------------------- | :----------------: | --------------------------------------------------------------------------- |
| `PORT`                      | HTTP listen port                                         |     no — 4000      | a whole number, 1–65535                                                     |
| `NODE_ENV`                  | which environment this is                                | no — `development` | `development`, `test` or `production`                                       |
| `OURO_DATABASE_URL`         | PostgreSQL connection string for `ouroboros-db`          |        yes         | a `postgresql://` (or `postgres://`) URL with a host                        |
| `OURO_REST_URL`             | This service's own browser origin — the OAuth callback   |        yes         | an origin — scheme, host, optional port; no path, no wildcard               |
| `OURO_UI_URL`               | Where a browser lands after signing in or out            |        yes         | an origin, as above                                                         |
| `OURO_ENGINE_URL`           | Base URL of `ouroboros-engine`                           |        yes         | an absolute `http://` or `https://` URL                                     |
| `OURO_ENGINE_SHARED_SECRET` | Shared secret for the internal engine call               |        yes         | at least 16 characters                                                      |
| `BETTER_AUTH_SECRET`        | What BetterAuth signs sessions and encrypts tokens with  |        yes         | at least 16 characters                                                      |
| `BETTER_AUTH_URL`           | The origin BetterAuth builds its own URLs from           |        yes         | an origin, as above — BetterAuth appends its own `/api/auth`                |
| `OURO_GITHUB_CLIENT_ID`     | GitHub OAuth application, client id                      |        yes         | non-empty                                                                   |
| `OURO_GITHUB_CLIENT_SECRET` | GitHub OAuth application, client secret                  |        yes         | non-empty                                                                   |
| `OURO_AUTH_DEV_USER`        | [#33's sign-in bypass](#the-development-bypass) — read by nothing since #703 |         no         | an email address; dropped in production                                     |
| `OURO_CORS_ORIGINS`         | Browser origins allowed to call the API with credentials |        yes         | comma-separated origins — scheme, host, optional port; no path, no wildcard |

Every one of them is documented with a development default in the repo-root
[`.env.example`](../.env.example), and `scripts/verify-dev-env.sh` fails the build if this
table and that template fall out of step. Those same variables — and only those, plus the
`OURO_TEST_DATABASE_DISPOSABLE` this module's
[integration harness](#running-the-integration-suite) reads — appear again in [`.env.example`](.env.example) here, for copying. The repo-root
template stays the complete list and this one is a subset of it; the values in the two are
identical. `PORT` and `NODE_ENV` are the documented
unprefixed exceptions — container platforms set them, not Ouroboros — and
`BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` are the third and fourth: the library reads those
names for itself, and so does the CLI that generates its schema
([conventions § 4](../docs/CONVENTIONS.md#4-configuration--environment-variables), and
[#700](https://github.com/NobuData/ouroboros/issues/700)).
`NODE_ENV` also decides which interface is bound: every interface in production, where the
platform routes to the container; loopback everywhere else, so a development machine does
not answer to the network it is on.

`BETTER_AUTH_URL` is this service's public origin, which is what `OURO_REST_URL` is too —
two vocabularies for one address. Nothing derives either from the other, deliberately, so
keep them in step; the boot log below prints both, side by side, which is where a
disagreement is visible before an OAuth callback goes to the wrong place.

**This service does not start on defaults alone.** Eleven variables have no default,
because a communications layer without a database, an engine, a signing key or a GitHub
application could serve nothing — so it names what is missing and exits rather than
starting into a wall of 500s. Configuration comes from the process environment layered
over the repo-root `.env` and this module's own, later winning — the same two files in
the same order as `ouroboros-engine`, so one `.env` configures both
([`src/modules/config/dotenv.ts`](src/modules/config/dotenv.ts)). The process environment
wins over either file, so what a container is started with is exactly what it runs with.
Copy the template and it runs with nothing exported:

```console
$ cp .env.example .env && yarn dev             # or ../.env.example to configure the stack
$ node dist/main.js                            # with no .env and nothing exported
ERROR [ouroboros-rest] ouroboros-rest: invalid configuration (11 problems)
  OURO_DATABASE_URL: is required
  OURO_ENGINE_URL: is required
  BETTER_AUTH_SECRET: is required
  …
$ echo $?
2
```

Three things about how this is implemented are worth knowing before adding a variable —
all of it lives in [`src/modules/config/`](src/modules/config):

- **The schema is keyed by variable name.** The whole value of a boot-time failure is the
  line it prints, so the zod schema's keys are `OURO_DATABASE_URL`, not `databaseUrl`, and
  the camel-case `Configuration` the application consumes is derived from it afterwards.
- **Nothing reads `process.env`.** Consumers inject `AppConfigService` and ask for
  `config.databaseUrl` — a `string`, not a `string | undefined`. `src/main.ts` is the one
  file that touches the environment, and [`eslint.config.mjs`](eslint.config.mjs) makes
  that a lint error everywhere else rather than a review habit.
- **Secrets are redacted, by construction.** The service logs its configuration at boot,
  and [`src/modules/config/redaction.ts`](src/modules/config/redaction.ts) is the only
  renderer there is: the four secrets become `[redacted]`, and the connection string
  keeps its host and database while its password is masked in place. `OURO_AUTH_DEV_USER`
  is deliberately *not* redacted — printing it is how an operator confirms the development
  bypass is off, and a redacted line would look the same either way. Real `.env` files are
  never committed.

```console
$ yarn start
LOG [ouroboros-rest] ouroboros-rest: configuration
  PORT=4000
  NODE_ENV=development
  OURO_DATABASE_URL=postgresql://ouroboros:***@localhost:5432/ouroboros
  OURO_REST_URL=http://localhost:4000
  OURO_UI_URL=http://localhost:3000
  OURO_ENGINE_URL=http://localhost:8000
  OURO_ENGINE_SHARED_SECRET=[redacted]
  BETTER_AUTH_SECRET=[redacted]
  BETTER_AUTH_URL=http://localhost:4000
  OURO_GITHUB_CLIENT_ID=dev-github-client-id
  OURO_GITHUB_CLIENT_SECRET=[redacted]
  OURO_AUTH_DEV_USER=ken@acme-robotics.dev
  OURO_CORS_ORIGINS=http://localhost:3000
LOG [ouroboros-rest] ouroboros-rest 0.14.0 listening on http://127.0.0.1:4000/api/v1
```

Adding a variable is four edits: the schema and the `Configuration` field beside it, a
getter on `AppConfigService`, the row in this table, and the documented default in
`.env.example`. The compiler enforces the mapping between the first two, and
`verify-dev-env.sh` enforces the last two.

## Health and readiness

Two probes, because a platform asks two questions with two different consequences. Both
answer at the **origin root**, outside `/api/v1`:

| Path                | Question                       | Answers                                               |
| ------------------- | ------------------------------ | ----------------------------------------------------- |
| `GET /health/live`  | Is this process still working? | `200` — always, if it answers at all                  |
| `GET /health/ready` | Can it serve a request?        | `200`, or `503` naming the dependency that is missing |

```console
$ curl -s localhost:4000/health/live
{"status":"ok","info":{},"error":{},"details":{}}

$ curl -s localhost:4000/health/ready              # everything up
{"status":"ok","info":{"database":{"status":"up"},"engine":{"status":"up"}},
 "error":{},"details":{"database":{"status":"up"},"engine":{"status":"up"}}}

$ docker compose stop db && curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/health/ready
503
$ curl -s localhost:4000/health/ready               # the engine is still fine, and it says so
{"status":"error","info":{"engine":{"status":"up"}},
 "error":{"database":{"status":"down","message":"SELECT 1 failed (ECONNREFUSED)"}},
 "details":{"engine":{"status":"up"},
            "database":{"status":"down","message":"SELECT 1 failed (ECONNREFUSED)"}}}
$ curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/health/live
200
```

Five things about them are deliberate, and all five live in
[`src/modules/health/`](src/modules/health):

- **Liveness depends on nothing.** Its reader restarts the container when the answer stops
  being `200`, so a liveness probe that failed because PostgreSQL was down would restart
  every replica of a healthy service, repeatedly, while the database was the thing that
  needed attention. Readiness is the one allowed to fail for a dependency: its reader takes
  the process out of rotation, and putting it back costs nothing.
- **They are outside `/api/v1`, and outside `/api`.** A probe is read by infrastructure with
  no notion of an API version — a `HEALTHCHECK` line ([#36](https://github.com/NobuData/ouroboros/issues/36)),
  a compose healthcheck ([#55](https://github.com/NobuData/ouroboros/issues/55)), an
  orchestrator — and each of those is configured once and must keep working when a version
  is added or retired. `src/application.ts` excludes exactly the two paths
  [`health.paths.ts`](src/modules/health/health.paths.ts) names, and the specification suite
  allows exactly those two outside the versioned surface.
- **The two dependencies are reported independently.** They are asked concurrently, and a
  body that says the database is down still says whether the engine is up — the failing one
  is named under `error`, all of them under `details`.
- **Every wait is bounded at two seconds.** The pool bounds connecting, reading rows and the
  server's own statement timeout; the engine request is _aborted_ by
  `AbortSignal.timeout()` rather than merely abandoned; and the probe races its own deadline
  on top of both. Compose healthchecks here poll on a 2–3 second timeout, so a probe that
  waited longer would be killed by its reader and report nothing.
- **A `down` message names what was attempted, never what it was attempted against.** This
  route answers without authentication, and a driver's own error text carries the host, the
  port and the role — so the body gets `SELECT 1 failed (ECONNREFUSED)` or
  `GET /healthz responded 503`, and the driver's diagnosis goes to the service log, where
  only an operator reads it.

The engine probe asks `GET /healthz`, the one route `ouroboros-engine` serves without
`X-Ouro-Internal-Key` ([#51](https://github.com/NobuData/ouroboros/issues/51)) — so it
carries no secret at all. The database probe keeps a one-connection `pg` pool of its own,
deliberately separate from the request pool below: a probe sharing that pool would be the
first thing to fail when it was merely _busy_, which reports a load problem as a dependency
outage — and readiness is the signal an orchestrator reads to decide whether to keep
sending traffic. Two pools, two questions.

## Data access

**Kysely over `pg`, and no ORM** — decision **D3** in
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md). `ouroboros-db`'s Flyway migrations own
every table, index, constraint and trigger; this module writes no DDL, and
[`src/modules/db/schema.ts`](src/modules/db/schema.ts) _mirrors_ V001–V003 so a query can be
type-checked.

```ts
@Injectable()
export class TenantsRepository {
  constructor(private readonly database: DatabaseService) {}

  async findBySlug(slug: string): Promise<Tenant | undefined> {
    return this.database.db
      .selectFrom("tenants") // → from "ouroboros"."tenants"
      .selectAll()
      .where("slug", "=", slug) // → where "slug" = $1
      .executeTakeFirst();
  }
}
```

Six things about it are deliberate, and all six live in
[`src/modules/db/`](src/modules/db):

- **`DbModule` provides one thing: the connection.** Repositories live with their feature
  module — tenancy's with `TenancyModule` ([#31](https://github.com/NobuData/ouroboros/issues/31)),
  auth's with `AuthModule` ([#33](https://github.com/NobuData/ouroboros/issues/33)) — and
  each of those imports `DbModule` and injects `DatabaseService`. A `db/` that also held the
  queries would become the place every feature's SQL accumulated.
- **It is not global, where configuration is.** Every module needs configuration; only some
  touch the database, so an `imports` list is the answer to "who can reach the tenancy
  schema".
- **The types mirror the migrations, and something checks that they still do.**
  `TABLE_COLUMNS` restates the same column names as values: `schema.spec.ts` fails to
  compile if that list and the interfaces drift apart, and the integration suite fails if
  the list and a **migrated database** drift apart. Column names are the database's —
  `display_name`, not `displayName` — because a name that differs between the migration and
  the type is a mapping nobody can grep for.
- **Every statement is schema-qualified.** Kysely's `WithSchemaPlugin` rewrites the query
  tree, so the service does not depend on a `search_path` it did not set; the connection
  sets one anyway, for the raw `sql` fragments the plugin cannot see.
- **Nothing about a query is unbounded.** Ten connections at most, and a deadline on getting
  one, on waiting for rows, and on the server running the statement — see
  [`pool.ts`](src/modules/db/pool.ts) for what each is chosen against.
- **The log never carries a parameter.** Kysely parameterises everything, and the parameter
  list is the part holding an email address, a display name, a tenant's identifiers. A slow
  query in development is logged with its SQL and its duration; a failed query is logged in
  every environment; neither is ever logged with its values.

Transactions are one call, and the `trx` it hands out has the same typed surface — so a
repository method takes either and does not need to know which it was given:

```ts
await this.database.transaction(async (trx) => {
  const tenant = await tenants.create(slug, name, trx);
  await domains.add(tenant.id, domain, trx);
}); // commits, or rolls back everything if the callback throws
```

The pool drains on shutdown: `src/application.ts` enables Nest's shutdown hooks, so
`SIGTERM` runs `DatabaseService.onApplicationShutdown` and the process does not exit until
the connections are back. In `pg_stat_activity` they are named `ouroboros-rest`, which is
what tells them apart from the readiness probe's `ouroboros-rest health probe`.

### Running the integration suite

`yarn test` starts nothing and needs nothing. The checks that are only true of a _migrated_
database live in `*.integration-spec.ts` and run separately —
[#37](https://github.com/NobuData/ouroboros/issues/37):

```bash
yarn test:integration     # Docker is the only prerequisite
```

The run starts `postgres:17-alpine` through Testcontainers, applies `ouroboros-db`'s Flyway
project to it with the pinned `flyway/flyway:11-alpine`, boots the application on a random
port, and throws the container away when it ends. `ci/rest` runs the same command with no
setup around it, so what a pull request proves is what you just ran.

There is no default and no skip: a suite that passed when it was given no database would be
reporting "the schema matches" having compared nothing.

**Pointing it at a database of your own.** Export `OURO_DATABASE_URL` and nothing is
started — useful when you want to inspect what a failing suite left behind, or when the
compose stack is already up:

```bash
docker compose up -d      # from the repo root — PostgreSQL, migrated by Flyway
cd ouroboros-rest
OURO_DATABASE_URL=postgresql://ouroboros:ouroboros@localhost:5432/ouroboros \
  yarn test:integration
```

The suites that clean up after themselves write only rows named `ouro-it-*` and remove them
afterwards, so this is safe. The ones built on the harness **empty every table between
tests**, which would take the dev seed with it, so they refuse a database the run did not
start and say so. Add `OURO_TEST_DATABASE_DISPOSABLE=true` when the database you supplied
is genuinely throwaway.

What runs:

| Suite                          | What only a real database can answer                                          |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `db.integration-spec.ts`       | the `Database` interface names the columns Flyway created; the pool drains     |
| `tenancy.integration-spec.ts`  | CRUD end to end, constraint → envelope mapping, the last-owner rule            |
| `auth.integration-spec.ts`     | the OAuth flow lands a session; a repeat sign-in reuses the same user row      |
| `roles.integration-spec.ts`    | the role matrix — 15 routes × 6 callers, through the guards that are really on |
| `harness.integration-spec.ts`  | the harness itself: the image, the migrations, the port, the truncation        |

`roles.integration-spec.ts` is the one that answers #37's second criterion. `RolesGuard`'s
unit spec proves the guard refuses a role that is not in its list — with metadata the test
wrote. It cannot prove the metadata is *there*: delete `@Roles(...ADMINISTRATORS)` from a
controller and every unit spec still passes, because none of them go through the router that
reads it. The matrix does, for every route, as every role.

## The tenancy API

**The first real API of the system** ([#31](https://github.com/NobuData/ouroboros/issues/31)),
and the backbone the UI's login and settings screens consume: tenants, the email domains
that resolve them at sign-in, their members, and the GitHub organisations and repositories
they have enabled. Every route is in [`openapi.yaml`](openapi.yaml) with its request and
response schemas; the table under [Run](#run) is the summary.

```console
$ curl -sX POST localhost:4000/api/v1/tenants \
    -H 'content-type: application/json' -d '{"slug":"acme","displayName":"Acme, Inc."}'
{"id":"9f1c0a5e-…","slug":"acme","displayName":"Acme, Inc.","status":"active",…}

$ curl -sX POST localhost:4000/api/v1/tenants/9f1c0a5e-…/domains \
    -H 'content-type: application/json' -d '{"domain":"acme.example","isPrimary":true}'
{"id":"4d2a8b31-…","tenantId":"9f1c0a5e-…","domain":"acme.example","isPrimary":true,…}
```

Six things about it are decisions rather than defaults, and all six live in
[`src/modules/tenancy/`](src/modules/tenancy):

- **Three layers, one job each.** A controller names a route and the shapes a request may
  take; a service holds the rules and owns the transactions; a repository issues statements
  and holds no rules at all. That is why the specs read the way they do — the repository
  specs assert *SQL* (`database.fixture.ts` compiles it without a server), because a
  repository's only possible mistake is the query, and a missing `where tenant_id = $1` is
  what tenancy isolation rests on.
- **Every error is `{code, message, details}`** — `../docs/ARCHITECTURE.md` § 5.3, and true
  of the failures no handler produced as well, because a filter registered in
  `src/application.ts` is what makes it so. A constraint the database refused is mapped into
  it rather than leaking through: a duplicate domain is `409 domain_taken`, never a
  PostgreSQL error string. The mapping is a table keyed by the migrations' own constraint
  names ([`constraints.ts`](src/modules/tenancy/constraints.ts)), applied by an interceptor,
  so a constraint a future migration adds answers with a code the day it lands.
- **Validation is a `422`, with one `details` entry per field.** DTOs are `class-validator`
  classes that restate the `check` constraints V001–V003 declare, so a bad value is refused
  before a connection is taken from the pool and the message names the field. Path
  parameters go through the same pipe as bodies — a malformed uuid is the same envelope as
  a malformed body, not a second failure mode for a client to handle.
- **A property no DTO declares is refused**, not ignored. That closes mass assignment for
  every route at once instead of per service.
- **Lists are `?limit=&offset=` answering `{items, total, limit, offset}`** — the convention
  in [`pagination.ts`](src/modules/tenancy/pagination.ts), with the window echoed back so a
  client that sent neither can still compute the next page, and a ceiling on `limit` so one
  request cannot ask this service to serialise a table.
- **One rule is enforced here because the database cannot enforce it.** A tenant always
  keeps at least one `owner`: it spans rows and has to survive both a role change and a
  removal, so V002 left it to "the tenancy API that will be the only thing allowed to write
  here". It is enforced with `select … for update` over the owner rows rather than with a
  count, because two requests demoting two different owners would both pass a count and
  leave a tenant nobody administers.

The API's names are the API's — `displayName`, `isPrimary`, `createdAt` — and the rows'
names stay the database's. [`resources.ts`](src/modules/tenancy/resources.ts) is the one
place the two meet, which is also what stops a column added by a migration becoming part of
the contract by accident.

**These routes need a session** ([#33](https://github.com/NobuData/ouroboros/issues/33))
**and a workspace** ([#32](https://github.com/NobuData/ouroboros/issues/32)) — a workspace
you are not a member of answers `404`, and the ten mutations above need `owner` or `admin`.
See [The tenant context](#the-tenant-context).

## BetterAuth

**The library is installed, configured and mounted; no provider is wired to it yet**
([#700](https://github.com/NobuData/ouroboros/issues/700),
[#701](https://github.com/NobuData/ouroboros/issues/701)). `/api/auth/*` answers —
`GET /api/auth/ok` returns `{"ok": true}` against a running service — but what signs a
person in today is still the hand-rolled flow described under
[Signing in](#signing-in). [#702](https://github.com/NobuData/ouroboros/issues/702) moves
GitHub onto BetterAuth and [#703](https://github.com/NobuData/ouroboros/issues/703)
replaces the cookie session; this section is the foundation both stand on.

[`src/auth/`](src/auth) is five files, and the split is about *who can load what*:

| File               | What it is                                                                    |
| ------------------ | ----------------------------------------------------------------------------- |
| `auth.options.ts`  | the options object — every decision, and no dependency: it imports the library's *types* only |
| `auth.factory.ts`  | `createAuth(dependencies)` — the one place `better-auth` is a value rather than a type |
| `auth.config.ts`   | a standalone instance built from the environment, for `@better-auth/cli`       |
| `auth.module.ts`   | the Nest wiring — the one file here that imports `@nestjs/*`                    |
| `auth.routes.ts`   | the [route map](#the-route-map), and the paths the global prefix excludes       |

Two constraints shape the first three. The library is **ES-module-only** and this service
compiles to CommonJS, because Nest's dependency injection needs the decorator metadata that
setting emits; Node 24 bridges the two with `require(esm)`, and Jest's CommonJS runtime
does not — so the module that names `better-auth` as a value is kept to a single function,
and the suites substitute it (see [Testing the mount](#testing-the-mount)). And the
configuration has to be loadable **with no Nest process at all**, because that is how
[#706](https://github.com/NobuData/ouroboros/issues/706) generates the schema — which is
why `auth.module.ts` is a separate file rather than a section of `auth.config.ts`: the CLI
must never reach an injector.

**One pool, not two.** `authOptions` takes a `pg.Pool` and puts *that object* into
BetterAuth's `database` — decision **A2** of
[the roadmap](../docs/ROADMAP_MOCKUP_01_BETTERAUTH.md). In the running service that is
`DatabaseService.pool`, so the auth tables and the tenancy tables share ten connections,
one drain on `SIGTERM`, and one row in `pg_stat_activity`. It also carries the
`search_path` this service connects with, which is what puts BetterAuth's tables in the
Flyway-owned `ouroboros` schema without the library being taught the name.

### The route map

BetterAuth serves these itself, through `@thallesp/nestjs-better-auth`
(roadmap decision **A1**). They are **not** Nest controllers — the library registers one
handler on the HTTP adapter ahead of Nest's router — which is why they sit at `/api/auth`
beside the versioned API rather than under `/api/v1`: the library versions its own routes,
and a second version number in the path would be a promise this service is not the one
keeping.

| Route                             | What it is for                                                       |
| --------------------------------- | -------------------------------------------------------------------- |
| `POST /api/auth/sign-in/social`   | begin a social sign-in; answers with the provider's authorization URL |
| `GET\|POST /api/auth/callback/:id`| where the provider redirects back — GitHub's is `/api/auth/callback/github` |
| `GET\|POST /api/auth/get-session` | the caller's session, or `null`                                       |
| `POST /api/auth/sign-out`         | end the session and clear its cookie                                  |
| `GET /api/auth/ok`                | the library answering for itself — no database, no session            |
| `GET /api/auth/error`             | where a failed flow is redirected, with the reason in the query string |

The same table is [`src/auth/auth.routes.ts`](src/auth/auth.routes.ts), as data, because
[#711](https://github.com/NobuData/ouroboros/issues/711) publishes these paths and
`ouroboros-ui`'s BetterAuth client calls them.

Only `ok` and `error` do anything useful today: no provider is configured, so
`sign-in/social` answers `PROVIDER_NOT_FOUND` and `get-session` answers `null`. **A route
that answers is nevertheless the acceptance criterion of #701** — the handler is mounted,
it escapes the global prefix, and it reads the raw request. #702, #703 and #705 are what
fill it in, and each adds its own rows to that file.

`GET /api/auth/ok` is not a health probe. It says nothing about this service's
dependencies; [`/health/ready`](#health-and-readiness) stays the only readiness there is.

### Nest parses no request body

BetterAuth reads the **raw** request stream — it signs what it reads — so the application
is created with Nest's body parser switched off (`applicationOptions` in
[`src/application.ts`](src/application.ts)). Every other route still parses JSON, and by a
different route than before: the library's module re-adds `express.json()` and
`express.urlencoded()` as middleware for every path that is *not* under `/api/auth`.

That indirection is the whole risk of this change — it is invisible until it stops working,
and when it stops working every endpoint in the service quietly receives `undefined` where
its DTO should be. So it is asserted rather than assumed, over every operation in
`openapi.yaml` that carries a request body, in `application.spec.ts`.

One consequence worth knowing before reaching for it: `NestApplicationOptions.rawBody` no
longer does anything, because it is implemented *by* the parser that is now off. A route
that needs the unparsed bytes asks the library's module for them instead, through its
`bodyParser.rawBody` option.

Two of the library's defaults are turned off in
[`src/auth/auth.module.ts`](src/auth/auth.module.ts), and both are recorded there:
its **global guard**, because this service already has one and #703 is what swaps them; and
its **CORS policy**, because `permitBrowserOrigins` already answers that question over the
same origin list.

### Testing the mount

The suites load `@thallesp/nestjs-better-auth` **for real** — `jest.esm-transform.cjs`
converts that one package to CommonJS on the way in — and replace `better-auth` itself with
`src/auth/better-auth.fixture.ts`. The seam is deliberate and it is where #701 ends: what
the integration contributes is middleware ordering, so a stand-in for it would be a second
implementation of the very thing under test, while what BetterAuth's routes *do* is #702's
and #703's to prove. That the real library accepts these options is established outside
Jest, by `@better-auth/cli generate` building an instance from `auth.config.ts` — see below.

### Generating the auth schema

Flyway owns every table (`docs/ARCHITECTURE.md` decision **D3**), so BetterAuth's CLI is
used for `generate` and never for `migrate`: it prints SQL, and a person ports it into a
versioned migration. That is what `auth.config.ts` exists for — it needs a database to
introspect, and no application:

```console
$ npx @better-auth/cli@1.4.21 generate --config src/auth/auth.config.ts --output V004.sql
🚀 Schema was generated successfully!

$ head -1 V004.sql
create table "user" ("id" text not null primary key, "name" text not null, …);
```

Four tables come out — `user`, `session`, `account`, `verification` — with the library's
own camelCase column names, quoted, which is roadmap decision **A4**: they are vendor-shaped
tables, and renaming their columns fights every plugin update. The house snake_case style
still applies to *our* tables.

The command reads this module's `.env` and the repo root's, exactly as `yarn dev` does, so
it needs nothing exported; point `OURO_DATABASE_URL` at whichever database should be
introspected. The CLI is deliberately **not** a dependency of this module — it is run once
per schema change, it pulls in three database drivers this service does not use, and its
version tracks the library's loosely.

## Signing in

**BetterAuth's GitHub provider**
([#702](https://github.com/NobuData/ouroboros/issues/702)). The library owns the whole
handshake and serves its own routes under `/api/auth`, outside the versioned API — see
[BetterAuth](#betterauth) for why they are mounted there and
`src/auth/auth.routes.ts` for the full map:

| Route                                | What it does                                                        |
| ------------------------------------ | ------------------------------------------------------------------- |
| `POST /api/auth/sign-in/social`      | `{ "provider": "github" }` in, the github.com authorization URL out  |
| `GET  /api/auth/callback/github`     | Where GitHub returns the browser; upserts `"user"` + `account`       |
| `GET  /api/v1/auth/me`               | The person, their memberships, and a tenant suggestion               |
| `POST /api/auth/sign-out`            | Deletes the session row; clears its cookies                          |
| `POST /api/v1/auth/logout`           | The same thing, versioned — delegates to `sign-out`. `204`           |

```mermaid
sequenceDiagram
    participant B as Browser (/login)
    participant R as ouroboros-rest
    participant G as github.com
    B->>R: POST /api/auth/sign-in/social {provider: github}
    R->>B: 200 · { url } — github.com/login/oauth/authorize (state)
    B->>G: authorize (read:user, user:email)
    G->>B: 302 /api/auth/callback/github?code&state
    B->>R: callback(code, state)
    R->>R: state matches the one it issued?
    R->>G: exchange code → profile + verified primary email
    R->>R: upsert "user" + account · create session row
    R->>B: Set-Cookie (session) · 302 back to the app
```

Four decisions are this service's rather than the library's, and all four live in
[`src/auth/github.provider.ts`](src/auth/github.provider.ts) with the argument for each:

- **The scopes are `read:user` and `user:email`, and the library's defaults are turned
  off.** `user:email` is the one that matters: GitHub's default is a *private* primary
  address, and without the scope somebody whose colleague invited them by that exact
  address arrives as a stranger. Owning the list rather than inheriting it means a library
  upgrade that widened its defaults cannot widen this service's consent screen on a deploy.
  Nothing that grants repository access is asked for — that is `ouroboros-engine`'s GitHub
  App, with its own installation grant.
- **A profile becomes a person explicitly.** The name they have set, or their login when
  they have not; their avatar, or nothing. `"user"."name"` is `not null`, and the library's
  own default would write an empty string for an account with no name — a row that renders
  as broken rather than a person who never filled in a field.
- **Account linking is on, and is authorised by GitHub's verification rather than by
  GitHub's name.** No provider is trusted by name, so an arriving account attaches to an
  existing person only when the provider says the address is *verified* — which is the rule
  #33 enforced by hand. The *local* `emailVerified` is deliberately not required, because
  somebody invited to a workspace before they ever signed in has never had the chance to
  verify anything, and requiring it would make the invitation flow unusable.
- **Sessions are BetterAuth's, and they are rows.**
  [#703](https://github.com/NobuData/ouroboros/issues/703) retired #33's stateless cookie:
  a sign-in writes `ouroboros.session`, the browser carries a cookie naming it, signing out
  deletes it, and the library's own `AuthGuard` is what every route sits behind. See
  [Sessions](#sessions) below for the lifetimes and the cookies.

### What #33 shipped, and where it went

A complete hand-rolled GitHub sign-in existed before this — `oauth.ts` (state and PKCE over
a signed handshake cookie), `github.ts` (`GithubClient`), and `auth.service.ts`'s
`resolveUser`, a three-branch identity model writing `users` and `user_identities`. #702
**deleted all of it**, rather than leaving a second sign-in path behind a flag. Where each
piece went:

| #33                                     | Now                                                            |
| --------------------------------------- | -------------------------------------------------------------- |
| `oauth.ts` — state, PKCE, `ouro_oauth`  | Inside BetterAuth                                              |
| `github.ts` — `GithubClient`            | The library's GitHub provider                                  |
| `resolveUser` branch 1 — known identity | `findOAuthUser` on `account(providerId, accountId)`            |
| `resolveUser` branch 2 — invited stub   | The account-linking policy above                               |
| `resolveUser` branch 3 — new person     | `createOAuthUser`                                              |
| `users`, `user_identities`              | `"user"`, `account` — back-filled by V004, ids preserved       |
| `GET /api/v1/auth/github{,/callback}`   | **Removed**, not forwarded — `auth.controller.ts` says why     |

The back-fill is what makes a person who signed in under the old flow the same person under
the new one: V004 ([#706](https://github.com/NobuData/ouroboros/issues/706)) copied
`user_identities` into `account` preserving ids, so their next sign-in finds them by the
pair BetterAuth looks a sign-in up by. `auth.integration-spec.ts` asserts that against a
seeded pre-migration row.

**The login page's GitHub button does not work until
[#718](https://github.com/NobuData/ouroboros/issues/718)**, which re-points `ouroboros-ui`
at `signIn.social`. That gap is deliberate: the alternative was keeping the old flow alive
beside the new one.

### Signing in for real

Register a GitHub OAuth application — **Settings → Developer settings → OAuth Apps** — with
the callback URL below, put its client id and secret in `.env` as
`OURO_GITHUB_CLIENT_ID`/`OURO_GITHUB_CLIENT_SECRET`, and comment out `OURO_AUTH_DEV_USER`:

| Environment | Authorization callback URL                        |
| ----------- | ------------------------------------------------- |
| Development | `http://localhost:4000/api/auth/callback/github`   |
| Production  | `${BETTER_AUTH_URL}/api/auth/callback/github`      |

It is `BETTER_AUTH_URL` and not `OURO_REST_URL` that the library builds it from, and the
two are the same origin spelled in two vocabularies — keep them in step. Then:

```bash
curl -sS -X POST http://localhost:4000/api/auth/sign-in/social \
  -H 'content-type: application/json' \
  -d '{"provider":"github","callbackURL":"http://localhost:3000"}'
```

1. **Open the `url` it answers with** in a browser — GitHub's consent screen, asking for
   your profile and your email addresses and nothing else.
2. **Authorize**; the browser returns to `/api/auth/callback/github` and on to the
   `callbackURL`.
3. **Look at the database.** A `"user"` row with your name, address and avatar, and an
   `account` row with `providerId = 'github'`:

   ```bash
   psql -c 'select "name", "email", "emailVerified" from ouroboros."user";' \
        -c 'select "providerId", "accountId" from ouroboros.account;'
   ```

4. **Ask who you are.** `GET /api/v1/auth/me`, with the cookies the browser now holds,
   answers with the person, their memberships, and — for somebody brand new — the tenant
   their address's domain points at.

### Sessions

**A session is a row** ([#703](https://github.com/NobuData/ouroboros/issues/703)). A
sign-in writes `ouroboros.session` (V004) and the browser carries a cookie naming it;
`POST /api/v1/auth/logout` deletes the row, so **revocation is immediate** — a cookie
copied beforehand is refused on its next use rather than honoured for the rest of its week.
That is the property #33's stateless cookie wrote down that it could not offer, and it
closes the revocation half of [#38](https://github.com/NobuData/ouroboros/issues/38).

The values, and where each is argued —
[`src/auth/session.options.ts`](src/auth/session.options.ts):

| Property                    | Value                        | Why                                                                                              |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| Cookie                      | `better-auth.session_token`  | The library's default. `__Secure-`-prefixed over HTTPS, which a browser refuses over plain HTTP  |
| Lifetime (`expiresIn`)      | 7 days                       | A week of work without re-authenticating; still the bound on a stolen cookie                     |
| Refresh (`updateAge`)       | 1 day                        | Daily use slides the expiry, so a session never ends mid-task. Not per request, which is a write |
| Cookie cache (`maxAge`)     | 5 minutes                    | A signed snapshot in `better-auth.session_data`, so a request costs **no** query while it is fresh |

**Two cookies, therefore.** The token names the row; the cache holds a signed copy of the
session and the user so that an authenticated request does not pay for a lookup. Both are
`HttpOnly`, both are `SameSite=Lax`, and both are cleared by signing out.

**The rename invalidated every session live at the cut-over.** `ouro_session` →
`better-auth.session_token` was unavoidable: there is no way to migrate a stateless signed
cookie into a session row, and inventing one would mean trusting the signature the change
exists to stop trusting. A browser still sending the old cookie is answered `401` and told
to drop it — see `src/modules/auth/legacy.cookie.ts`, which is also where the date that
eviction can be deleted is written down.

**Every route needs one unless it says otherwise**, with `@AllowAnonymous()`. The exempt
surface is the heartbeat, the two probes and sign-out — the same four routes #33's
`@Public()` exempted, ported one for one — and it is not maintained by inspection:
`src/modules/auth/guard.surface.spec.ts` enumerates the guard's decision for every route in
the table and fails if one gains or loses an exemption.

### The development bypass

**There is not one any more.** `OURO_AUTH_DEV_USER` treated every request as coming from
the person with that address, so local work needed no GitHub OAuth application at all.
[#703](https://github.com/NobuData/ouroboros/issues/703) removed the guard that read it: a
bypass is a branch inside an authentication decision, and this service no longer makes one
— BetterAuth does.

So **signing in locally means a real GitHub OAuth application** until
[#705](https://github.com/NobuData/ouroboros/issues/705) lands the development
email/password sign-in, which is a credential the library supports natively rather than a
way around authentication. See [Signing in for real](#signing-in-for-real) above; it takes
about two minutes.

The variable is still in `.env.example` and still validated, because #705 removes it in the
same change that delivers its replacement. Nothing reads it, and it is still dropped
outright when `NODE_ENV=production`.

## The tenant context

**Every request past sign-in operates as a member of one workspace**
([#32](https://github.com/NobuData/ouroboros/issues/32)), and that is resolved once, in one
place, rather than re-implemented per controller.

```
request ─▶ middleware ─▶ AuthGuard ─▶ TenantContextGuard ─▶ RolesGuard ─▶ handler
           opens the      who is        which workspace,      may they
           context        asking        and are they in it    do this
                          (#703)
```

### Where the workspace comes from

Three sources, most specific first:

1. **The `{tenantId}` in the path**, on the routes that have one.
2. **The `X-Ouro-Tenant` header** — a slug or a uuid. This is how a workspace switcher names
   the active workspace on a route with no workspace in its path, which is every route the
   epic adds after this one.
3. **A sole membership.** Somebody who belongs to exactly one workspace is unambiguously
   operating in it. Somebody who belongs to several is asked to say which, with a `422` and
   `code: "tenant_required"`.

A path and a header that name **different** workspaces are a `422` with
`code: "tenant_mismatch"` rather than a silent preference for either — a client holding a
stale workspace in a header would otherwise quietly act on another one.

### What an outsider is told

**Nothing.** A workspace that does not exist and a workspace you are not a member of are the
same `404`, with the same code, the same message and the same `details`. A `403` would
confirm that an identifier names something real, which is the whole of what somebody
enumerating identifiers is trying to learn. `GET /api/v1/tenants` is scoped the same way: it
lists the workspaces *you* belong to, never the installation's.

The one `403` this API does answer is a member whose **role** is too low. By then the caller
has already proved the workspace is no secret from them, and their role is the only thing
left to tell them — `details.role` is what they hold and `details.required` is what would
have been enough.

| | `owner` | `admin` | `member` | `viewer` |
|---|:---:|:---:|:---:|:---:|
| Read a workspace, its domains, members, orgs and repos | ✓ | ✓ | ✓ | ✓ |
| Rename it, suspend it, invite, enable a repository | ✓ | ✓ | | |

A handler declares what it needs with `@Roles(...ADMINISTRATORS)`; one that declares nothing
is open to every member, which is not the same laxity as `@Public()` — the tenant guard has
already refused everybody else.

### Three routes need no workspace

`@TenantOptional()`, and all three are questions about the *person* rather than a workspace:
`GET /api/v1/tenants` (which are mine), `POST /api/v1/tenants` (let me have one), and
`GET /api/v1/auth/me` (who am I). Requiring a workspace first would be circular. Creating one
makes you its `owner` in the same transaction, because a workspace with no members is one the
`404` rule puts out of reach of the person who just made it.

### Reaching it from a service

```ts
import { currentTenant, currentMember } from "./tenant.context";
```

The context is request-scoped through `AsyncLocalStorage`, so it survives an `await` and is
readable at any call depth without being threaded through one — which is the issue's third
acceptance criterion, and what
[#25](https://github.com/NobuData/ouroboros/issues/25)'s `set_config('ouroboros.tenant_id', …)`
will need, since a row-level-security GUC has to be set on a connection nothing in the call
chain is holding.

Two halves make it work, and neither can do the other's job. **Only middleware can open the
store** — `AsyncLocalStorage.run` takes a callback, so something has to wrap the rest of the
request — and **only a guard can fill it in**, because middleware runs *before* guards and
there is no principal yet when it does.

It is deliberately used in exactly one service today (`TenantsService.list`, to scope the
listing to the caller). Ambient state is a dependency the compiler cannot see: repositories
and services take their `tenantId` as a parameter, as they always did, and the ambient form
is for the cases where threading a parameter is the problem rather than the solution.

## The engine gateway

The UI never talks to `ouroboros-engine`; it talks to this service, and this service talks
to the engine ([#35](https://github.com/NobuData/ouroboros/issues/35)). One route publishes
that today:

```console
$ curl -s -b ouro_session=… localhost:4000/api/v1/engine/status
{"engine":"up","version":"0.3.0"}

$ curl -s -b ouro_session=… localhost:4000/api/v1/engine/status   # with the engine stopped
{"code":"engine_unavailable","message":"The engine is not available right now. Try again in a moment.","details":{}}
```

**It is a pass-through, not a proxy.** A route that forwarded a path, a method and a body to
an internal service would be the "engine is internal" invariant
([`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) § 10) written as a hole. So each engine
capability arrives as a named operation with its own contract in `openapi.yaml`, and the
next one is another entry beside this one.

`EngineClient` is what those operations call, and it is the only place in the service that
knows the engine exists. It mirrors the engine's `/v0` contract in `engine.contract.ts` —
routes, request and response shapes — and four rules hold for every call it makes:

- **The secret travels on `X-Ouro-Internal-Key`**, from `OURO_ENGINE_SHARED_SECRET`. It is
  never logged, right or wrong.
- **Every call is bounded** at five seconds, aborted rather than raced, so a slow engine
  cannot hold a browser open indefinitely.
- **One retry, and only when nothing was delivered** — `ECONNREFUSED`, `ENOTFOUND`,
  `EAI_AGAIN`, which is what a pod being replaced looks like from here. A deadline is not
  retried, an answer is never retried, and neither is `ECONNRESET`: that connection may have
  delivered the request, and a task the engine has already accepted must not be sent twice.
- **The answer is parsed, not asserted.** A response that is not the contract — an older
  build, a proxy's error page, a field that changed type — is a `502` at the boundary rather
  than an `undefined` several layers into a handler. A field the engine *added* is ignored,
  because `/v0`'s compatibility rule allows one.

**Every way that call can fail is one `502 engine_unavailable`.** Down, slow, unresolvable,
holding a mismatched shared secret, or answering outside its own contract are indistinguishable
to a caller by design, and the message names no address: `OURO_ENGINE_URL` is internal
topology. A mismatched secret in particular is **never** forwarded as a `401` — that is this
deployment's mistake rather than the caller's — and it is the one failure logged by name,
because from the outside it looks exactly like an engine that is merely unwell.

The readiness probe is a separate request and stays that way. It reads `GET /healthz`, which
the engine serves without the key, and reports rather than answers — see
[Health and readiness](#health-and-readiness).

## Container

[`Dockerfile`](Dockerfile) is the production image
([#36](https://github.com/NobuData/ouroboros/issues/36)) — `deps` → `build` → a runtime
that carries no toolchain, per [conventions § 5](../docs/CONVENTIONS.md#5-containers).
**Build it from the repository root, not from here:**

```bash
docker build -f ouroboros-rest/Dockerfile -t ouroboros-rest .      # from the repo root

docker run --rm -p 4000:4000 --network ouroboros_default \
  -e OURO_DATABASE_URL=postgresql://ouroboros:ouroboros@db:5432/ouroboros \
  -e OURO_REST_URL=http://localhost:4000 \
  -e OURO_UI_URL=http://localhost:3000 \
  -e OURO_ENGINE_URL=http://engine:8000 \
  -e OURO_ENGINE_SHARED_SECRET=dev-engine-shared-secret-change-me \
  -e BETTER_AUTH_SECRET=dev-better-auth-secret-change-me \
  -e BETTER_AUTH_URL=http://localhost:4000 \
  -e OURO_GITHUB_CLIENT_ID=dev-github-client-id \
  -e OURO_GITHUB_CLIENT_SECRET=dev-github-client-secret \
  -e OURO_CORS_ORIGINS=http://localhost:3000 \
  ouroboros-rest
```

The context is the root because this module is a Yarn workspace: the lockfile it installs
from, the Yarn version and `nodeLinker` all live there, so a context of `ouroboros-rest/`
could not run an immutable install at all. **The ignore file is therefore named for the
Dockerfile** — BuildKit reads `<dockerfile>.dockerignore` in preference to
`<context>/.dockerignore`, so [`Dockerfile.dockerignore`](Dockerfile.dockerignore) is what
governs this build, and an `ouroboros-rest/.dockerignore` would govern nothing while
looking exactly like the file that does. It is an **allow-list**: `*`, then the root
manifests, the sibling workspace manifests Yarn has to resolve before it installs
anything, and this directory.

**Two dependency trees come out of one lockfile.** Unlike `ouroboros-ui` there is no
standalone output to lean on — `nest build` emits JavaScript and nothing else — so the
runtime needs a real `node_modules` beside it, and it must not be the one the build used.
The `deps` stage runs `yarn workspaces focus --production ouroboros-rest` *first*, copies
the result aside, and only then installs the full tree the build compiles against. Both
come from the same lockfile and the same cache, so nothing is resolved twice and neither
tree is a subset produced by deleting directories out of the other. The `--immutable` on
the second install is the guard: had the focused install rewritten `yarn.lock`, the build
fails rather than shipping dependencies the repository never committed.

| Property | Value |
|---|---|
| Base image | `node:24-alpine`, every stage |
| User | `nestjs`, created in the runtime stage; nothing runs as root |
| Port | 4000 (`PORT`), bound on `0.0.0.0` because `NODE_ENV=production` |
| Healthcheck | BusyBox `wget` against `/health/live` every 30 s, after a 15 s grace |
| Size | 64 MB to pull, 226 MB of layers unpacked — against a 300 MB budget |
| Runtime config | every `OURO_*` and `BETTER_AUTH_*` variable, supplied per environment — never baked into a layer |

On Docker's containerd snapshotter `docker images` reports a third number — 291 MB of
*disk usage*, which is those same layers plus the per-file overhead of unpacking some
thousands of small `node_modules` files. Every measure is inside the budget; that is the
largest of the three. Getting there costs one `find`: TypeScript declarations and source
maps are about 34 MB of the dependency tree and no running process reads either, so they
are deleted from the production copy — and from that copy only, because the build stage
type-checks against the full one.

**Four files land in one directory, and that is a requirement rather than a convenience.**
`dist/`, `package.json`, `openapi.json` and `openapi.yaml` are copied side by side because
[`src/version.ts`](src/version.ts) resolves `../package.json` and
[`src/openapi/specification.ts`](src/openapi/specification.ts) resolves `../../openapi.json`
from `__dirname` — the `rootDir`/`outDir` pinning that makes those paths correct from both
`src/` and `dist/`. `node_modules` sits one level above them, at `/app`, which is where the
workspace hoists it.

`NODE_ENV=production` is set in the image and is load-bearing twice: it is what makes
`listenHost` bind every interface — a process bound to loopback inside a container is a
process nothing can route to — and it is what strips `OURO_AUTH_DEV_USER` before the schema
sees it, so an image started with an inherited development environment ignores the bypass
rather than trusting it.

No `OURO_*` or `BETTER_AUTH_*` variable is set anywhere in the image. Each is either an
address that differs
per environment or a secret; the configuration module names every missing one at boot and
exits `2`, and a default in a layer would replace that line with a silent connection to the
wrong host — or with a published image carrying a credential.

[`src/container.spec.ts`](src/container.spec.ts) asserts every one of these properties that
is decided in the repository, because `ci/rest` cannot run a `docker build`. It reads the
probe path from `health.paths.ts` and the port from `configuration.ts` rather than restating
them, so a probe that moves fails here instead of in production; and it fails when a new
workspace gains a `package.json` and the `deps` stage has not been taught to copy it, which
is exactly the change that would otherwise break this image from another module's pull
request.

The compose service that runs this image is
[#55](https://github.com/NobuData/ouroboros/issues/55); the repo-root
[`docker-compose.yml`](../docker-compose.yml) is the data tier until then.

## Layout

```
ouroboros-rest/
├── src/
│   ├── main.ts             # entry point: read the environment, listen, report
│   ├── application.ts      # /api/v1 prefix, versioning, no body parser, shutdown, /api/docs
│   ├── version.ts          # the running build, read from package.json
│   ├── container.spec.ts   # the image, asserted from the files that define it  · #36
│   ├── openapi/            # loads the committed spec — it is never generated
│   ├── testing/            # the integration harness: container, app, sessions · #37
│   ├── auth/               # BetterAuth: options, factory, CLI config, mount · #700 #701
│   └── modules/
│       ├── app/            # heartbeat — controller, service, root module
│       ├── config/         # the zod schema, the typed service, redaction
│       ├── errors/         # the {code, message, details} envelope, filter, pipe
│       ├── health/         # /health/live, /health/ready, the two probes
│       ├── db/             # schema types, pool, Kysely instance, lifecycle
│       ├── tenancy/        # tenants, domains, members, enablement · #31 · context #32
│       ├── auth/           # GitHub OAuth, sessions, the global guard     · #33
│       └── engine/         # typed internal client + /engine/status       · #35
├── Dockerfile              # the production image — built from the *repo root*
├── Dockerfile.dockerignore # …and the context that image is built from
├── scripts/openapi.mjs     # `yarn openapi` — renders the JSON from the YAML
├── openapi.yaml            # the API specification — authoritative, hand-written
├── openapi.json            # rendered from it; the copy the service loads
├── eslint.config.mjs       # flat config; Prettier runs as a lint rule
├── jest.config.mjs         # unit suite — src/**/*.spec.ts, starts nothing
├── jest.integration.config.mjs  # src/**/*.integration-spec.ts, on a container it starts
├── jest.esm-transform.cjs  # the one ES-module dependency the suites load for real · #701
├── nest-cli.json
├── tsconfig.json           # strict; what typecheck, ts-jest and the linter read
└── tsconfig.build.json     # the same, minus the specs — what ships
```

Each of those is one directory and one entry in `AppModule.forRoot`'s `imports`, which is
the whole of what adding a module costs. `config/` is global, so a feature module reads
configuration by injecting
`AppConfigService` without importing anything; `db/` is deliberately not, so a module that
queries says so by importing it — `tenancy/` and `auth/` both do.

`auth/` contributes one thing beyond its own routes: the **global session guard**. It is
registered there as an `APP_GUARD` provider, which is what makes every route in the
application — `tenancy/`'s included — authenticated unless its handler carries `@Public()`.
That polarity is deliberate: a controller added next year is protected because somebody
wrote a controller, not because they remembered a decorator.

`tenancy/` contributes the other two global guards and the one piece of middleware in the
service, in that order: the middleware opens a request-scoped context, `TenantContextGuard`
resolves the workspace into it, and `RolesGuard` checks what the caller may do there. They
run after `auth/`'s guard because `AppModule` imports `AuthModule` first — and
`tenancy.module.spec.ts` asserts the consequence of that ordering rather than the ordering
itself, because the consequence is what matters: an unauthenticated caller must be a `401`
before anything reaches a database.

`errors/` is the one directory with no module of its own. It holds the envelope every
failure is answered in, and the filter and pipe that produce it are registered on the
*application* in `src/application.ts` rather than on a module, because they apply to routes
no module declared: a path nothing claims, a body the parser refused.

Unit tests sit beside the code they cover as `*.spec.ts`, which is the Nest convention and
what the CLI's schematics generate. They start nothing and need nothing. Tests that do need
a database are `*.integration-spec.ts` — a name `jest.config.mjs` does not match, so the
fast suite can never pick one up. The health suite proves that readiness degrades by handing
the probe a connection that refuses rather than by stopping a database: `*.fixture.ts` beside
the code is where a dependency that answers, one that refuses and one that never comes back
are defined.

`src/testing/` is the exception to *beside the code it covers*, because what it covers is
the run rather than a module ([#37](https://github.com/NobuData/ouroboros/issues/37)). Six
files, each of them a `*.fixture.ts` and therefore excluded from the build alongside the
specs:

| File                          | What it is                                                       |
| ----------------------------- | ---------------------------------------------------------------- |
| `migration.fixture.ts`        | which images, which Flyway project, which command — and its spec compares all of it with `docker-compose.yml` |
| `postgres.fixture.ts`         | starts `postgres:17-alpine` and migrates it over a private network |
| `global.setup.fixture.ts`     | Jest's `globalSetup`: start one database for the run, publish it as `OURO_DATABASE_URL` |
| `global.teardown.fixture.ts`  | …and stop it, green or red                                        |
| `global.state.fixture.ts`     | the one value the two hooks share, which cannot be a module variable |
| `harness.fixture.ts`          | `ApiHarness` — the application on a random port, sessions, roles, truncation |
| `integration.fixture.ts`      | the small shared pieces: the database guard, typed bodies, unique names |

`ApiHarness` is what a suite uses:

```ts
const api = await ApiHarness.start();
const owner = await api.signIn();
const tenant = await api.workspace(owner);

await api.as(owner)("get", `/api/v1/tenants/${tenant.id}`).expect(200);
```

The session it mints is a real one — a row in `ouroboros.session` naming a real person,
exactly as a completed sign-in would have written — so a suite using it exercises the global
guard rather than avoiding it, and can *revoke* it and watch the same cookie stop working. `api.sql` is a connection outside the application, for the arrangements the API
will not make: there is no route that creates a `viewer`, and a fixture that went through one
would make the arrangement part of what is being asserted.

## Related issues

Scaffold [#27](https://github.com/NobuData/ouroboros/issues/27) ·
API specification [#34](https://github.com/NobuData/ouroboros/issues/34) ·
config [#28](https://github.com/NobuData/ouroboros/issues/28) ·
health [#29](https://github.com/NobuData/ouroboros/issues/29) ·
data access [#30](https://github.com/NobuData/ouroboros/issues/30) ·
tenancy API [#31](https://github.com/NobuData/ouroboros/issues/31) ·
auth [#33](https://github.com/NobuData/ouroboros/issues/33) ·
BetterAuth installation & configuration [#700](https://github.com/NobuData/ouroboros/issues/700) ·
BetterAuth mounted in NestJS [#701](https://github.com/NobuData/ouroboros/issues/701) ·
GitHub social provider [#702](https://github.com/NobuData/ouroboros/issues/702) ·
database-backed sessions & the global guard [#703](https://github.com/NobuData/ouroboros/issues/703) ·
tenant context [#32](https://github.com/NobuData/ouroboros/issues/32) ·
engine gateway [#35](https://github.com/NobuData/ouroboros/issues/35) ·
the contract it mirrors [#52](https://github.com/NobuData/ouroboros/issues/52) ·
container [#36](https://github.com/NobuData/ouroboros/issues/36) ·
integration harness [#37](https://github.com/NobuData/ouroboros/issues/37) ·
the Flyway project it migrates with [#19](https://github.com/NobuData/ouroboros/issues/19) ·
the compose stack that runs it [#55](https://github.com/NobuData/ouroboros/issues/55) ·
full epic [#4](https://github.com/NobuData/ouroboros/issues/4).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
