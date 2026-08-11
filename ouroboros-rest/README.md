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
> route, and every way the engine can fail answered as one `502`. What is left in the epic
> is the container ([#36](https://github.com/NobuData/ouroboros/issues/36)), the
> Testcontainers harness ([#37](https://github.com/NobuData/ouroboros/issues/37)) and the
> security baseline ([#38](https://github.com/NobuData/ouroboros/issues/38)); the remaining
> feature modules are listed under [Layout](#layout).

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
| Tenancy         | A request-scoped tenant context over `AsyncLocalStorage`, a global guard and `@Roles(…)` ([#32](https://github.com/NobuData/ouroboros/issues/32))                          |
| Engine gateway  | A typed client over bare `fetch` — shared secret, five-second deadline, one retry, zod-parsed answers, every failure a `502` ([#35](https://github.com/NobuData/ouroboros/issues/35)) |
| API spec        | **Spec-first**: [`openapi.yaml`](openapi.yaml) is authoritative and is served verbatim; [`openapi.json`](openapi.json) is rendered from it; Swagger UI at `/api/docs`      |
| Tests           | Jest (unit) + a database-backed integration suite (`yarn test:integration`); Supertest & Testcontainers follow with [#37](https://github.com/NobuData/ouroboros/issues/37) |
| Lint            | ESLint flat config + Prettier                                                                                                                                              |
| Container       | Multi-stage Dockerfile, non-root, `HEALTHCHECK` on `/health/live` ([#36](https://github.com/NobuData/ouroboros/issues/36))                                                 |

## Run

```bash
yarn install           # immutable install from the committed lockfile
yarn dev               # http://localhost:4000/api/v1
yarn openapi           # re-render openapi.json from openapi.yaml
yarn lint
yarn typecheck
yarn test
yarn test:integration  # needs a migrated database — see Data access
yarn build && yarn start
```

`lint`, `typecheck`, `test` and `build` are what `ci/rest` runs on every pull request
touching this directory — see [conventions](../docs/CONVENTIONS.md#9-ci).

`yarn dev` is `nest start --watch`; `yarn start` runs the compiled `dist/main.js`, which
is also what the container ([#36](https://github.com/NobuData/ouroboros/issues/36)) will
run.

```console
$ curl http://localhost:4000/api/v1
{"service":"ouroboros-rest","version":"0.7.0","status":"ok","uptimeSeconds":3.885}
```

| Path                                                | Purpose                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| `GET /api/v1`                                       | The heartbeat — service, build, uptime                                |
| `GET /health/live`                                  | [Liveness](#health-and-readiness) — the process, and nothing else     |
| `GET /health/ready`                                 | [Readiness](#health-and-readiness) — the process and its dependencies |
| `GET /api/v1/auth/github`                           | [Sign in](#signing-in) — redirect to GitHub to authorize              |
| `GET /api/v1/auth/github/callback`                  | Where GitHub returns; lands the session cookie                        |
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
suite on save. `yarn test:integration` is the one command that needs a database; see
[Data access](#data-access).

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
| `OURO_SESSION_SECRET`       | Signing key for the session cookie                       |        yes         | at least 16 characters                                                      |
| `OURO_GITHUB_CLIENT_ID`     | GitHub OAuth application, client id                      |        yes         | non-empty                                                                   |
| `OURO_GITHUB_CLIENT_SECRET` | GitHub OAuth application, client secret                  |        yes         | non-empty                                                                   |
| `OURO_AUTH_DEV_USER`        | [Development sign-in bypass](#the-development-bypass)    |         no         | an email address of a row in `ouroboros.users`; ignored in production        |
| `OURO_CORS_ORIGINS`         | Browser origins allowed to call the API with credentials |        yes         | comma-separated origins — scheme, host, optional port; no path, no wildcard |

Every one of them is documented with a development default in the repo-root
[`.env.example`](../.env.example), and `scripts/verify-dev-env.sh` fails the build if this
table and that template fall out of step. `PORT` and `NODE_ENV` are the documented
unprefixed exceptions — container platforms set them, not Ouroboros
([conventions § 4](../docs/CONVENTIONS.md#4-configuration--environment-variables)).
`NODE_ENV` also decides which interface is bound: every interface in production, where the
platform routes to the container; loopback everywhere else, so a development machine does
not answer to the network it is on.

**This service does not start on defaults alone.** Nine variables have no default,
because a communications layer without a database, an engine, a signing key or a GitHub
application could serve nothing — so it names what is missing and exits rather than
starting into a wall of 500s. There is no dotenv loading, matching `ouroboros-engine`:
what a container is started with is exactly what the service runs with. Export the
template before running it directly:

```console
$ set -a && . ../.env && set +a && yarn dev     # or ../.env.example, unedited
$ node dist/main.js                            # with nothing exported
ERROR [ouroboros-rest] ouroboros-rest: invalid configuration (9 problems)
  OURO_DATABASE_URL: is required
  OURO_ENGINE_URL: is required
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
  renderer there is: the three secrets become `[redacted]`, and the connection string
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
  OURO_SESSION_SECRET=[redacted]
  OURO_GITHUB_CLIENT_ID=dev-github-client-id
  OURO_GITHUB_CLIENT_SECRET=[redacted]
  OURO_AUTH_DEV_USER=ken@acme-robotics.dev
  OURO_CORS_ORIGINS=http://localhost:3000
LOG [ouroboros-rest] ouroboros-rest 0.7.0 listening on http://127.0.0.1:4000/api/v1
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
database live in `*.integration-spec.ts` and run separately:

```bash
docker compose up -d      # from the repo root — PostgreSQL, migrated by Flyway
cd ouroboros-rest
OURO_DATABASE_URL=postgresql://ouroboros:ouroboros@localhost:5432/ouroboros \
  yarn test:integration
```

There is no default and no skip: a suite that passed when it was given no database would be
reporting "the schema matches" having compared nothing. It writes only rows named
`ouro-it-*` and removes them afterwards, so the development stack — dev seed and all — is
safe to point it at. `ci/rest` runs it against a throwaway PostgreSQL migrated from this
checkout.

`tenancy.integration-spec.ts` joins it with the API's own CRUD, over Supertest against a
real application: the constraint mapping and the last-owner rule are both claims about this
service and `ouroboros-db` agreeing, and a mocked repository can be made to agree with
anything.

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

## Signing in

**GitHub's authorization code flow, and a signed cookie**
([#33](https://github.com/NobuData/ouroboros/issues/33)). Four routes, all under
`/api/v1/auth`:

| Route                              | What it does                                                       |
| ---------------------------------- | ------------------------------------------------------------------ |
| `GET  /api/v1/auth/github`         | `302` to github.com, carrying state and a PKCE challenge           |
| `GET  /api/v1/auth/github/callback`| Verifies the handshake, exchanges the code, lands the session      |
| `GET  /api/v1/auth/me`             | The person, their memberships, and a tenant suggestion             |
| `POST /api/v1/auth/logout`         | `204`, and a `Set-Cookie` that removes the session                 |

```mermaid
sequenceDiagram
    participant B as Browser
    participant R as ouroboros-rest
    participant G as github.com
    B->>R: GET /api/v1/auth/github
    R->>B: 302 · Set-Cookie ouro_oauth {state, verifier}
    B->>G: authorize (state, code_challenge)
    G->>B: 302 …/auth/github/callback?code&state
    B->>R: callback + ouro_oauth
    R->>R: state matches?
    R->>G: exchange code + code_verifier → profile, verified email
    R->>R: upsert users / user_identities
    R->>B: 302 OURO_UI_URL · Set-Cookie ouro_session
```

Five decisions are worth knowing:

- **The `state` cookie is the CSRF defence.** The value this service generated is kept in
  a signed, `HttpOnly`, ten-minute cookie scoped to `/api/v1/auth`, and the callback is
  honoured only when the `state` in the query string matches it. An attacker can put
  anything in a URL and nothing in that cookie. PKCE rides along beside it: the verifier
  never leaves the cookie, so an intercepted `code` is worth nothing without it.
- **The session is stateless.** `ouro_session` carries a user id and an issue time, signed
  with `OURO_SESSION_SECRET` — no session table, nothing to evict. What that costs is
  revocation: signing out clears the browser's copy, and a copy taken beforehand stays
  valid for the remainder of its **seven days**. Rotating the secret ends every session at
  once. The revocable design is recorded with
  [#38](https://github.com/NobuData/ouroboros/issues/38).
- **The cookie is an id, not a copy of the person.** The `users` row is read on every
  request, so a renamed person is renamed immediately and a deleted one loses access
  immediately — where a cookie carrying a name would be a cache with no invalidation.
- **Signing in can *become* somebody who was invited.** Three outcomes: a known GitHub
  identity reuses its `users` row; an unknown identity whose verified address already
  exists attaches to that row — which is how somebody invited to a tenant before their
  first sign-in arrives already holding the membership; and a new person is created. All
  of it in one transaction.
- **The address must be verified.** `ouroboros.users.email` is unique and is what an
  invitation was addressed to, so an account offering no verified address is a `502` with
  `github_email_unavailable` rather than a guess.

`user_identities` holds **no token and no secret**: the access token is used for the two
profile reads and dropped. `ouroboros-db/tests/constraints.sql` fails if a column whose
name looks like a credential ever appears on that table.

### Signing in for real

Register a GitHub OAuth application with the callback URL
`http://localhost:4000/api/v1/auth/github/callback`, put its credentials in `.env`,
comment out `OURO_AUTH_DEV_USER`, then:

1. **Browse to** `http://localhost:4000/api/v1/auth/github` — GitHub's consent screen.
2. **Authorize**; the browser returns to the callback and lands on `OURO_UI_URL`.
3. **Browse to** `http://localhost:4000/api/v1/auth/me` — the user, created or matched.

### The development bypass

`OURO_AUTH_DEV_USER` treats every request as coming from the person with that address, so
local work needs no GitHub OAuth application at all. The address must name a real
`ouroboros.users` row — the development seed
([#23](https://github.com/NobuData/ouroboros/issues/23)) creates
`ken@acme-robotics.dev` — and one nobody has grants nothing rather than creating anybody.

It is **off in production**, twice over: `loadConfiguration` drops the variable when
`NODE_ENV=production`, so there is no value for anything to read, and the accessor the
guard uses refuses one anyway. The boot log prints `OURO_AUTH_DEV_USER=` with nothing
after it, which is the line to check. A real session cookie still wins over it, so the
OAuth flow stays exercisable on a machine that has it set.

## The tenant context

**Every request past sign-in operates as a member of one workspace**
([#32](https://github.com/NobuData/ouroboros/issues/32)), and that is resolved once, in one
place, rather than re-implemented per controller.

```
request ─▶ middleware ─▶ SessionGuard ─▶ TenantContextGuard ─▶ RolesGuard ─▶ handler
           opens the      who is           which workspace,      may they
           context        asking (#33)     and are they in it    do this
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

## Layout

```
ouroboros-rest/
├── src/
│   ├── main.ts             # entry point: read the environment, listen, report
│   ├── application.ts      # /api/v1 prefix, URI versioning, shutdown hooks, /api/docs
│   ├── version.ts          # the running build, read from package.json
│   ├── openapi/            # loads the committed spec — it is never generated
│   └── modules/
│       ├── app/            # heartbeat — controller, service, root module
│       ├── config/         # the zod schema, the typed service, redaction
│       ├── errors/         # the {code, message, details} envelope, filter, pipe
│       ├── health/         # /health/live, /health/ready, the two probes
│       ├── db/             # schema types, pool, Kysely instance, lifecycle
│       ├── tenancy/        # tenants, domains, members, enablement · #31 · context #32
│       ├── auth/           # GitHub OAuth, sessions, the global guard     · #33
│       └── engine/         # typed internal client + /engine/status       · #35
├── scripts/openapi.mjs     # `yarn openapi` — renders the JSON from the YAML
├── openapi.yaml            # the API specification — authoritative, hand-written
├── openapi.json            # rendered from it; the copy the service loads
├── eslint.config.mjs       # flat config; Prettier runs as a lint rule
├── jest.config.mjs         # unit suite — src/**/*.spec.ts, starts nothing
├── jest.integration.config.mjs  # src/**/*.integration-spec.ts, needs a database
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
fast suite can never pick one up — and the harness that will run them without a compose
stack, on Testcontainers, is [#37](https://github.com/NobuData/ouroboros/issues/37). The
health suite proves that readiness degrades by handing the probe a connection that refuses
rather than by stopping a database: `*.fixture.ts` beside the code is where a dependency
that answers, one that refuses and one that never comes back are defined.

## Related issues

Scaffold [#27](https://github.com/NobuData/ouroboros/issues/27) ·
API specification [#34](https://github.com/NobuData/ouroboros/issues/34) ·
config [#28](https://github.com/NobuData/ouroboros/issues/28) ·
health [#29](https://github.com/NobuData/ouroboros/issues/29) ·
data access [#30](https://github.com/NobuData/ouroboros/issues/30) ·
tenancy API [#31](https://github.com/NobuData/ouroboros/issues/31) ·
auth [#33](https://github.com/NobuData/ouroboros/issues/33) ·
tenant context [#32](https://github.com/NobuData/ouroboros/issues/32) ·
engine gateway [#35](https://github.com/NobuData/ouroboros/issues/35) ·
the contract it mirrors [#52](https://github.com/NobuData/ouroboros/issues/52) ·
full epic [#4](https://github.com/NobuData/ouroboros/issues/4).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
