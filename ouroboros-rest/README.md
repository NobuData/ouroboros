# ouroboros-rest

> **Status:** the service scaffold landed with
> [#27](https://github.com/NobuData/ouroboros/issues/27), validated configuration with
> [#28](https://github.com/NobuData/ouroboros/issues/28), the health probes with
> [#29](https://github.com/NobuData/ouroboros/issues/29), the database access layer with
> [#30](https://github.com/NobuData/ouroboros/issues/30) and the tenancy API with
> [#31](https://github.com/NobuData/ouroboros/issues/31) (epic
> [#4](https://github.com/NobuData/ouroboros/issues/4)). What runs today is a NestJS
> application answering a heartbeat on `/api/v1`, publishing
> [the specification it is written against](#the-api-specification), reading every setting
> through [a typed, fail-fast configuration module](#configuration), reporting
> [whether it is live and whether its dependencies are reachable](#health-and-readiness),
> holding [a typed, pooled connection to the tenancy schema](#data-access) and serving
> [the first real API of the system](#the-tenancy-api) over it, with the lint, typecheck,
> test and build pipeline `ci/rest` runs.
>
> **Nothing is authenticated yet.** Sign-in and the session are
> [#33](https://github.com/NobuData/ouroboros/issues/33) and the role guard is
> [#32](https://github.com/NobuData/ouroboros/issues/32); until both land, the tenancy
> routes are open and this build belongs on a development machine. The remaining feature
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
{"service":"ouroboros-rest","version":"0.5.0","status":"ok","uptimeSeconds":3.885}
```

| Path                                                | Purpose                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| `GET /api/v1`                                       | The heartbeat — service, build, uptime                                |
| `GET /health/live`                                  | [Liveness](#health-and-readiness) — the process, and nothing else     |
| `GET /health/ready`                                 | [Readiness](#health-and-readiness) — the process and its dependencies |
| `GET POST /api/v1/tenants`                          | [Tenants](#the-tenancy-api) — list, create                            |
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
| `OURO_ENGINE_URL`           | Base URL of `ouroboros-engine`                           |        yes         | an absolute `http://` or `https://` URL                                     |
| `OURO_ENGINE_SHARED_SECRET` | Shared secret for the internal engine call               |        yes         | at least 16 characters                                                      |
| `OURO_SESSION_SECRET`       | Signing key for the session cookie                       |        yes         | at least 16 characters                                                      |
| `OURO_GITHUB_CLIENT_ID`     | GitHub OAuth application, client id                      |        yes         | non-empty                                                                   |
| `OURO_GITHUB_CLIENT_SECRET` | GitHub OAuth application, client secret                  |        yes         | non-empty                                                                   |
| `OURO_CORS_ORIGINS`         | Browser origins allowed to call the API with credentials |        yes         | comma-separated origins — scheme, host, optional port; no path, no wildcard |

Every one of them is documented with a development default in the repo-root
[`.env.example`](../.env.example), and `scripts/verify-dev-env.sh` fails the build if this
table and that template fall out of step. `PORT` and `NODE_ENV` are the documented
unprefixed exceptions — container platforms set them, not Ouroboros
([conventions § 4](../docs/CONVENTIONS.md#4-configuration--environment-variables)).
`NODE_ENV` also decides which interface is bound: every interface in production, where the
platform routes to the container; loopback everywhere else, so a development machine does
not answer to the network it is on.

**This service does not start on defaults alone.** Seven variables have no default,
because a communications layer without a database, an engine, a signing key or a GitHub
application could serve nothing — so it names what is missing and exits rather than
starting into a wall of 500s. There is no dotenv loading, matching `ouroboros-engine`:
what a container is started with is exactly what the service runs with. Export the
template before running it directly:

```console
$ set -a && . ../.env && set +a && yarn dev     # or ../.env.example, unedited
$ node dist/main.js                            # with nothing exported
ERROR [ouroboros-rest] ouroboros-rest: invalid configuration (7 problems)
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
  keeps its host and database while its password is masked in place. Real `.env` files are
  never committed.

```console
$ yarn start
LOG [ouroboros-rest] ouroboros-rest: configuration
  PORT=4000
  NODE_ENV=development
  OURO_DATABASE_URL=postgresql://ouroboros:***@localhost:5432/ouroboros
  OURO_ENGINE_URL=http://localhost:8000
  OURO_ENGINE_SHARED_SECRET=[redacted]
  OURO_SESSION_SECRET=[redacted]
  OURO_GITHUB_CLIENT_ID=dev-github-client-id
  OURO_GITHUB_CLIENT_SECRET=[redacted]
  OURO_CORS_ORIGINS=http://localhost:3000
LOG [ouroboros-rest] ouroboros-rest 0.5.0 listening on http://127.0.0.1:4000/api/v1
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

**Nothing here is authenticated.** The issue is explicit that role enforcement arrives with
[#33](https://github.com/NobuData/ouroboros/issues/33)'s principal and
[#32](https://github.com/NobuData/ouroboros/issues/32)'s `RolesGuard` — *controllers take
the authenticated principal from request context* once those land. What is enforced today is
everything that does not depend on who is asking.

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
│       ├── tenancy/        # tenants, domains, members, GitHub enablement · #31
│       ├── auth/           # GitHub OAuth, sessions, guards    · #33
│       └── engine/         # typed internal client             · #35
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

`auth/` and `engine/` are named above and do not exist yet; each arrives as one directory
and one entry in `AppModule.forRoot`'s `imports`, which is what `health/`, `db/` and
`tenancy/` cost. `config/` is already global, so a feature module reads configuration by
injecting `AppConfigService` without importing anything; `db/` is deliberately not, so a
module that queries says so by importing it — `tenancy/` is the first that does.

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
full epic [#4](https://github.com/NobuData/ouroboros/issues/4).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
