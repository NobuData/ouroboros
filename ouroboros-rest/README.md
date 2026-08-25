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
| `GET POST /api/auth/get-session`                    | Who is signed in — BetterAuth's, and the only route that answers it   |
| `GET /api/auth/organization/*`                      | Workspaces, membership and roles — the [organization plugin](#the-two-client-rule) |
| `POST /api/v1/auth/logout`                          | Sign out — the versioned alias of `/api/auth/sign-out`                |
| `POST /api/v1/auth/discover`                        | [Company domain → SSO?](#domain-discovery) — public, and uniform for every domain |
| `GET PATCH /api/v1/me/preferences`                  | The caller's own settings (#649) — the font scale; per person, no workspace required |
| `GET /api/v1/dashboard`                             | [The dashboard](#the-dashboard) (#70) — mockup 02's six cards in one payload, with an `ETag` |
| `GET /api/v1/runs`                                  | The paged run listings (#71) — `status=active\|terminal`, optional `repo` filter; the aggregate's slices are pages of these |
| `GET /api/v1/runs/{id}`                             | One run, in the same `RunSummary` shape everywhere; another workspace's id is a `404`, never a `403` |
| `GET /api/v1/queue`                                 | The ordered queue (#73) — `position` ascending, optional `repo` filter, `totalEstMinutes` equal to the stat row's own sum |
| `GET PATCH /api/v1/settings/auto-merge`             | The auto-merge switch (#74) — read by any member, flipped by `owner`/`admin` only; the dashboard's one write |
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

**A second document sits beside them**, and describes a different boundary:
[`openapi.internal.yaml`](openapi.internal.yaml) is the two paths `ouroboros-engine` calls
([#224](https://github.com/NobuData/ouroboros/issues/224)) — see
[The internal surface](#the-internal-surface). `yarn openapi` renders both pairs and `yarn
test` holds both to the router in both directions. It is a separate document rather than a
section of the first because folding it in would publish engine-facing operations into the
client `ouroboros-ui` generates, and **it is not served**: the public document answers at
`/api/openapi.{json,yaml}` for a client generator on somebody's laptop, while this one is
read out of the repository by AF.1 ([#234](https://github.com/NobuData/ouroboros/issues/234)),
AF.2 ([#235](https://github.com/NobuData/ouroboros/issues/235)) and the engine's client stub.

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
| `OURO_VAULT_MASTER_KEY`     | The credential vault's key-encryption key — see [The vault](#the-vault) |        yes         | **exactly** 32 bytes, base64 (`openssl rand -base64 32`)                    |
| `OURO_CORS_ORIGINS`         | Browser origins allowed to call the API with credentials |        yes         | comma-separated origins — scheme, host, optional port; no path, no wildcard |
| `OURO_DASHBOARD_POLL_SECONDS` | Seconds sent as `X-Ouro-Poll-After` on dashboard answers — raise it to slow every poller under load |      no — 15       | a whole number of seconds, 1–3600                                           |
| `OURO_LISTEN_HOST`          | Bind-interface override — set only by the e2e stack ([#647](https://github.com/NobuData/ouroboros/issues/647)); unset, `NODE_ENV` decides as always |     no — unset     | exactly `127.0.0.1` or `0.0.0.0`                                            |
| `OURO_LOCAL_PROVIDER_URLS`  | Where this deployment's **local** model providers are — what a worker is told by the [internal surface](#the-internal-surface) ([#224](https://github.com/NobuData/ouroboros/issues/224)) |     no — unset     | comma-separated `kind=url` pairs; `ollama` and `openai_compatible` only, each an absolute `http(s)` URL |
| `OURO_PROVIDER_HEALTH_INTERVAL_SECONDS` | Seconds between [provider health](#provider-health) sweeps, and the age at which a local provider's last check is stale ([#196](https://github.com/NobuData/ouroboros/issues/196)) — jittered ±25% |      no — 60       | a whole number of seconds, 10–86400 |
| `OURO_PROVIDER_HEALTH_KEY_CHECK_SECONDS` | Seconds before a cloud provider's key validation is redone — deliberately much slower, because it asks a vendor rather than the operator's own machine |     no — 900      | a whole number of seconds, 60–86400 |

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

`OURO_VAULT_MASTER_KEY` is the one variable here whose rule is an *exact* length rather
than a floor, and the difference is what being wrong costs. A signing key that is not what
the operator meant produces sessions nobody can use, and correcting it fixes them. A
key-encryption key that is not what the operator meant produces credential ciphertext
nobody can ever open, and correcting it afterwards does not help — so a 31-byte value, or a
passphrase somebody typed, is refused at boot rather than stretched to fit. See
[The vault](#the-vault).

**This service does not start on defaults alone.** Twelve variables have no default,
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
ERROR [ouroboros-rest] ouroboros-rest: invalid configuration (12 problems)
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
  keeps its host and database while its password is masked in place. `NODE_ENV` is
  deliberately *not* redacted — it is the line an operator reads to confirm whether the
  [development sign-in](#the-development-sign-in) exists in a deployment, and that is the
  only thing gating it. Real `.env` files are never committed.

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
  OURO_VAULT_MASTER_KEY=[redacted]
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
[`src/modules/db/schema.ts`](src/modules/db/schema.ts) _mirrors_ the migrations so a query
can be type-checked — the tenancy tables of V001–V007, and since
[#70](https://github.com/NobuData/ouroboros/issues/70) the dashboard read-model of V008–V011
with the two views V010 and V011 publish over it. A view is read and never written, which
`Database` has no vocabulary for; `READ_ONLY_VIEWS` beside it is that vocabulary.

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
project to it with the pinned `flyway/flyway:13-alpine`, boots the application on a random
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

**It loads the real BetterAuth**, and that is the difference between this runner and
`yarn test` — [#715](https://github.com/NobuData/ouroboros/issues/715).
`jest.integration.config.mjs` converts the library and its ES-module dependencies through
`jest.esm-transform.cjs` instead of mapping them at `src/auth/better-auth.fixture.ts`, so a
sign-in below is a sign-in: a scrypt hash the library wrote and verified, a signed cookie it
checks, a `session` row it deletes. The unit suite still substitutes it, deliberately — see
*Testing the mount*.

What runs:

| Suite                                    | What only a real database can answer                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `db.integration-spec.ts`                 | the `Database` interface names the columns Flyway created; the pool drains         |
| `tenancy.integration-spec.ts`            | CRUD end to end, constraint → envelope mapping, the last-owner rule                |
| `auth.integration-spec.ts`               | the guard's reading of a session row: absent, expired, deleted, never issued       |
| `credentials.integration-spec.ts`        | a password buys a session; the hash is a hash; production refuses the route        |
| `github.integration-spec.ts`             | the whole OAuth handshake against a stubbed github.com — state, exchange, profile  |
| `session.lifecycle.integration-spec.ts`  | sign-out deletes the row, and the copied cookie stops working                      |
| `organizations.integration-spec.ts`      | the organization plugin's own routes: create, list, set-active, and its role matrix |
| `discovery.integration-spec.ts`          | a known domain and an unknown one answer with the same bytes, in the same time      |
| `roles.integration-spec.ts`              | the role matrix — 11 routes × 6 callers, through the guards that are really on      |
| `guard.surface.integration-spec.ts`      | every route in the table, answered: 401 for a stranger, not-401 for a session       |
| `harness.integration-spec.ts`            | the harness itself: the image, the migrations, the port, the truncation             |

**No credential and no network.** `src/testing/github.fixture.ts` replaces this process's
`fetch` for the three github.com endpoints an OAuth sign-in touches, and throws on anything
else — so a suite that quietly reached the internet fails immediately and by name rather
than passing on a laptop and failing in CI.

The two matrices are what answer #37's second criterion and #715's. `RolesGuard`'s unit spec
proves the guard refuses a role that is not in its list — with metadata the test wrote. It
cannot prove the metadata is *there*: delete `@Roles(...ADMINISTRATORS)` from a controller
and every unit spec still passes, because none of them go through the router that reads it.
`roles.integration-spec.ts` does, for every route this service serves, as every role;
`organizations.integration-spec.ts` does the same for the routes the organization plugin
serves. Both were checked by doing it — one deleted `@Roles(...ADMINISTRATORS)` turns four
tests red, and a global auth guard that stops guarding turns 141 red.

## The vault

**The one place in Ouroboros that encrypts a secret**
([#222](https://github.com/NobuData/ouroboros/issues/222), roadmap decision **P2**).
Mockup 07's security strip promises that credentials are *sealed per-tenant with envelope
encryption*; [`src/modules/vault/`](src/modules/vault) is what makes that sentence true.

```
secret ──encrypt(workspace, record)──▶ envelope string, stored in the consumer's column
  ▲                                          │   AES-256-GCM · 96-bit nonce
  │                                          │   AAD = workspace id + record id
  └──────────── per-workspace DEK ───────────┘
                       │ wrap / unwrap
                       ▼
                  KeyWrapper ──▶ OURO_VAULT_MASTER_KEY          (today)
                             ─ ▶ AWS/GCP KMS · Vault/OpenBao    (#236)
                       │
                       ▼
             ouroboros.tenant_keys (sealed DEK · version · rotated_at)
```

The shape buys three things, and each is a property something checks rather than a claim:

- **A ciphertext cannot be moved.** The workspace id and the record id are bound into the
  additional authenticated data, so a value lifted from one workspace's row and pasted into
  another's fails authentication instead of decrypting. The encoding is length-prefixed, so
  no pair of identifiers can forge another pair's binding.
- **Deleting a workspace destroys its secrets.** `tenant_keys` cascades from `organization`,
  so the key goes with the workspace and every ciphertext it sealed becomes unopenable —
  including the copies in backups, which hold the rows and not the key. The service keeps
  **no key cache**, which is the condition that guarantee depends on.
- **Custody can be upgraded without a data migration.** A `KeyWrapper` seals data-encryption
  keys and nothing else, so moving to KMS or Vault (AF.3,
  [#236](https://github.com/NobuData/ouroboros/issues/236)) re-wraps `tenant_keys` and leaves
  **every credential ciphertext byte-identical**. `VaultService.rewrap` is the whole of it,
  and its test asserts that byte-for-byte rather than by a round trip.

Rotation is additive: a new key version becomes active and the old one stays readable, so a
value sealed under version 3 still opens after version 4 arrives. What finishes the job is
`VaultRotation` — lazy re-encryption when a consumer writes a record anyway, and a sweep for
everything nobody touched, started detached by `rotate` and awaitable on its own.

**One store is registered with the sweep, and the module says which.** Y.1
([#189](https://github.com/NobuData/ouroboros/issues/189)) brought the first encrypted
column this schema has — `provider_connections.credentials_encrypted`, V015 — so
`VAULT_SECRET_STORES` holds `registry/`'s `ProviderCredentialStore` and a rotation re-seals
it. Q.1 ([#138](https://github.com/NobuData/ouroboros/issues/138)) and K.3
([#101](https://github.com/NobuData/ouroboros/issues/101)) are still open and register
theirs the same way. **A store lands with the migration that creates its column**, not with
the first thing that writes one: a sealed column the sweep cannot see is a rotation that
reports success while leaving ciphertext on the key version it then retires. The same pass
both re-seals what this service already sealed and adopts what it never did — the one-time
migration and the sweep are one code path, and V015's own CHECK means there is nothing here
to adopt, because that column cannot hold an unsealed value.

**There is no route.** `VaultModule` declares no controller: a route that decrypted a
credential would be a route that returned one, and which of those exist is AD.2's
([#223](https://github.com/NobuData/ouroboros/issues/223)) decision behind a
re-authentication step.

Decrypted material lives only in request scope and is zeroized best-effort in a `finally`.
That it never reaches a log is held by two things rather than by review:
`src/modules/vault/no-secret-logging.mjs` is a lint rule that fails the build on an
identifier naming secret material inside a log call, and `redaction.spec.ts` captures every
sink while driving the vault through every operation and every failure path.

`OURO_VAULT_MASTER_KEY`'s honest cost — key custody is the operator's problem in the default
deployment — is documented in `docs/SECURITY_MODEL.md` (AD.5,
[#226](https://github.com/NobuData/ouroboros/issues/226)) rather than glossed as
"KMS-backed". Rotating it is a re-wrap and rewrites no credential.

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

## The dashboard

**One request paints the whole page** ([#70](https://github.com/NobuData/ouroboros/issues/70)).
`GET /api/v1/dashboard` answers with everything
[`docs/mockups/02-dashboard.html`](../docs/mockups/02-dashboard.html) draws: the four stat-row
figures, the pulse card's three meters and its auto-merge switch, the runs in flight, the runs
that have stopped, the head of the queue, and the page head's subline.

```
GET /api/v1/dashboard                    ─▶ 200 + ETag "9c1f…"   { stats · pulse · activeRuns
      If-None-Match: "9c1f…"  unchanged  ─▶ 304 · no body          · recentRuns · queueHead
                              changed    ─▶ 200 + ETag "4b7e…"     · activity }
```

**Six cards and not six requests**, which is decision F5 of the dashboard roadmap. Assembling
the page from one request per card would tear it — the cards would land at different moments,
each with its own idea of where "the last seven days" begins — and would multiply the cost of
a loop that polls for as long as somebody is looking at the screen. The drill-in endpoints
([#71](https://github.com/NobuData/ouroboros/issues/71),
[#73](https://github.com/NobuData/ouroboros/issues/73)) exist for the screens that go deeper,
not for the dashboard to build itself out of.

**Polling is a header exchange.** The `ETag` is strong and is derived from a *version source*
rather than from the payload: a row count and the newest change per source table, plus the
calendar day, hashed. That is what a `304` costs — four aggregate subqueries returning no
rows — and it is why the poll loop is cheap. The day is in the hash because two of the
payload's numbers are calendar facts that change at midnight with no row having moved.
The rest of the contract — the 15-second visible-tab interval, the `X-Ouro-Poll-After`
backoff hint every answer carries, and the SSE upgrade path — is
[`docs/ARCHITECTURE.md` § 5.4](../docs/ARCHITECTURE.md#54-the-polling-contract)
([#75](https://github.com/NobuData/ouroboros/issues/75)).

**Every window is published, because a number whose definition is not written down is a
number a screen renders under the wrong label.** The rolling windows are durations back from
the request instant, so no timezone and no daylight-saving transition can move them; the two
calendar figures — the day's token spend and what has merged "since this morning" — are
measured from **midnight UTC**, which is the day `token_usage_daily` is keyed by. The
autonomous merge rate is measured over **fourteen** days and the other two meters over
**seven**: `92%` is exact over the fourteen the seed spans and is not reachable over seven at
all. `openapi.yaml`'s `LoopPulse` carries the full argument, and
`src/modules/dashboard/resources.ts` carries it beside the code.

**An empty organization answers zeros and empty arrays** — never a `null` a card would divide
by, and never an absent key. That is what makes the empty state a design decision
([#86](https://github.com/NobuData/ouroboros/issues/86)) rather than a crash.

This module **writes nothing**: every statement it issues is a `select`, including the one
that reads the auto-merge switch. Changing that switch is
[#74](https://github.com/NobuData/ouroboros/issues/74)'s endpoint.

## Model pricing

**One resolution of *what does this model cost*, with its provenance attached**
([#586](https://github.com/NobuData/ouroboros/issues/586)). It serves mockup 21's
`$ per 1M in·out` column and the accounting that DASH-J.4
([#92](https://github.com/NobuData/ouroboros/issues/92)), Z.5
([#198](https://github.com/NobuData/ouroboros/issues/198)) and AB.4
([#210](https://github.com/NobuData/ouroboros/issues/210)) need — one implementation, because
three would be three sets of numbers that disagree inside one report.

```
resolve(anthropic, claude-fable-5, org) ─▶ {token, 1000¢, 5000¢, bundled@2026-08-15} ─▶ "$10 · $50"
resolve(copilot,   gpt-5-codex,    org) ─▶ {seat}                                    ─▶ "seat-based"
resolve(cursor,    composer-2,     org) ─▶ {usage}                                   ─▶ "usage-based"
resolve(ollama,    qwen3-coder:32b,org) ─▶ {free}                                    ─▶ "$0"
resolve(∅,         gpt-5.2-preview,org) ─▶ ∅                                         ─▶ "—"   (never $0)

PUT /api/v1/registry/prices {anthropic, claude-fable-5, 1200¢/6000¢}
                                        ─▶ override wins · source: override · cache dropped
```

**`$0` and `—` are different facts, and the types keep them apart.** `$0` is a `free` row: a
model that genuinely costs nothing per call, because it runs on hardware the workspace already
pays for. `—` is the *absence* of a row: we have no price for this model. `ResolvedPrice` has
no member meaning *unknown*, so an uncovered model is `undefined` and cannot reach a formatter
that would render it as a number — which is the whole point on a page somebody sizes a budget
from.

**The rendering lives in one place.** `src/modules/pricing/price.ts` is the four shapes and the
fifth that is an absence, so the UI never re-derives them; every answer also carries `display`,
already rendered.

**The precedence is the database's** — `ouroboros.model_price()` (V012,
[#580](https://github.com/NobuData/ouroboros/issues/580)) resolves *override beats bundled,
exact model beats a family row, exact kind beats `'*'`* in one indexed lookup, and nothing here
re-derives it. A whole alias list is one statement: `unnest(…) with ordinality` joined
laterally to that function, so eight rows cost one round trip and an uncovered pair keeps its
place rather than shortening the answer.

**Prices are cached for thirty seconds, per `(workspace, kind,
model)`**, misses included — the uncovered row is on the same page as the priced ones. An
override write drops the **whole workspace**, not the key that was written, because a family
row such as `('openai_compatible', '*') → free` changes the answer for models it never names.
The bundled catalog is imported by a repeatable Flyway migration in another container, so
nothing can tell this process about it: the TTL is the honest bound on that, and
`PricingService.invalidateCatalog()` is the seam CJ.1
([#598](https://github.com/NobuData/ouroboros/issues/598)) will call.

**Three routes, and deliberately no fourth.** `GET`, `PUT` and `DELETE
/api/v1/registry/prices` are a workspace's own **corrections** — the read is every member's,
both writes are `owner`/`admin`. There is no route that *resolves* a price: CH.5
([#588](https://github.com/NobuData/ouroboros/issues/588)) publishes it as part of the registry
table's one payload, and a second endpoint answering the same question would be a second place
for the answer to come from. `PricingModule` exports `PricingService` for exactly that reason —
it is the only module here that exports anything.

## The model registry

**One resolution of *what does this alias mean*, and no way to change one**
([#189](https://github.com/NobuData/ouroboros/issues/189)). `src/modules/registry/` reads
V015's `provider_connections` and `model_aliases` — where a workspace's model providers are,
and the names its routes are allowed to use.

```
resolve(org, "coder-max")  ─▶ claude-fable-5 · Anthropic          · {thinking: max}
resolve(org, "local-docs") ─▶ llama-4-maverick · Ollama           · http://workstation.local:11434
resolve(org, "Coder-Max")  ─▶ 404 model_alias_not_found            (aliases are stored folded)
list(org)                  ─▶ every alias, resolved, ordered by name — the swap menu's payload
dependentAliases(org, id)  ─▶ ["coder-max", "local-docs"]          — what blocks removing a provider
```

**An alias is the only thing a route may name** — roadmap decision **M1**.
`model_aliases.model_id` is the one column in the schema where a raw provider model string
lives, so swapping `coder-max` from one model to another is one edit of one row rather than a
search-and-replace across every routing table. `ResolvedAlias` is what makes that useful to a
consumer: it hands back the model, its parameters, and enough about the connection to reach it.

**There is no CRUD here, and that is decision M2.** Mockup 07 (*Providers & keys*) owns
provider management and mockup 21 (*Model registry*) owns alias management. Routing is
unbuildable without the rows underneath both, so the schema and these accessors land first and
every create, update and delete stays with those roadmaps. `RegistryModule` declared **no
controller at all** until mockup 21 arrived, and what it declares now is a *read*; CH.1
([#584](https://github.com/NobuData/ouroboros/issues/584)) is the alias CRUD, and
`registry.module.spec.ts` asserts the controller list so a second entry has to be stated out
loud rather than noticed in review.

### The param & capability service

**The inspector offers only the tunables the bound model actually has, and the table's chips
are derived rather than stored** (CH.2,
[#585](https://github.com/NobuData/ouroboros/issues/585)). Two ways for mockup 21's densest
cell to become a lie, closed:

```
GET /api/v1/registry/param-schema?connection=…&model=claude-fable-5
  ─▶ thinking [off|std|max] · token budget ≤1M · max output ≤128k (catalog) · temp 0–1
GET /api/v1/registry/param-schema?model=gpt-5.2-preview
  ─▶ {} · reason: alias_unbound · restrictions still offered
{thinking: max} on qwen3-coder:32b ─▶ 422 params.thinking "…does not support thinking"
{thinking: max, token_budget: 400000} ─▶ chips (max thinking)(400k budget)
```

**The form is generated from what the adapter says.** `ModelProviderAdapter.paramSchema(model)`
is CH.2's amendment to AC.1's SPI, and the schema it answers is merged with four sources in one
precedence: the adapter, then what the provider reported into `provider_models` (V017), then —
**filling absent bounds only, never overriding** — the bundled price catalog's metadata (V012),
then what `model_aliases.params` will store at all. Every field says which of them shaped it, so
a reader can tell a live bound from a catalogued one instead of distrusting both.

**The schema that renders the form is the schema that validates the write.** `ajv` compiles the
same document, so a `422` names `params.thinking` or `restrictions.batch_ok` and quotes the range
the form was drawn with. `ParamSchemaService` is exported for exactly that: CH.1 calls
`assertWriteValid` before every create and update rather than re-implementing a rule about
capabilities.

**The chips are a pure function of the two stored documents.** There is no display column to
drift from the structure on the first edit that misses it — `paramChips(params, restrictions)`
is the one derivation, and all eight of mockup 21's rows reproduce from it exactly, twice.

**A resolution cannot carry a credential.** `ResolvedConnection` has no field for one, the
statements name explicit columns and never `credentials_encrypted`, and both are *probes*
rather than conventions: `registry.repository.spec.ts` compiles every read statement and
asserts the SQL does not mention the column (nor use a `select *` that would pull it in
unnamed), and `registry.integration-spec.ts` puts a real ciphertext on a row and looks for it
in every answer and every log line. V015 is the third layer — the column accepts an
`ouro.v1.…` envelope and nothing else, so what leaks in the worst case is ciphertext.

**Removing a provider aliases depend on is refused, and the refusal says what is in the way.**
V015's composite foreign key restricts on delete, which is correct and unreadable —
*violates foreign key constraint "model_aliases_provider_fk"* is not a sentence anybody can
act on. `registry.errors.ts` is the designed answer: a `409 provider_connection_in_use` naming
the aliases, built from `dependentAliases`. `isProviderConnectionInUse` recognises the same
violation raised by the race that pre-flight cannot close, so mockup 07's delete has both
halves waiting for it.

**It registers the vault's first secret store.** `VAULT_SECRET_STORES` was an empty array
until V015, because no migration declared an encrypted column;
`registry/registry.secrets.ts` is `provider_connections`'s, and it lands with the migration
rather than with the first thing that writes a credential — a sealed column the re-encryption
sweep cannot see is a rotation that reports success while leaving ciphertext on the key
version it then retires.

### The alias lifecycle

**Every write mockup 21's registry can make, with the guards that make its caption true**
(CH.1, [#584](https://github.com/NobuData/ouroboros/issues/584)). Decision **M2** held the
registry's CRUD back until mockup 21 was written; this is mockup 21 writing it —
`src/modules/registry/aliases.*.ts`, under tenant context, owner/admin write, member read.

```
GET    /api/v1/registry/aliases                  the table: switch · binding · params · notes · Used by
POST   /api/v1/registry/aliases                  + New alias — bound (checked against discovery) or unbound (forced off)
PATCH  /api/v1/registry/aliases/{id}             Save alias · the On switch · rename · rebind
POST   /api/v1/registry/aliases/{id}/duplicate   <alias>-copy, -copy-2 … · switched off
DELETE /api/v1/registry/aliases/{id}             204, or 409 naming every referrer with its kind
GET    /api/v1/registry/aliases/model-options    the inspector's select, listed live from the provider
```

**Rebind is one row and touches nothing else** — *"Point coder-max at Bedrock tomorrow; zero
workflow or route edits."* A `PATCH` with a new `connectionId` writes
`model_aliases.provider_connection_id` and nothing in any route, rule or workflow; the stored
params are re-validated against the *new* model through CH.2's schema; and the answer's
`nextResolution` states where the next resolution now goes. `aliases.integration-spec.ts`
asserts that the four references survive *and* that `POST /routing/simulate` resolves to the
new connection — asserted, not assumed.

**Delete is blocked, and says by what.** The referrer list is read inside the delete's own
transaction through V023's `alias_reference_guard()`, so the `409 model_alias_referenced` a
client renders is still true when the delete would have run; `details.references` carries
every referrer with its kind and its chip label — a work list, not *in use*.

**Rename is delete-shaped** (decision **R5**): workflow documents hold the alias by name, so
renaming a referenced alias is `422 model_alias_rename_blocked` with the same list, and an
unreferenced alias renames freely.

**An unbound alias is never enabled through this API.** V019's CHECK would refuse it too;
what the user gets is `422 model_alias_unbound` with `details.fix: /models/providers` —
mockup 21's *Fix in Providers →* — decided before any statement runs. Creating one stores it
switched off whatever the body said, with an `alias_unbound` warning; unbinding an enabled one
switches it off and says so. The AC.6 discovery warning is **surfaced rather than
swallowed**: a bound alias naming a model discovery has not reported is saved, and the answer
carries `model_not_discovered` — a trigger's `WARNING` is a notice on the wire nobody would
render, so the repository asks the trigger's own predicate instead.

**Every write leaves exactly one revision, and a no-op leaves none.**
[`V025__alias_revisions.sql`](../ouroboros-db/migrations/V025__alias_revisions.sql) is V021's
table for the registry — who, when, an action from a closed vocabulary (`created`, `renamed`,
`rebound`, `enabled`, `disabled`, `edited`, `duplicated`, `deleted`) and a
`{<column>: {from, to}}` diff whose grammar is a CHECK. The row and its record are one
transaction; a `PATCH` whose every field already held that value answers `revisionId: null`
and writes nothing. CJ.2 ([#599](https://github.com/NobuData/ouroboros/issues/599)) promotes
these into `audit_events`, and the columns are that table's nouns so the promotion is a copy.

## Provider health

**Real checks where they are cheap, key validation where it is honest, and `unknown` where
neither is** ([#196](https://github.com/NobuData/ouroboros/issues/196), roadmap decision
**M8**). `src/modules/provider-health/` is what fills mockup 06's `.phealth` strip, and what
Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194)) resolves a fallback chain
against.

```
GET /api/v1/routing/providers ─▶ Anthropic          ● 42ms
                                 Cursor             ◌
                                 GitHub Copilot     ⚠ degraded · elevated latency
                                 Ollama             ● workstation · 3 models
                                 OpenAI-compatible  ● vllm-local · 2 models
```

**No completion request is issued, anywhere, ever.** The tempting implementation of a health
strip sends a one-token completion to every provider every minute: real end-to-end latency,
every dot green, and a bill that grows forever to decorate a status bar. That is option
**2-B** and M8 refuses it. What runs instead is a table of listing routes:

| Kind                | Check                                    | Yields                                    |
| ------------------- | ---------------------------------------- | ----------------------------------------- |
| `ollama`            | `GET /api/tags`                          | reachable, and the daemon's model count   |
| `openai_compatible` | `GET /v1/models`                         | reachable, and the served models          |
| `anthropic`         | `GET /v1/models?limit=1`, slow, jittered | is the credential still good, and how long it took |
| `copilot`, `cursor` | —                                        | `unknown`, until traffic exists           |
| `custom`            | —                                        | `unknown`, always                         |

The non-goal is *tested rather than documented*, and in two halves that cover each other:
`checks.spec.ts` asserts that no entry in the policy table names a generation route, and
`probe.client.spec.ts` drives every entry through the client and asserts a `GET` with no body.
`provider-health.integration-spec.ts` then sweeps all five kinds against real loopback servers
and reads the record of what they were actually sent.

**This service writes only states it observed.** A check that ran writes `active` or `error`.
A check that could not run — a kind with nothing cheap to ask, a row with no address, a cloud
connection whose key has not been entered, a credential this deployment cannot open — writes
**nothing at all**, and the row keeps whatever it had. That is what makes `unknown` a real
state instead of a placeholder waiting to be overwritten, and it is why Copilot and Cursor
stay honest until AB.2 ([#208](https://github.com/NobuData/ouroboros/issues/208)) can derive
their state from real invocations.

**A latency appears only where a check measured one.** No default, no zero, no interpolation:
on a strip somebody reads reliability from, `0ms` is not *we do not know*, it is an excellent
latency for a provider nothing has ever called. V015 says the same thing from the other side
— `health` content requires a `last_checked_at`, and `latency_ms` must be a non-negative
number if it is there at all. A local daemon's round trip is measured and deliberately *not*
stored: it is dominated by the loopback interface, and a chip printing an unvarying `0ms`
teaches its reader to ignore the one number on the strip that does vary.

**The cadence is jittered, and so is the first cycle.** Ouroboros is self-hosted: a hundred
installations checking on a whole-minute boundary are a hundred requests arriving at a
vendor's endpoint in the same second, from addresses that look unrelated to each other and
coordinated to the vendor. Every delay lands within ±25% of the configured interval, the first
one included, so a fleet restarted together does not converge. Local kinds are checked on
`OURO_PROVIDER_HEALTH_INTERVAL_SECONDS`; a cloud row is only revisited once its own last check
is `OURO_PROVIDER_HEALTH_KEY_CHECK_SECONDS` old.

**`health` is jsonb, and AB.2's fields already have somewhere to go.** The probe owns `check`,
`latency_ms`, `models` and `detail`; a `traffic` sub-object is reserved for AB.2's error-rate
and p95 windows, and needs no migration because jsonb has no columns to add. What makes the
reservation real is that the writer merges rather than replaces — anything this service does
not own is copied through untouched, so a traffic window written by AB.2 is still there after
the next sweep sixty seconds later, and `snapshot.spec.ts` and the integration suite both
assert it.

**This is the first module here to hold a plaintext provider credential**, and it holds one
for the length of one probe. `RegistryModule` deliberately imports no vault — a resolution
carries an address and never a key — and this module is the different case: validating a
credential means presenting it. It is opened for a key-validation check, handed to the
request's own header builder, and never returned, stored, logged or written to the row. If the
vault *cannot* open it, that is this deployment's fault rather than Anthropic's: it is logged
for an operator and the row is left exactly as it was.

**Nothing checks on demand.** The route is a read; the cadence is the scheduler's. A *check
now* button would let anybody holding a session make this service issue outbound requests at
whatever rate they can click — a small denial of service against a vendor's rate limit, signed
with the workspace's own credential.

**It is also the first periodic work in this service**, which is what brought
`@nestjs/schedule` in. The sweep is a self-rescheduling timeout registered with
`SchedulerRegistry` rather than an `@Interval`, because a decorator fixes its period when the
class is defined and this one has to be different on every tick. It never overlaps itself, a
failed cycle is logged and the loop continues, and `onApplicationShutdown` clears the timer.

## Route resolution

**One pure, versioned, health-aware function behind simulation today and execution tomorrow**
([#194](https://github.com/NobuData/ouroboros/issues/194), roadmap decision **M6**).
`src/modules/routing/` answers *which model runs this*, once, so that the estimator, the DSL's
`route.task(...)`, the simulate panel and the eventual execution bridge cannot each grow a
slightly different answer.

```
resolve("implement", {effort: "l"}) ─▶
  rules   effort ≥ L → implement uses coder-max (max thinking)   applied
  1  coder-max      → claude-fable-5 · Anthropic Claude          kept     Primary · healthy · 42ms
  2  coder-fallback → gpt-5-codex · GitHub Copilot               kept     Fallback 1 · healthy · elevated latency
  3  local-docs     → qwen3-coder:32b · Ollama                   kept     Fallback 2 · healthy
  floor  none  ·  max cost  250¢  ·  version  r1
```

**One route serves the engine, and it injects nothing else.**
`POST /api/v1/routing/simulate` is **Simulate routing**
([#197](https://github.com/NobuData/ouroboros/issues/197)): it calls `ResolutionService.resolve`
and returns what came back, unchanged. That the simulator cannot drift from execution is a fact
about the dependency graph rather than a promise in a comment — `SimulateController` injects one
token, so there is nowhere for a second answer to live, and its spec reads the constructor's
parameter types and asserts exactly that. Production behaviour minus the network call, because
`resolve()` has no network call to remove. The management API beside it is Z.2's
([#195](https://github.com/NobuData/ouroboros/issues/195)) and is the next section.

```
POST /api/v1/routing/simulate   {taskKind, ctx} ─▶ the chain, the rules, the floor, and why
```

**`ctx` is closed at the three conditions a rule can ask about** — `effort`, `labels`,
`diffKind` — plus `repo`, which is carried and read by nothing until AB.5
([#211](https://github.com/NobuData/ouroboros/issues/211)). A fourth fact is a `422` naming it
rather than a value silently dropped: a client that invented a condition should not believe it
was honoured. `null` is refused too — an absent fact is *unknown* and has a documented path
through `context.ts`, and a `null` is a client saying something a context cannot mean.

**`fail_run` answers `200`.** Every provider down, a chain filtered to nothing, the floor
breached: the caller asked a well-formed question about a route that exists and is entitled to
the reason. The one `4xx` of its own is `404 route_not_found`, for the case with no chain to
explain. **Any member may simulate**, viewers included — looking changes nothing — and the
workspace is the session's, so there is no way to ask about somebody else's routes.

**What did not ship with it.** The estimator (#106) and WF-catalog (#145) amendments the ticket
also names are unbuilt because their consumers are: there is no estimator in `ouroboros-engine`
and no workflow module here, and each waits behind its own chain. They are consumers of this
contract, and the contract now exists.

**The engine performs no I/O and reads no clock.** `resolve()` takes six values — a route, its
hops, the workspace's aliases, its enabled rules, a health snapshot and a context — and returns
the answer synchronously. Health arrives from `ProviderHealthService.snapshots`, never from a
check performed here, which is why the whole acceptance matrix (rules × health × floor × local
policy × cost) is a table of inputs rather than a set of scenarios to stage. The rule is
asserted rather than promised: `resolve.spec.ts` reads the seven files the pure core is built
out of and fails on `fetch(`, `node:http`, `Date.now`, `new Date(` or `Math.random`, and on an
import of anything that could reach a database.

**Nothing is dropped silently.** Mockup 06 promises the loop *"degrades gracefully when a
provider stumbles — and never silently below the floor you set"*, and the word doing the work
is *silently*. Every hop is `kept` or `dropped` with a stable `code` and a human `explanation`;
every escalation rule that matched is listed with what it did **or why it did nothing**; the
floor records its decision even on the resolutions it never touched. The inspector and the
simulate panel render those sentences verbatim — there is no story assembly in the client, and
`explanations.ts` is the one place a sentence is composed.

| Dropped because                    | Code                  |
| ---------------------------------- | --------------------- |
| the alias is bound to no provider  | `alias_unbound`       |
| it sits deeper than the route floor| `below_floor`         |
| a `route_local` rule fired         | `rule_route_local`    |
| the route allows no local models   | `local_not_allowed`   |
| an operator paused the provider    | `provider_paused`     |
| a check found the provider unusable| `provider_error`      |

Policy is tested before health, deliberately: a hop the route's own configuration excludes is
not in play whatever a provider is doing, and an operator asking *why is hop 3 not being used*
should be told about the floor they set rather than about a latency that would not have
mattered.

**A floor breach is a refusal, never a shorter chain.** *The run may not proceed* and *the run
proceeds on the third fallback* are different outcomes, and quietly returning the survivors
would turn the first into the second. When every hop at or above `floor_hop_index` is
unusable, the resolution is `fail_run` carrying the reason — and the chain still lists every
hop, so the inspector can draw exactly what went. The floor is measured against the stored
`route_hops.position`, never against the resolved index, so an escalation rule that prepends a
primary cannot silently move a policy an operator set against the chain they saw.

**`use_alias` swaps or prepends; it never truncates.** V018 calls the action *"swap the primary
model for one task kind"*, and there are three cases: the alias is already the primary and only
its params move (the mockup's `(max thinking)`), the alias is elsewhere in the chain and moves
to the front, or the alias is not in the chain and is prepended. Substituting hop 1 would
quietly reduce the number of providers a run can survive the loss of. Rule params are merged
**over** the alias's own, because the rule is the more specific statement.

**A resolution is deterministic, byte for byte.** The same route, snapshot and context produce
the same object through `JSON.stringify` — every array is built in a fixed order and every
params object has sorted keys, which is not cosmetic when a consumer pins a shape.
`resolution_version` (`r1`) is that pin: adding a drop code is not a bump, because an
unrecognised code still arrives with a sentence and a `kept`/`dropped` decision; renaming a
field, removing one, or changing what one means is.

**Only one thing here is an error.** Every provider down, the floor breached, a chain filtered
to nothing — those are `fail_run` resolutions carrying an explanation, because the caller asked
a well-formed question about a route that exists. `route_not_found` is the single `404`, for
the one case with no chain to explain.

**There is no credential anywhere in the answer and nowhere to put one**, which is the
registry's rule inherited unchanged (decision **P3**): a resolution carries an address and a
model — everything an executor needs to choose a provider, and nothing it needs to authenticate
as one.

## Routing management

**The read/write surface behind mockup 06's matrix, inspector and rules card**
([#195](https://github.com/NobuData/ouroboros/issues/195)). The same module as the resolution
engine and a separate service, because both read V016's and V018's four tables and two mirrors
of one chain is two opinions about what an unbound alias is.

```
GET    /api/v1/routing                     8 kinds · chains · policies · rules · stats
GET    /api/v1/routing/aliases             the swap menu's list, unbound aliases included
PUT    /api/v1/routing/routes              Save routes — one batch, one revision
PUT    /api/v1/routing/routes/{taskKind}   a batch of one, same implementation
POST   /api/v1/routing/rules               + Add rule · display is derived, never sent
PATCH  /api/v1/routing/rules/{id}          the switch, the order, or the rule itself
DELETE /api/v1/routing/rules/{id}          204 · not the same thing as switching it off
```

`GET /routing/aliases` stays for the swap menus. The registry page reads
`GET /api/v1/registry/aliases` instead (CH.1, [#584](https://github.com/NobuData/ouroboros/issues/584)),
which carries the row itself — the switch, both documents, the note and everything that
references the alias — and every write to an alias lives there; see
[The alias lifecycle](#the-alias-lifecycle).

**The editing model is staged, and the API shape follows from it.** The page has a **Save
routes** button and a hint telling you to drag things around before you press it, so edits
accumulate client-side and commit as a batch. `PUT /routing/routes` is that press. The
single-route `PUT` is a batch of one — built in the controller and handed to the same service
method — so the two cannot come to disagree about validation, atomicity, or what gets recorded.

**Validate, then diff, then write — and the order is the atomicity criterion.** Everything that
can refuse a batch is decided *before the transaction opens*, so *a failure in one route does
not partially commit another* is not a rollback that has to work: it is a write that never
started. What the transaction then holds is only the chain rewrites, the policy updates, and
the revision row that must commit with them or not at all.

**The diff drives the write rather than describing it afterwards.** `management.diff.ts`
compares each route's stored state against the body once; a route with no entry has no
statement run against it, and a route with an entry is written *and* recorded from the same
object. That is what makes *"a `route_revisions` row whose diff reflects exactly what changed"*
structural instead of a second computation that could disagree with the first — and it settles
the no-op save: nothing changed, nothing written, `revisionId: null`.

```
V021  route_revisions {actor, created_at, diff}
      diff = {routes: [{task_kind, changes: {<column>: {from, to}}}]}
      CHECKed: ≥1 route, ≥1 change each, every change a from/to pair
```

Keys inside `changes` are **column names** and hops are named by **alias**, because a revision
is read by a person reconstructing a decision months later — a uuid is a lookup into a row that
may since have been repointed, which is exactly the interval they are asking about.
`routes.updated_by` says who wrote the state a route is *in*; this says how it got there, and
it is the feed the audit log ([#26](https://github.com/NobuData/ouroboros/issues/26)) reads.

**A chain is rewritten, not patched, and V016 wrote the transaction down for us.** Both rules
that hold a chain's numbering are `deferrable initially deferred`, so *delete the hops, insert
the new order* is legal inside one transaction with no `set constraints` ceremony. Positions
come from the array index, which is why the request carries no positions at all: a dense array
cannot produce a sparse chain.

**Two layers refuse a save, and neither is redundant.** The DTO refuses what is wrong with the
*request* — an empty chain, a blank note, a cap of zero, a floor below 1 — and answers
`validation_failed` keyed by field path. The service refuses what is wrong with the request *in
this workspace* — an unknown task kind, a kind with no route, the same kind twice, an alias
this workspace has never bound, a floor deeper than the chain that arrived with it — and
answers `route_save_invalid` keyed by **task kind**, so the UI marks exactly the rows that
failed.

**A rule's grammar is asked of the database, not reimplemented.** V018 exposed
`escalation_rule_when_valid()` and `escalation_rule_then_valid()` for exactly this, and said
so; a TypeScript copy would agree on the day it was written and drift the first time either was
widened. The names a rule carries are then pre-flighted against this workspace's kinds and
aliases — a pre-flight over the deferred trigger V018 attaches to three tables — and the
trigger's own refusal is recognised, so the race the pre-flight cannot close answers the same
`422` rather than a `500`.

**`display` cannot be written, in three places, and none of them is redundant.** The DTO
declares no such property and the pipe is `forbidNonWhitelisted`; the insert type is
`ColumnType<string, never, never>`, so naming it does not compile; and the column is `generated
always … stored`, so PostgreSQL would refuse it anyway. Decision **M5** end to end: the
sentence the card renders cannot drift from what the rule does, because there is only one of
them.

**Owners and admins write; every member reads.** The two `GET`s carry no `@Roles()` — a viewer
is a role that exists to be able to look at which model answers which kind of work — and every
write carries `@Roles(...ADMINISTRATORS)`. The button being hidden is the least reliable part
of any authorization scheme; this is the part that is not, and the controller spec counts the
handlers rather than listing them, so a write added later without a gate fails a test.

**`stats` is present and null.** The matrix's `$/run avg` and `p50 latency` are Z.5's
([#198](https://github.com/NobuData/ouroboros/issues/198)) to compute from `token_usage`, which
V020 gave a `task_kind` and a `latency_ms` for. Publishing the field as null now is decision
**M7** rather than a placeholder: a workspace that has run nothing has not spent `$0.00` per
run, it has spent nothing anybody can average — so AA.2 renders the em-dash today and the real
figure later, with no contract change.

### The routing regression suite

**Insurance against the bug that does not throw**
([#199](https://github.com/NobuData/ouroboros/issues/199)). A routing defect does not raise —
it returns a *different valid-looking chain*, and every run afterwards goes somewhere slightly
wrong until a bill or a latency graph gives it away. Four suites in `src/modules/routing/`
exist for that failure mode specifically, over the shared bench in `workspace.fixture.ts`:

| Suite                              | What it holds                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `matrix.integration-spec.ts`       | 480 cells of rules × health × floor × local × cost, twice each, asserted as invariants |
| `persistence.integration-spec.ts`  | `route_hops_alias_fk`, the deferred chain rewrite, revision diffs, the derived sentence |
| `isolation.integration-spec.ts`    | every routing endpoint the router serves, against a second workspace's rows            |
| `honesty.integration-spec.ts`      | priced, priced-at-nothing and never-priced, still three states in one payload           |

**The matrix asserts promises, not expected chains.** An expected-value table is written by
somebody who already knows which cells are interesting, which is exactly what a silent routing
bug is not. So the cross product is resolved once and the assertions are mockup 06's headline
claims restated as properties every cell must satisfy — the floor is never crossed by a kept
hop, a breach refuses rather than degrades, a route with local off never runs local, an
unusable provider is never kept and an **unchecked** one is never dropped, identical inputs
produce identical bytes. A failure names its cell (`rules=none health=cloud-down floor=2
local=on cost=250`), so a regression reports the one combination that broke.

**The isolation census is read out of the running application.** *Covers every routing
endpoint* is a claim that decays the moment somebody adds an endpoint, so the list is not
written down: `SwaggerModule.createDocument` is asked what this Nest routes under
`/api/v1/routing`, and the probe table is held to that set in both directions. Adding an
endpoint with no probe fails the census by name — checked by doing it. `routing/providers` is
in the census although `provider-health` serves it, because it is a routing endpoint from
every angle a client can see.

**And a resolution contacts nothing.** The bench's two local connections point at loopback
stubs that answer `200` to anything and record what they were asked; after 960 resolutions
across every health state they have received nothing at all. `provider-health.integration-spec.ts`
proves the *sweep* issues only listings — this is the same passive-first promise from routing's
side, and both suites now share one `provider.stub.fixture.ts`.

**Four mutations were run to check the suites are load-bearing**, rather than trusting that a
test mentioning a floor tests one: neutering the floor comparison in `resolve.ts`; re-declaring
`route_hops_alias_fk` `on delete cascade`; re-declaring it without its `organization_id` half;
and setting both em-dash paths in `stats.ts` to `0`. Each turns the relevant suite red, and the
first three name the cell or the constraint.

## Provider adapters

**Adding a model provider is one directory and one line**
([#216](https://github.com/NobuData/ouroboros/issues/216), roadmap decision **P1**).
`src/modules/providers/` holds the `ModelProviderAdapter` SPI, the registry that keys it,
and the conformance kit a new adapter has to pass.
[`../docs/MODEL_PROVIDERS.md`](../docs/MODEL_PROVIDERS.md) is the walkthrough; this is the
summary.

```
core services ──imports──▶ ModelProviderAdapter ◀──implements── adapters/*
 (AD.2 · Z.3 · discovery)     ▲   anthropic · openai_compatible · ollama · copilot · cursor
                              └── ModelProviderRegistry.get(kind)
```

Five kinds ship in the MVP and mockup 07's dashed card promises *"OpenAI, Google, Bedrock,
or any OpenAI-compatible endpoint"*. Written as a `switch (kind)` across REST, the add-form
and the card component, each new provider is a three-file change in three modules. The
ticket-source SPI ([#139](https://github.com/NobuData/ouroboros/issues/139),
[#142](https://github.com/NobuData/ouroboros/issues/142)) set the pattern; this applies it
to providers.

| Member | What it is on the page |
| ------------------------- | ------------------------------------------------------ |
| `kind` | the registry key — one of V015's six |
| `configSchema()` | the add-form, and the card's fields |
| `capabilities()` | which affordances the card shows at all |
| `validate(config, secret)` | the **Test connection** button |
| `discoverModels(conn)` | the **Models available** chips |
| `paramSchema(modelId)` | mockup 21's alias-inspector fields |
| `pullModel?(conn, id)` | the Ollama pull-list's **Pull latest** |

**Five error classes, five pills, 1:1.** `auth`, `network`, `upstream`, `rate_limit`,
`config` — every adapter fails in these words and no others, because the card's pill, the
card foot's test note and Z.3's health snapshots all read them. `provider.errors.spec.ts`
asserts the mapping is injective rather than trusting the table in
[`../docs/MODEL_PROVIDERS.md`](../docs/MODEL_PROVIDERS.md#the-error-taxonomy) to stay true.
Every failure still coarsens to `provider_connections.status = 'error'`, deliberately: V015
has no status meaning *working, but throttled*, and the alternative would keep routing to a
provider that is currently refusing.

**`pullModel` is gated by the compiler, not by a check.** `ModelProviderAdapter` has no
such member; an adapter that pulls implements `PullCapableAdapter`, and the only ways in are
`supportsPull(adapter)` and `registry.pullCapable(kind)`. So this does not compile:

```ts
registry.get("copilot").pullModel(conn, id);   // Property 'pullModel' does not exist
```

`provider.adapter.spec.ts` holds that with a `@ts-expect-error`, which fails the moment the
interface grows an optional member. `invocation` is declared and reserved for AF.2
([#235](https://github.com/NobuData/ouroboros/issues/235)), which extends the interface the
way `PullCapableAdapter` already demonstrates rather than reshaping it.

**Config schemas render mockup 07's five cards with no branch anywhere.** `configSchema()`
answers a narrow JSON Schema subset — one flat object of string fields — and
`provider.forms.ts` turns it into form fields. That module contains no provider kind at all,
which `provider.forms.spec.ts` checks by reading its source with the comments stripped. The
trick is one reserved name: an address field is always `baseUrl`, and *Host* against *Base
URL* is its `title`.

**The conformance kit gates every adapter, and it has been watched failing.** Each rule is a
function returning sentences, so `conformance.fixture.spec.ts` can run it against adapters
that are wrong on purpose — a mutable schema, a detail that quotes the credential, a
fabricated latency, a pull stream that just stops. Every adapter must record a fixture for
**all five** error classes; there is no escape hatch, because all five are arrangeable for
anything that talks HTTP.

**The boundary is a build failure.** `.dependency-cruiser.cjs`, run by `yarn lint`:

```bash
yarn lint      # eslint, then depcruise src
```

| Rule | Refuses |
| ----------------------------------- | -------------------------------------------------- |
| `no-provider-sdk-outside-adapters` | a provider SDK imported from anywhere but `adapters/` |
| `core-imports-the-spi-only` | any file but `providers.module.ts` (and tests) importing an adapter |
| `no-circular` | a dependency cycle anywhere in `src/` |

`boundary.spec.ts` builds a tree containing each violation and asserts the real
configuration reports it — a rule whose pattern has quietly stopped matching looks identical
to a codebase with no violations.

**`REGISTERED_ADAPTERS` holds five adapters** as of AC.5
([#220](https://github.com/NobuData/ouroboros/issues/220)), so every kind mockup 07 draws
resolves and only `custom` is a `501 provider_kind_unsupported` — which is the accurate thing
for this build to say about it: V015 accepts the row, and nothing here knows what a custom
provider would be. Each of the five is one line in that list and nothing else in the service
learned any of their names. `adapters/fake.adapter.fixture.ts` is the in-memory adapter that
powers core tests without touching a network, and it is the worked example the walkthrough
reads.

### The Anthropic adapter

**The first real one** ([#217](https://github.com/NobuData/ouroboros/issues/217)), and the
bar the other four are measured against. `adapters/anthropic.adapter.ts` is mockup 07's `AN`
card as code: a masked key row and nothing else, a **Test connection** that is a one-row
models listing, and **Models available** chips from `/v1/models`.

```
configSchema   ─▶ { apiKey: secret }                 no Base URL — the endpoint is fixed
validate(key)  ─▶ GET /v1/models?limit=1 · 200       →  ✓ 200 · 38ms
                                       401/403       →  auth        · key rejected
                                       429           →  rate_limit  · rate limited
                                       5xx           →  upstream    · degraded upstream
                                       socket        →  network     · unreachable
                                       no key at all →  config      · needs configuration
discoverModels ─▶ /v1/models, paged   →  claude-fable-5 · claude-opus-5 · claude-sonnet-5 · …
                  response headers    →  `priority tier`, only on a real signal
```

**The `priority tier` pill renders only on a real entitlement signal** — decision **P8**.
Anthropic sends `anthropic-priority-…-limit` headers only to an organization that has that
capacity, so the adapter reads them from the listing it already had to make and reports
`NormalizedModel.tier` as `priority` when one carries a positive allowance, `null`
otherwise. `null` reaches `provider_models.meta.tier` as nothing, and the card draws no
pill. There is no fallback and no inference: a person who cannot tell an invented pill from
an earned one has to distrust all of them.

**It logs nothing at all**, which is the only version of *the credential is never logged*
that survives somebody adding a debug line in a hurry — `anthropic.adapter.spec.ts` reads
the file's own source and fails if a logger appears in it. Every refusal's body is cancelled
unread, so a vendor error object quoting request headers never reaches a `detail`.

**Its fixtures are recorded** — `adapters/anthropic.recordings.fixture.ts` — so the
conformance kit and the unit suite both run in `yarn test` without a key or a socket. The
stand-in `fetch` that serves them is `adapters/http.recordings.fixture.ts`, shared by every
HTTP adapter.

### The OpenAI-compatible adapter, and the SSRF policy

**The one that makes *"or any OpenAI-compatible endpoint"* true**
([#218](https://github.com/NobuData/ouroboros/issues/218)) — vLLM, LM Studio, llama.cpp's
server, TGI, and anything else speaking that wire format.
`adapters/openai-compatible.adapter.ts` is mockup 07's `VL` card: a **Base URL**, an
*optional* key row, and the capability line under the card's name.

```
configSchema   ─▶ { baseUrl, apiKey?, capabilityNote? }   address first, key optional
validate       ─▶ GET {base}/v1/models · 200          →  ✓ 200 · 12ms
                                        401           →  auth       · key rejected
                                        3xx           →  config     · redirect not followed
                                        5xx           →  upstream   · degraded upstream
                                        socket        →  network    · 10.0.4.20:8000 unreachable
discoverModels ─▶ the same call                       →  local/llama-4-maverick · local/deepseek-v3.2
```

**Every other adapter talks to a fixed host; this one fetches an address somebody typed.**
That is the shape of an SSRF vulnerability, and the reflexive mitigation — blocking private
ranges — is exactly wrong here, because the legitimate use case *is*
`http://10.0.4.20:8000/v1`. So the policy is stated rather than inherited. It lives in
`providers/provider.address.ts`, the Ollama adapter below shares it, and it is four rules:

| Rule | What it stops |
|---|---|
| Scheme allow-list — `http`, `https` | `file:`, `gopher:`, `ftp:`, and the rest |
| `redirect: "manual"` on every request | An allowed address becoming a disallowed one after the check passed |
| A one-mebibyte response cap, counted as bytes arrive | A stranger's endpoint streaming this process out of memory |
| No userinfo in the address | `http://key:secret@host/v1` writing a credential into `provider_connections.config` |

**RFC-1918 and loopback are deliberately allowed**, with no branch anywhere that inspects an
address range — `provider.address.spec.ts` asserts the allow explicitly, so the way it breaks
is a red test rather than every self-hosted card quietly going dark.
[`docs/SECURITY_MODEL.md` §6.1](../docs/SECURITY_MODEL.md#61-ssrf-private-ranges-are-deliberately-allowed)
says what remains and why the boundary actually defended is *who may configure a connection*.

**The key is genuinely optional** — a keyless endpoint gets no `Authorization` header at all,
rather than an empty bearer a server would answer `401` to. **The chips carry `local/` and the
ids do not**, because `model_prices.match_model` joins on the server's own spelling. And the
conformance kit runs **twice**, against a vLLM capture and a bare generic one, because a kit
green against one vendor proves the claim about one vendor.

### The Ollama adapter, and server-side model pulls

**The zero-cost lane, and the only card that can change what models exist**
([#219](https://github.com/NobuData/ouroboros/issues/219)).
`adapters/ollama.adapter.ts` is mockup 07's `OL` card: a **Host**, no credential anywhere,
and a detected-models list with real sizes and a **Pull latest** on every row.

```
configSchema   ─▶ { baseUrl, capabilityNote? }        a Host, and no key row at all
validate       ─▶ GET  {host}/api/version · 200   →  ✓ 200 · 4ms
                                          socket  →  network · ken-station.local:11434 unreachable
discoverModels ─▶ GET  {host}/api/tags            →  qwen3-coder:32b · 19 GB
                                                     llama4:scout    · 63 GB
                                                     phi4:14b        · 9.1 GB
pullModel      ─▶ POST {host}/api/pull  (NDJSON)  →  pulling manifest → downloading → success
```

**It declares no credential field at all** — not an optional one. A local daemon
authenticates nobody, and a blank row somebody has to leave blank is a question the product
should not be asking. It shares the address policy above verbatim; `401` and `429` are still
classified, because putting a daemon behind a reverse proxy with basic auth is the ordinary
way an operator exposes one, and that proxy is what answers them.

**Sizes are the one field no cloud adapter can fill in.** `/api/tags` publishes an on-disk
size per model and it reaches `provider_models.size_bytes` in bytes, unchanged — `19 GB` is a
rendering decision and it belongs to AE.4
([#230](https://github.com/NobuData/ouroboros/issues/230)). There is no context length and no
tier: `/api/tags` publishes neither, and decision **P8** says report what was said or say
nothing.

**A pull is bounded by silence rather than by elapsed time.** Every other call here carries a
ten-second deadline; a pull of `llama4:scout` moves 63 GB and is *supposed* to take twenty
minutes, so each read of the stream gets its own deadline instead and the abort lives in a
`finally` — a consumer that stops iterating closes the socket rather than leaving the transfer
running with nobody reading it.

**Progress is tracked by the process, not by the browser.** `providers/provider.pulls.ts` is
`ModelPullTracker`: one shared instance, one active pull per connection, a queued state for the
second, and a record any later request can read.

```ts
tracker.request({ connectionId, modelId, open });   // → { state: "running", percent: null }
tracker.find(connectionId, modelId);                // → { state: "running", percent: 61 }
```

That split is what makes *reload the page mid-pull and it is still at 61%* a property of the
design. It takes a thunk — `() => registry.pullCapable(kind).pullModel(connection, modelId)` —
rather than an adapter and a connection, so **no credential reaches a component that lives for
minutes**. Records are in memory and last fifteen minutes after they finish; a process
restart loses them, and the daemon carries on pulling regardless, which the next discovery
finds. The HTTP route AE.4 polls is AD.2's to add on top: this module still declares no
controller.

### The Copilot adapter — entitlements, and the degraded state

**The org-billed lane, and the only card mockup 07 draws in a state that is not healthy**
([#220](https://github.com/NobuData/ouroboros/issues/220)).
`adapters/copilot.adapter.ts` is the `GH` card: a masked `ghu_…` token row, the capability line
*billed through GitHub org acme-robotics*, one chip, and the `degraded upstream` pill.

```
configSchema   ─▶ { token, organization?, capabilityNote? }
validate       ─▶ GET /user · 200 ─▶ GET /orgs/{org}/copilot/billing  →  "200 · 4 seats"
                                 │                    no breakdown    →  "200"
                                 ├▶ 401              →  auth       · key rejected (401)
                                 ├▶ 503              →  upstream   · △ 503 upstream · retrying
                                 └▶ answered, slowly →  upstream   · △ slow upstream (6000 ms) …
discoverModels ─▶ a fixed catalog, no request at all  →  copilot/gpt-5-codex
```

**A fixed catalog is a real answer, not a stub.** Neither this provider nor Cursor publishes a
models-list endpoint worth discovering against, so their models are *declared* by the adapter
— with a source for every field — and upserted into `provider_models` exactly as a discovered
model is. The table cannot tell the difference, which is what keeps the card, mockup 21's
registry and Y.1's alias validation reading one table. `capabilities().discovery` is `false`
because *refreshing* means nothing over a constant, not because the member is missing.

**Seats render from real entitlement data or not at all** — decision **P8**. The count is read
from `seat_breakdown.total`, and it appears only when an organization is configured, the token
may read that organization's billing, and the response really carries one. It travels in
`validate`'s `detail`, which is what `capabilities().entitlements` promises;
`providers/provider.entitlements.ts` owns the spelling at **both** ends, so AE.6
([#232](https://github.com/NobuData/ouroboros/issues/232)) reads `4` back with `seatsIn(detail)`
rather than with a regular expression it invented — it cannot import the adapter, and the lint
boundary is what says so.

**The entitlement lookup cannot fail a validation.** A `403` is a token without
`manage_billing:copilot`, a `404` an org it cannot see, a `500` GitHub having a moment: all of
them mean *no seat count*, and none of them makes a good token bad.

**The degraded state is earned by a response and drawn by the taxonomy.** A `5xx` is `upstream`
through the same `classifyHttpStatus` every adapter calls, and an answer slower than five
seconds takes the same road — it arrived, and a token check that slow describes a provider in
trouble. The `△ 503 upstream · retrying` note is `validationNote()`, which appends the
`· retrying` from `PROVIDER_ERROR_RETRYABLE`; nothing on that path names this provider.

**The auto-retry is bounded twice, and the bounds interact on purpose.** At most two attempts,
*and* the whole call must fit a fifteen-second budget. So a failure that came back fast leaves
room for a second attempt — the transient `503` a load balancer answers while a node rotates,
which is the case a retry can actually convert — and one that came back slowly has already
spent it. Unbounded retry against a struggling upstream is how a status indicator becomes a
denial-of-service contribution.

**The organization is interpolated into a URL, so it is checked before it gets there.** The
form's pattern admits a login or a blank; the adapter re-tests the strict one, because a schema
annotation is a rendering hint and this is a path segment. A value that is not a login is a
`config` failure with an actionable sentence, not a silently-skipped lookup.

### The Cursor adapter

**The plainest of the five, and that is why it is worth having**
([#220](https://github.com/NobuData/ouroboros/issues/220)).
`adapters/cursor.adapter.ts` is the `CU` card: a masked key row, one chip, one status check.

```
configSchema   ─▶ { apiKey, capabilityNote? }
validate       ─▶ GET https://api.cursor.com/v0/me · 200  →  ✓ 200 · 51ms
                                                    401   →  auth · key rejected (401)
discoverModels ─▶ a fixed catalog, no request at all      →  cursor/composer-2
```

It is the shape the SPI was drawn around: one credential, one check, one answer. Everything the
other four have that this does not — an address policy, a pull stream, an entitlement lookup, a
bounded retry — is a *provider's* complexity rather than the framework's. The key goes out as
HTTP Basic with an empty password, which is what Cursor's Admin API documents (`curl -u KEY:`),
and `capabilities().entitlements` is `false` because `/v0/me` says nothing about a seat or an
allowance — which is what keeps the Copilot card's `· 4 seats` worth reading.

## The credential lifecycle

**Add, reveal, rotate, enable, delete — the key row's affordances, made safe by
construction** ([#223](https://github.com/NobuData/ouroboros/issues/223), roadmap decision
**P4**). `src/modules/provider-connections/` is `/api/v1/providers`: the surface mockup 07's
cards are drawn from, over V015's `provider_connections`, and the surface `provider-health/`
deliberately left free by naming its own route `routing/providers`.

```
POST   /api/v1/providers            schema ─▶ live validate ─▶ seal ─▶ store   ✗ = nothing stored
GET    /api/v1/providers            ••••Xq4A, computed server-side · every member
GET    /api/v1/providers/{id}       the same, for one
POST   /api/v1/providers/{id}/reveal   rate limit ─▶ step-up ─▶ open ─▶ audit · no-store
POST   /api/v1/providers/{id}/rotate   validate NEW ─▶ one conditional UPDATE ─▶ old retired
PATCH  /api/v1/providers/{id}       switch · cap · note · address (validated like an add)
DELETE /api/v1/providers/{id}       409 while aliases resolve on it, naming them
```

**Every acceptance criterion is a claim about *order*, so the order is the design.** `add`
asks the adapter before it seals and before it inserts — so *a bad key is never stored
silently* is a property of the control flow rather than of a rollback, and there is no row to
clean up on failure because there was never a row. `rotate` validates the new credential and
only then issues **one conditional `UPDATE`**: a refusal leaves the old key live and working,
and a success has no window in which neither does. `reveal` counts the attempt **before** it
checks the step-up, which is the one ordering here that is a security property rather than a
preference — a limiter behind the step-up would leave the password comparison unlimited.

**Masking is server-side, and computed from bytes.** A list returns `••••Xq4A` — four bullets
and the credential's last four characters — and the full value is simply not in the payload.
Returning the key and letting a page draw bullets would put it in the browser's memory, in the
network tab and in every error report that page ever sends. `masking.ts` decodes only the last
sixteen bytes of the buffer the vault hands over, so the plaintext never becomes an immutable
string on the read path, and the visible half is what every vendor console already shows. The
contract test lives twice — over the built payloads and over the bytes that crossed a socket —
and it is demonstrated to be *capable* of failing by being pointed at the one payload that does
carry a credential.

**Reveal costs a step-up, and there are two methods because BetterAuth gives this build two.**
A session **created** inside a five-minute window is a re-authentication in itself — the only
method a GitHub-only account has, and the reason `SessionRecord` reads `createdAt` and never
`updatedAt`, which slides on every renewal. Otherwise a **password** confirmed through
`auth.api.verifyPassword`, which works in production too: `emailAndPassword.enabled` gates the
sign-in *routes*, and verification reads the credential account directly. A confirmation is
remembered for the window, so confirming once and revealing two keys is one prompt. **A wrong
password answers exactly as an absent one does** — anything else would make this a password
oracle for whoever holds a stolen session. Without either, the answer is `401 step_up_required`
carrying the methods and the window, which is a challenge a client can act on rather than a
wall.

**Rate-limited per user *and* per connection**, because the two catch different things: one
account walking the whole list, and several accounts converging on one credential. Every
attempt counts, the ones that failed the step-up included. Both the limiter and the step-up
registry are **in-memory singletons**, and what that costs is stated rather than discovered — a
second replica has its own counters, so ten becomes twenty across two processes, and a person
behind a round-robin balancer may be asked to confirm again. The second is a re-prompt, which
is the safe direction to fail in.

**Members read; `owner` and `admin` write — and reveal counts as a write.** It changes nothing
and it is the one operation that hands back a live credential, so filing it with the reads
because of its side effects would be filing it by the wrong property. The workspace is the
session's throughout: there is no `{orgId}` in any of these paths, and another workspace's
connection is a `404` rather than a `403`, because a `403` confirms that an identifier names
something real.

**The delete guard is Y.1's foreign key, thrown at last.** `model_aliases_provider_fk` is what
makes the delete impossible; `registry.errors.ts`'s `providerConnectionInUse` — written under
[#189](https://github.com/NobuData/ouroboros/issues/189) *for* this ticket and left with no
caller — is what turns *violates foreign key constraint* into a sentence naming the aliases to
repoint first. Both of its directions are used: the pre-flight that can name them, and the
recogniser for the race a pre-flight cannot close.

**One gap is refused rather than papered over.** `provider_connections` keeps a connection's
settings in *columns* — `base_url` and `capability_note`, which is why `provider.config.ts`
reserves those two field names — and has no general column for anything else. Copilot's schema
declares one field that is neither: an optional billing `organization`. Dropping it would store
a connection that quietly disagrees with what somebody typed; adding a column is a migration,
and this ticket's scope is `ouroboros-rest`. So a submitted setting with nowhere to go is a
designed **`501 provider_config_not_storable`** naming the field — the same shape
`provider_kind_unsupported` has, and for the same reason: *this build cannot* is a different
fact from *you asked wrongly*. Copilot connects without one, which its own schema calls the
ordinary case.

**Every operation writes exactly one audit event, and a refusal writes one too** — see
[The credential audit trail](#the-credential-audit-trail). `connection.audit.ts` is where each
record is assembled, at the one point the operation is known to have happened or to have been
refused; a reveal records *how* the step-up was satisfied, which is the difference between
somebody with this session and somebody who proved they are this person.

## The credential audit trail

**Who did what to which credential, from where, and when — append-only**
([#225](https://github.com/NobuData/ouroboros/issues/225), roadmap decision **P5**).
`src/modules/audit/` is the one writer of `ouroboros.audit_events` and
`GET /api/v1/providers/audit` is the one reader.

```
add · reveal · rotate · enable · disable · cap_changed · updated · delete · test
                                        └▶ exactly one row, success or refusal
lease grant (#224)                      └▶ credential.lease_granted, and no actor
GET /api/v1/providers/audit   org-scoped · filterable · owner/admin · newest first
```

**The table is #26's, landed early.** Scaffolding
[#26](https://github.com/NobuData/ouroboros/issues/26) specifies `audit_events` for the
platform's audit log and is v2; decision **P5** puts credential auditing in v1, because a page
that reveals and rotates keys while keeping no record of who did it fails its own stated
security posture. So `ouroboros-db`'s `V022` is that issue's shape column for column, plus the
`ip` it did not name, and #26 will inherit the table rather than create a second one.

**A refusal is an event, under the same action name.** AD.2 recorded successes only; this
issue's own criterion covers the failure paths, so `detail.outcome` and `detail.reason` are
what tell a refused rotation from a completed one. That is the more useful trail — *nobody
rotated this key* and *three people tried and the provider refused all three* are very
different facts — and no refusal introduces a name of its own.

**No event ever contains secret material**, and the check is three checks rather than one
keyword sweep: no value shaped like a credential, no *field* named as a credential field, and
every payload flat and scalar so the first two are exhaustive. The middle one is over the
payload's keys rather than its rendered text, which is where `step_up` and `password` stop
being the same string — a grep that fired on the step-up method would be weakened within a
week and then be worth nothing. `audit.secrecy.spec.ts` runs all three over the rows a full
lifecycle actually writes.

**Append-only is enforced twice.** By grant, because `ouroboros_app` holds `select` and
`insert` and nothing else; and by trigger, because the development stack connects as the
database's owner and a superuser bypasses every grant in the catalogue. The one update the
table permits is the actor foreign key's own `on delete set null` — *what happened cannot be
rewritten; who did it can be forgotten*.

**`ip` is what this service can honestly know**, which is the peer address of the socket it
was reached on. No forwarded header is trusted: a header a client writes is a header a client
can choose, and a trail that can be made to lie is worse than one whose address is less
specific. Behind `ouroboros-ui`'s server-side client that means a browser-driven event carries
the UI's address; making a forwarded header trustworthy needs a configured trusted-proxy list,
which belongs to the deployment ticket that adds it. See `audit/audit.context.ts`.

## BetterAuth

**The library is installed, configured, mounted, and doing the work.** `/api/auth/*`
answers ([#700](https://github.com/NobuData/ouroboros/issues/700),
[#701](https://github.com/NobuData/ouroboros/issues/701)); GitHub signs people in
([#702](https://github.com/NobuData/ouroboros/issues/702)); a session is a row, so signing
out revokes ([#703](https://github.com/NobuData/ouroboros/issues/703)); and tenancy —
organizations, membership, roles, and the active-organization pointer — is the organization
plugin ([#704](https://github.com/NobuData/ouroboros/issues/704), see
[Tenancy](#tenancy-the-organization-plugin)). What is still missing is a way in **without
github.com**, which is [#705](https://github.com/NobuData/ouroboros/issues/705).

[`src/auth/`](src/auth) is ten files, and the split is about *who can load what*:

| File                      | What it is                                                             |
| ------------------------- | ---------------------------------------------------------------------- |
| `auth.options.ts`         | the options object — every decision, and no dependency: it imports the library's *types* only |
| `auth.factory.ts`         | `createAuth(dependencies)` — the one place `better-auth` is a value rather than a type |
| `auth.config.ts`          | a standalone instance built from the environment, for `@better-auth/cli` |
| `auth.module.ts`          | the Nest wiring — the one file here that imports `@nestjs/*`            |
| `auth.routes.ts`          | the [route map](#the-route-map), and the paths the global prefix excludes |
| `github.provider.ts`      | the GitHub OAuth application, and the account-linking policy behind it   |
| `session.options.ts`      | how long a session lasts, and what the cookie cache costs                |
| `organization.roles.ts`   | who may do what inside an organization — including the custom `viewer`  |
| `organization.plugin.ts`  | the [organization plugin's](#tenancy-the-organization-plugin) options    |
| `active.organization.ts`  | where a session starts out acting, and the personal organization it starts in |

Two constraints shape the first three. The library is **ES-module-only** and this service
compiles to CommonJS, because Nest's dependency injection needs the decorator metadata that
setting emits; Node 24 bridges the two with `require(esm)`, and Jest's CommonJS runtime
does not — so the module that names `better-auth` as a value is kept to a single function,
and the suites substitute it (see [Testing the mount](#testing-the-mount)). And the
configuration has to be loadable **with no Nest process at all**, because that is how
[#706](https://github.com/NobuData/ouroboros/issues/706) generates the schema — which is
why `auth.module.ts` is a separate file rather than a section of `auth.config.ts`: the CLI
must never reach an injector.

`organization.roles.ts` is the **one deliberate exception** to the first rule, added by
[#704](https://github.com/NobuData/ouroboros/issues/704). It imports
`better-auth/plugins/access` and `better-auth/plugins/organization/access` as values, and
`jest.config.mjs` converts those two rather than replacing them: they are a few dozen lines
whose only dependency is an error class, and that issue's acceptance criterion is that the
custom `viewer` role is **asserted, not assumed** — which a stand-in `createAccessControl`
could not do, since it would only prove the stand-in returns what it was given. The plugin
proper is a different matter: `organization()` reaches `better-auth/api` and pulls in the
whole library, so it is called in `auth.factory.ts` alone.

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

…and, since [#704](https://github.com/NobuData/ouroboros/issues/704), the organization
plugin's — mockup 01 Step 2 and mockup 17, as routes:

| Route                                          | What it is for                                                  |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `GET  /api/auth/organization/list`             | the caller's organizations — **without** the role held in each   |
| `GET  /api/auth/organization/get-active-member-role` | the role, for one organization — the call `list` does not answer |
| `POST /api/auth/organization/create`           | make one; the caller becomes its `owner`                         |
| `POST /api/auth/organization/set-active`       | **choose where the loop runs** — writes `session."activeOrganizationId"` |
| `GET  /api/auth/organization/get-full-organization` | one organization with its members and pending invitations   |
| `POST /api/auth/organization/invite-member`    | write an `invitation` row — **no email**; that is [#724](https://github.com/NobuData/ouroboros/issues/724) |
| `POST /api/auth/organization/update-member-role` | change what somebody may do                                    |

The same table is [`src/auth/auth.routes.ts`](src/auth/auth.routes.ts), as data, because
[#711](https://github.com/NobuData/ouroboros/issues/711) publishes these paths in
`openapi.yaml` and `ouroboros-ui`'s BetterAuth client calls them. `src/openapi/openapi.spec.ts`
holds the document and that map to each other, which is what keeps the published surface
honest: these routes are invisible to Nest's route table, so the map is the only thing the
contract can be compared with. It is **not the whole of what the plugin serves** — leaving,
rejecting an invitation, deleting an organization and a dozen more are mounted too — only the
ones the product uses today.

`GET /api/auth/ok` is not a health probe. It says nothing about this service's
dependencies; [`/health/ready`](#health-and-readiness) stays the only readiness there is.

### The two-client rule

**A caller uses a different client for each family, and the boundary is the path.**

| Family | Paths | Called through |
|---|---|---|
| Auth | `/api/auth/*` — the two tables above | **BetterAuth's own client** (`createAuthClient`) |
| Everything else | `/api/v1/*` | **The client generated from `openapi.yaml`** ([#43](https://github.com/NobuData/ouroboros/issues/43)) |

The auth family is **excluded from code generation**. The library serves those routes itself
and ships a typed client that already knows their bodies, their cookies and their error
codes, so generating a second, worse copy of it would be work spent on drift. They are
described in `openapi.yaml` anyway — tags `identity` and `organizations` — because a client
author has to be able to read them.

**Who is signed in is three calls, and there is no fourth**: `get-session` (the person),
`organization/list` (the workspaces), `organization/get-active-member-role` (what they hold
in one). `GET /api/v1/auth/me` answered all three at once until #711 deleted it — two routes
answering the same question are two answers that can disagree, and the deleted one was
answering from `tenant_members` and `tenants`, which
`V006__tenancy_extensions.sql` had already dropped. **Do not add another.** The one part of
its answer with no BetterAuth equivalent — *your organisation is already on Ouroboros* — is
[#712](https://github.com/NobuData/ouroboros/issues/712)'s `POST /api/v1/auth/discover`,
which belongs in the versioned family because it reads this service's own tenant domains.
It is shipped: see [Domain discovery](#domain-discovery).

Two error shapes come with the split, and it is worth knowing before writing a client: the
`/api/v1` routes answer `{code, message, details}` from one filter, and the auth routes
answer BetterAuth's `{message, code}` with the library's screaming-case codes.

### Tenancy: the organization plugin

Roadmap decision **A5**: organizations, membership, roles and the pointer saying which
organization a request is acting in all come from BetterAuth's organization plugin, rather
than from the `tenants`/`tenant_members` tables
[#20](https://github.com/NobuData/ouroboros/issues/20) and
[#21](https://github.com/NobuData/ouroboros/issues/21) built.
[#708](https://github.com/NobuData/ouroboros/issues/708) migrates those rows across and
drops them; `V005` ([#707](https://github.com/NobuData/ouroboros/issues/707)) is the schema
underneath.

**Four roles, and one of them is ours.** The plugin ships `owner`, `admin` and `member`;
`viewer` is defined in [`organization.roles.ts`](src/auth/organization.roles.ts) as a custom
access-control role holding **no permission over any resource**. That word is not new — the
`tenant_members.role` check has allowed it since #21, and mockup 17 lists a Viewer beside
the other three — so defining it here is what makes #708 a rename rather than a re-think.
`V005` deliberately leaves `member.role` un-CHECK-constrained, which puts the vocabulary
here, where it is decided:

```console
$ npx jest src/auth/organization.roles.spec.ts
 ✓ is refused permission to add a member
 ✓ is stricter than the plugin's own member role, which may read role definitions
 ✓ lets only an owner delete the organization
```

**The tenant is server state.** `session."activeOrganizationId"` is written by
`setActiveOrganization` and by the sign-in hook below, and by nothing a client can send —
which is the difference between this and #32's `X-Ouro-Tenant` header, demoted to an
override by [#713](https://github.com/NobuData/ouroboros/issues/713).

**A personal organization, made at sign-in.**
[`active.organization.ts`](src/auth/active.organization.ts) hangs off
`databaseHooks.session.create.before`: it looks up the caller's memberships, and if they
have none it makes them an organization of their own — named after them, flagged
`{"personal": true}` in `metadata`, which is the `personal` pill mockup 01 Step 2 renders.
The new session is then stamped with it, as part of the `insert` rather than an `update`
after the fact.

Hanging it off **session** creation rather than **user** creation is the one decision worth
knowing about. `V004`'s back-fill already wrote a `"user"` row for everybody who used
Ouroboros before BetterAuth, so a hook on user creation would never fire for any of them —
they would sign in, find no organization, and need a second one-shot back-fill to fix.
Evaluated at every sign-in, the rule is self-healing and costs one indexed lookup for
anybody who already belongs somewhere.

`organization.metadata` is **JSON held as text** — the plugin stringifies on write and
parses on read — so that hook stringifies too. `V005`'s
`check ("metadata" is null or "metadata" is json)` is what catches the mistake if anything
ever stops.

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

**The unit suite** loads `@thallesp/nestjs-better-auth` for real — `jest.esm-transform.cjs`
converts that one package to CommonJS on the way in — and replaces `better-auth` itself with
`src/auth/better-auth.fixture.ts`. The seam is deliberate and it is where #701 ends: what
the integration contributes is middleware ordering, so a stand-in for it would be a second
implementation of the very thing under test, while what BetterAuth's routes *do* is proved
elsewhere. It stays a stand-in so that `yarn test` goes on starting nothing and running on
save.

**The integration suite loads the library itself** since
[#715](https://github.com/NobuData/ouroboros/issues/715) — same transform, pointed at
`better-auth` and its ES-module dependencies rather than at one package. That is where
"what BetterAuth's routes do" is now proved, against a real database; see *Running the
integration suite*. That the real library accepts these options was, before then,
established only outside Jest — by `@better-auth/cli generate` building an instance from
`auth.config.ts`, which is still how the schema is generated and is described below.

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
| `GET  /api/auth/get-session`         | The person and their session, or `null` for nobody                   |
| `POST /api/auth/sign-out`            | Deletes the session row; clears its cookies                          |
| `POST /api/v1/auth/logout`           | The same thing, versioned — delegates to `sign-out`. `204`           |
| `POST /api/v1/auth/discover`         | Company domain → is there SSO here? Public. See below. `200`         |

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

Only needed to exercise the GitHub path itself — for ordinary local work, the
[development sign-in](#the-development-sign-in) is already there and needs no setup.

Register a GitHub OAuth application — **Settings → Developer settings → OAuth Apps** — with
the callback URL below, and put its client id and secret in `.env` as
`OURO_GITHUB_CLIENT_ID`/`OURO_GITHUB_CLIENT_SECRET`:

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

4. **Ask who you are.** `GET /api/auth/get-session`, with the cookies the browser now holds,
   answers with the person and their session — or `null`, for a request carrying neither.
   `GET /api/auth/organization/list` is where they belong and
   `GET /api/auth/organization/get-active-member-role` is what they hold there. **Three
   calls, and there is no fourth**: `GET /api/v1/auth/me` answered all of it at once until
   [#711](https://github.com/NobuData/ouroboros/issues/711) deleted it — see
   [The two-client rule](#the-two-client-rule).

### Domain discovery

**`POST /api/v1/auth/discover`** ([#712](https://github.com/NobuData/ouroboros/issues/712))
is the backend of mockup 01 Step 1's **Company domain** field: given a domain, is there a
workspace here, and does it sign in through enterprise SSO?

```console
$ curl -sX POST http://localhost:4000/api/v1/auth/discover \
       -H 'Content-Type: application/json' \
       -d '{"domain": "https://Acme.Ouroboros.dev/"}'
{"ssoAvailable":false,"message":"Enterprise SSO is not configured yet — sign in with GitHub for now."}
```

**Every domain gets that answer**, whether or not a workspace holds it. Enterprise SSO is
[#722](https://github.com/NobuData/ouroboros/issues/722) and MVP signs in with GitHub
(roadmap decision A7), so `ssoAvailable` is `false` today — and the response carries
`redirectUrl` in its published schema anyway, so
[#718](https://github.com/NobuData/ouroboros/issues/718)'s card is written once rather than
restructured when the other branch starts happening.

**It is the one route in this service that answers a caller with no session and no way to
get one**, which is what shapes the rest of it. An endpoint that tells anybody *does this
company use Ouroboros* is a tenant-enumeration oracle unless it is built not to be:

| | How |
| --- | --- |
| Same body for known and unknown | Composed without reading the lookup — no organization name, no member count, no id |
| Same timing | Every answer is held to a fixed floor, so an index hit and a miss are the same duration on a stopwatch |
| Normalised, not guessed | `  HTTPS://Acme.Ouroboros.dev/login  ` and `acme.ouroboros.dev` are one request; a port or an email address is a `422` |
| Nothing stored | A lookup key that does not outlive the request — which is why this is the one DTO here that folds rather than refuses |

The floor is a floor rather than a constant: work that overruns it is not clamped, so what
it guarantees is that the lookup's own duration is not observable. `discovery.timing.ts` is
where that trade is argued and where the number lives. It is **not** rate limiting, and this
route has none yet — per-IP throttling on the auth and discovery surface is
[#725](https://github.com/NobuData/ouroboros/issues/725).

It reads `tenant_domains` by `domain` alone. That is deliberate:
`V006__tenancy_extensions.sql` re-parented the table from `tenant_id` onto
`organization_id` and `src/modules/db/schema.ts` has not caught up
([#714](https://github.com/NobuData/ouroboros/issues/714) is what rewrites both), while the
unique index on `domain` survived the migration untouched — V006's own comment calls it
"#712's path". `discovery.integration-spec.ts` runs the statement against a migrated
database, which is the only place that claim can be checked.

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

### The development sign-in

**There is no bypass, and there is no longer a reason to want one.**
[#33](https://github.com/NobuData/ouroboros/issues/33) shipped one: a variable naming an
address, and a branch in the guard that treated every request as coming from whoever it
named. [#703](https://github.com/NobuData/ouroboros/issues/703) deleted the
guard that read it, and [#705](https://github.com/NobuData/ouroboros/issues/705) deleted the
variable along with delivering what replaces it —
[BetterAuth's email/password sign-in](https://better-auth.com/docs/authentication/email-password),
configured in [`src/auth/password.provider.ts`](src/auth/password.provider.ts).

The difference is the point. A bypass is a way *around* authentication; a password is a way
*through* it. The routes below hash, compare, refuse a wrong answer, write a `session` row
and leave an `account` row recording how somebody proved who they were — all of which the
variable did none of.

**It is enabled by `NODE_ENV !== "production"`, and by nothing else.** There is deliberately
no `OURO_` variable of its own: a second switch is a second thing to get wrong, and the
failure mode of getting it wrong is a password route on the public API. The service's
Dockerfile pins `NODE_ENV=production`, so the off position is what any deployment inherits
without being told.

| Route                             | What it does                                             |
| --------------------------------- | -------------------------------------------------------- |
| `POST /api/auth/sign-in/email`    | `{ email, password }` → a session cookie                  |
| `POST /api/auth/sign-up/email`    | Creates an account and signs it in (`autoSignIn`)          |

Passwords are between 12 and 128 characters — the floor is this service's, above the
library's default of eight — and hashing is the library's own scrypt, deliberately not
overridden, because [#709](https://github.com/NobuData/ouroboros/issues/709)'s seed has to
write hashes the same verifier accepts.

**In production both routes answer `400`** with `EMAIL_PASSWORD_DISABLED` and
`EMAIL_PASSWORD_SIGN_UP_DISABLED`. That is the library's behaviour rather than the `404` the
issue's wording suggests: the routes stay mounted and their handlers refuse.
`src/auth/password.provider.spec.ts` asserts the option this service decides rather than the
status code the library owns.

Two consequences worth knowing:

- **The compose stack has no password sign-in.** It runs this module's production image, so
  `docker compose --profile full up` is GitHub-only. Overriding `NODE_ENV` there does not
  help — the same value moves `listenHost` back to loopback, and a container bound to
  loopback publishes nothing. Use `yarn dev` for password sign-in.
- **The e2e suite is affected by the same thing.** `tests/e2e/support/session.ts` now calls
  the sign-in route for real, and its signed-in legs stay parked until the seed writes
  credentials (#709) and the suite has a non-production `rest` to talk to.

## The tenant context

**Every request past sign-in operates as a member of one workspace**
([#32](https://github.com/NobuData/ouroboros/issues/32)), and that is resolved once, in one
place, rather than re-implemented per controller.

**Where that workspace comes from changed in
[#713](https://github.com/NobuData/ouroboros/issues/713).** #32 let the client assert it with
a header, checked against `tenant_members`; the session now carries an active organization
([#704](https://github.com/NobuData/ouroboros/issues/704)) and
[#708](https://github.com/NobuData/ouroboros/issues/708) dropped the table the old check
read. So the session is the source of truth, the header is an override, and membership is
checked against `member`.

```
request ─▶ middleware ─▶ AuthGuard ─▶ TenantContextGuard ─▶ RolesGuard ─▶ handler
           opens the      who is        which workspace,      may they
           context        asking        and are they in it    do this
                          (#703)
```

### Where the workspace comes from

Three sources, most specific first:

1. **The `{tenantId}` in the path**, on the routes that have one.
2. **The `X-Ouro-Tenant` header** — a slug or a uuid, and an explicit per-request *override*.
   It is how one request steps outside the active workspace without changing where every
   other request in flight is acting.
3. **The session's `activeOrganizationId`.** The ordinary case, and what carries every
   request a browser makes. It is server state: `POST /api/auth/organization/set-active`
   writes it, session creation stamps it (`src/auth/active.organization.ts`), and no header
   can assert it.

A path and a header that name **different** workspaces are a `422` with
`code: "tenant_mismatch"` rather than a silent preference for either — a client holding a
stale workspace in a header would otherwise quietly act on another one. A header and a
*session* that disagree are not a conflict: that is what an override is.

A session acting **nowhere**, on a request that names no workspace either, is a `400` with
`code: "organization_required"` — *choose a workspace*, which is what mockup 01 Step 2 and
the workspace switcher are for. Three states reach it and all three have the same remedy: a
person who belongs to nothing yet, one whose workspace was deleted (V005 nulls the pointer),
and one who was removed from the workspace they were acting in. It replaces #32's
`422 tenant_required`; nothing is inferred from how many workspaces somebody belongs to any
more, because the choice is now made once and stored.

The **role** comes from `member.role`, which V005 deliberately leaves un-CHECK-constrained —
the vocabulary is the organization plugin's configuration (`src/auth/organization.roles.ts`)
rather than the schema's. Two consequences are handled in `organization.repository.ts`: the
column holds a comma-separated list where somebody holds more than one role, and a word this
service does not recognise grants nothing rather than being trusted.

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

### Two routes need no workspace

`@TenantOptional()`, and both are questions about the *person* rather than a workspace:
`GET /api/v1/tenants` (which are mine) and `POST /api/v1/tenants` (let me have one).
Requiring a workspace first would be circular. Creating one makes you its `owner` in the same
transaction, because a workspace with no members is one the `404` rule puts out of reach of
the person who just made it.

There was a third — `GET /api/v1/auth/me`, *who am I* — and
[#711](https://github.com/NobuData/ouroboros/issues/711) deleted the route rather than the
exemption. `GET /api/auth/get-session` answers that question now, and BetterAuth serves it
ahead of Nest's router, so it never reaches this middleware to need marking.

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

## The internal surface

Everything above is the browser's boundary. This is the other one: two paths
`ouroboros-engine` calls, reachable from no browser at all
([#224](https://github.com/NobuData/ouroboros/issues/224), roadmap decision **P3**).

```
POST /internal/llm/invoke          the control plane makes the call — keys never cross
POST /internal/credentials/lease   local providers only — an address, TTL'd and audited
```

**A worker never holds a provider credential.** Mockup 07's page subline promises something
weaker — *"workers only ever see short-lived tokens"* — and this surface is where the first
half of it is made literal and the second is improved on. There is no token. A fifteen-minute
credential is still a credential: it genuinely reaches the worker, revocation is bounded only
by its TTL, and the audit surface widens to every process that ever held one. It is also,
for most LLM providers, fiction — almost none support deriving short-lived scoped keys, so
such a token would in practice be a full API key with a timer bolted on by us.

So the division is by *what a provider needs in order to be reached*:

| Provider kind | Reached by | Given to a worker |
| --- | --- | --- |
| `anthropic`, `copilot`, `cursor` | the control plane, which holds the key for one request scope | nothing — a lease is `403 provider_not_leasable` |
| `ollama`, `openai_compatible` | the worker, directly | a base URL, TTL-bounded and audited |

The exception is narrow and is not a compromise: an engine worker calling an Ollama daemon
on the same box gains nothing from proxying its traffic through this service, because there
is no key on that path to protect.

**The policy is enforced in two places, and both are needed.** `lease.ts` refuses a cloud
kind before it looks anything up, so no state and no configuration can produce a grant; and
`configuration.ts` refuses to start a process whose `OURO_LOCAL_PROVIDER_URLS` names one, so
an operator cannot configure their way past the first check. A policy that lived only in the
service could be walked around, and one that lived only in configuration would miss a kind
added to that variable by a later ticket.

**A lease has nowhere to put a secret.** Every field of the answer is an identifier, an
address or a timestamp, and `no-secret-responses.mjs` — a lint rule over
`src/modules/internal/` — refuses a field named for credential material in anything this
surface returns. That is the acceptance criterion *no secret, verified by payload
inspection* made structural rather than watched for.

```console
$ curl -s -X POST localhost:4000/internal/credentials/lease \
    -H "X-Ouro-Internal-Key: $OURO_ENGINE_SHARED_SECRET" \
    -H 'Content-Type: application/json' \
    -d '{"provider":"ollama","run":"4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94"}'
{"id":"7c9e…","provider":"ollama","run":"4d2a…","organizationId":"aBcD…",
 "baseUrl":"http://localhost:11434","grantedAt":"…","expiresAt":"…","ttlSeconds":900}

$ curl -s -X POST localhost:4000/internal/credentials/lease … -d '{"provider":"anthropic",…}'
{"code":"provider_not_leasable","message":"This provider is reached through the invocation
 proxy; its credentials never leave the control plane. …","details":{"provider":"anthropic"}}
```

**A lease is not a bearer token**, which is why nothing stores one and there is no way to
revoke one: holding it grants nothing that knowing the address would not. What the TTL bounds
is how long a worker should keep believing the answer before asking again.

**Where the address comes from, and where it will come from.** `OURO_LOCAL_PROVIDER_URLS`
today — the operator saying *these kinds are local here, at these addresses* — because Y.1
([#189](https://github.com/NobuData/ouroboros/issues/189)) has not landed and there is no
`provider_connections` row to read. `LocalProviders` is the seam that changes when it does;
nothing above it moves.

**Every grant writes `credential.lease_granted`**, carrying the lease, the run, the workspace,
the provider and the address — never secret material, because on this path there is none. It
is a row in `audit_events` since AD.4
([#225](https://github.com/NobuData/ouroboros/issues/225)) and has **no actor**: a worker
authenticates with a service key rather than as a person, so naming a user would be inventing
one.

**`POST /internal/llm/invoke` is a contract, not an implementation.** It answers `501
invocation_not_implemented` naming AF.2 ([#235](https://github.com/NobuData/ouroboros/issues/235)),
deliberately rather than `404`, so an executor being written against it can tell *the path is
right and the other half is not built yet* from *I have the URL wrong*. The request and
streaming shapes are in [`openapi.internal.yaml`](openapi.internal.yaml) and in
`invoke.contract.ts`, and `ouroboros-engine/src/ouroboros_engine/control_plane/` mirrors them
— which is what makes AF.1's ([#234](https://github.com/NobuData/ouroboros/issues/234)) ADR a
real decision rather than a description of whatever got built.

**Authentication is the [#51](https://github.com/NobuData/ouroboros/issues/51) pattern, in
the other direction.** Every route requires `X-Ouro-Internal-Key` carrying
`OURO_ENGINE_SHARED_SECRET` — the same header and the same variable this service sends when
*it* calls the engine. The comparison is constant time over digests, a missing header takes
the same path as a wrong one, and the rejection is one constant body. A session cookie is not
accepted here, whoever it belongs to: `guard.surface.spec.ts` enumerates all three categories
of route — *needs a session*, *needs nothing*, *needs the key* — and asserts each one in both
directions.

**These paths are outside `/api` and unversioned**, for the reason the health probes are: the
prefix is the browser's boundary — CORS-configured, session-authenticated, and published in
the document `ouroboros-ui` generates a client from — and the only caller of these two is
deployed alongside this service and upgraded with it.

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
process nothing can route to — and it is the single flag that decides whether the
[development sign-in](#the-development-sign-in) exists, so an image started with an
inherited development environment still has no password route.

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
│   │                       #   provider #702 · sessions #703 · organizations #704
│   └── modules/
│       ├── app/            # heartbeat — controller, service, root module
│       ├── config/         # the zod schema, the typed service, redaction
│       ├── errors/         # the {code, message, details} envelope, filter, pipe
│       ├── health/         # /health/live, /health/ready, the two probes
│       ├── db/             # schema types, pool, Kysely instance, lifecycle
│       ├── tenancy/        # tenants, domains, members, enablement · #31 · context #32
│       ├── auth/           # sign-out, the legacy cookie · #33 #703 · discovery #712
│       ├── engine/         # typed internal client + /engine/status       · #35
│       ├── preferences/    # the caller's own font scale                  · #649
│       ├── dashboard/      # GET /dashboard — mockup 02 in one payload    · #70
│       ├── pricing/        # what a model costs, with provenance          · #586
│       ├── registry/       # alias → model on a provider connection       · #189
│       │                   #   no controller — decision M2 leaves CRUD to 07/21
│       ├── provider-health/ # passive-first health + the strip payload     · #196
│       │                   #   scheduled, jittered — and never a completion
│       ├── routing/        # resolve() — pure, versioned, health-aware      · #194
│       │                   #   management.* — GET /routing, Save routes, the rules · #195
│       │                   #   simulate.*  — POST /routing/simulate, one dependency · #197
│       │                   #   stats.*     — $/run avg, p50, the 30d spend card · #198
│       │                   #   {matrix,persistence,isolation,honesty}.integration-spec · #199
│       ├── providers/     # the ModelProviderAdapter SPI, registry, kit   · #216
│       │                   #   adapters/anthropic.adapter.ts — the first real one · #217
│       │                   #   adapters/openai-compatible.adapter.ts + the SSRF policy · #218
│       │                   #   adapters/ollama.adapter.ts + provider.pulls.ts · #219
│       │                   #   adapters/{copilot,cursor}.adapter.ts + entitlements · #220
│       │                   #   adapters/ is the only place a provider SDK may be imported
│       ├── provider-connections/ # /api/v1/providers — the credential lifecycle · #223
│       │                   #   masking.ts · step-up.ts · reveal.limiter.ts · connection.audit.ts
│       ├── audit/          # audit_events — the credential trail            · #225
│       │                   #   the one writer; GET /api/v1/providers/audit reads it
│       ├── vault/          # envelope encryption: tenant DEKs, KeyWrapper · #222
│       │                   #   no controller — nothing here is a route
│       └── internal/       # /internal/* — the engine-facing surface       · #224
│                           #   lease (local providers only) + the invoke contract
├── Dockerfile              # the production image — built from the *repo root*
├── Dockerfile.dockerignore # …and the context that image is built from
├── scripts/openapi.mjs     # `yarn openapi` — renders the JSON from the YAML
├── openapi.yaml            # the API specification — authoritative, hand-written
├── openapi.json            # rendered from it; the copy the service loads
├── openapi.internal.yaml   # the engine-facing contract — authoritative      · #224
├── openapi.internal.json   # rendered from it; read by AF.1/AF.2, served nowhere
├── .dependency-cruiser.cjs # the provider boundary — `yarn lint` runs it       · #216
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

`internal/` contributes the third global guard and is the only module whose routes are
outside `/api` ([#224](https://github.com/NobuData/ouroboros/issues/224)). `InternalKeyGuard`
is registered there as an `APP_GUARD` and keyed on `@InternalOnly()` rather than applied to
its two controllers, for the same reason the session guard is global: a guard somebody has to
remember to add is a guard that will be forgotten, and here forgetting it means an
unauthenticated internal endpoint. `internal.module.spec.ts` asserts the complement — every
route whose *path* is under `/internal` carries the decorator — so neither half can go missing
quietly.

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
organization plugin adoption [#704](https://github.com/NobuData/ouroboros/issues/704) ·
tenant context [#32](https://github.com/NobuData/ouroboros/issues/32) ·
model pricing [#586](https://github.com/NobuData/ouroboros/issues/586) ·
the model registry [#189](https://github.com/NobuData/ouroboros/issues/189) ·
provider health [#196](https://github.com/NobuData/ouroboros/issues/196) ·
provider adapters [#216](https://github.com/NobuData/ouroboros/issues/216) ·
the Anthropic adapter [#217](https://github.com/NobuData/ouroboros/issues/217) ·
the OpenAI-compatible adapter [#218](https://github.com/NobuData/ouroboros/issues/218) ·
the Ollama adapter and server-side pulls [#219](https://github.com/NobuData/ouroboros/issues/219) ·
the Copilot & Cursor adapters [#220](https://github.com/NobuData/ouroboros/issues/220) ·
the credential lifecycle [#223](https://github.com/NobuData/ouroboros/issues/223) ·
the credential audit trail [#225](https://github.com/NobuData/ouroboros/issues/225) ·
engine gateway [#35](https://github.com/NobuData/ouroboros/issues/35) ·
the contract it mirrors [#52](https://github.com/NobuData/ouroboros/issues/52) ·
container [#36](https://github.com/NobuData/ouroboros/issues/36) ·
integration harness [#37](https://github.com/NobuData/ouroboros/issues/37) ·
auth integration suite [#715](https://github.com/NobuData/ouroboros/issues/715) ·
the routing regression suite [#199](https://github.com/NobuData/ouroboros/issues/199) ·
the Flyway project it migrates with [#19](https://github.com/NobuData/ouroboros/issues/19) ·
the compose stack that runs it [#55](https://github.com/NobuData/ouroboros/issues/55) ·
full epic [#4](https://github.com/NobuData/ouroboros/issues/4).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
