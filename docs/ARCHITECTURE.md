# Ouroboros — architecture

**Infinity in Autonomy.** Ouroboros takes GitHub issues in and puts verified pull
requests out. This document describes the system that does that work: the modules it is
built from, the boundaries between them, how a request travels from a browser to the
database and back, and the configuration that wires the whole thing together.

It is the durable home for decisions that would otherwise live only in the roadmap.
[`CONVENTIONS.md`](CONVENTIONS.md) says how code in this repository is written, built and
shipped; this document says how the system is *shaped*. Where the two touch — the port
map, the `OURO_*` prefix, the architectural invariants — the conventions doc states the
rule and this one explains the structure the rule protects.

Filed as issue [#12](https://github.com/NobuData/ouroboros/issues/12). The plan being
executed is
[`ROADMAP_OUROBOROS_APPLICATION_SCAFFOLDING.md`](ROADMAP_OUROBOROS_APPLICATION_SCAFFOLDING.md);
the screens are [`docs/mockups/`](mockups/README.md) and the application shell they are
built into is [`DESIGN_SYSTEM_APP_SHELL.md`](DESIGN_SYSTEM_APP_SHELL.md).

## Status of this document

The system is being scaffolded, and this document is written against what is actually in
the checkout — not against a finished product. Every section says which of the two it is
describing:

- **Running** — the code exists and the description can be checked against it.
- **Specified** — the module is still a README, and what follows is the contract its
  scaffold must satisfy. The issue that lands it is named.

| Module | State | Landing in |
|---|---|---|
| [`ouroboros-db`](../ouroboros-db) | **Running** — migrations apply against a live PostgreSQL | Complete: the Flyway project landed with [#19](https://github.com/NobuData/ouroboros/issues/19) |
| [`ouroboros-rest`](../ouroboros-rest) | **Running** — the NestJS application serves a heartbeat on `/api/v1` | Scaffolded by [#27](https://github.com/NobuData/ouroboros/issues/27) → epic [#4](https://github.com/NobuData/ouroboros/issues/4) |
| [`ouroboros-ui`](../ouroboros-ui) | **Running** — the App Router skeleton builds and serves | Scaffolded by [#39](https://github.com/NobuData/ouroboros/issues/39) → epic [#5](https://github.com/NobuData/ouroboros/issues/5) |
| [`ouroboros-engine`](../ouroboros-engine) | **Running** — the FastAPI service serves liveness and a key-guarded `/v0` | Scaffolded by [#50](https://github.com/NobuData/ouroboros/issues/50), guarded by [#51](https://github.com/NobuData/ouroboros/issues/51) → epic [#6](https://github.com/NobuData/ouroboros/issues/6) |
| [`ouroboros-web`](../ouroboros-web) | **Running** — the marketing site, outside the application stack | — |

Keeping the document true as those scaffolds land is a maintenance obligation, and part
of it is mechanical: [`scripts/verify-architecture.sh`](../scripts/verify-architecture.sh)
asserts the parts a script can check — see [§10](#10-keeping-this-document-true).

## 1. The system at a glance

Four modules, one direction of travel. The browser talks to the UI, the UI talks to the
communications layer, and the communications layer is the only thing that talks to the
database and to the engine.

```mermaid
flowchart LR
    subgraph browser["Browser"]
        UI["ouroboros-ui :3000<br/>Next.js · App Router<br/>light/dark themes"]
    end
    subgraph comms["Communications layer — the only public boundary"]
        REST["ouroboros-rest :4000<br/>NestJS · auth · tenancy · gateway"]
    end
    subgraph internal["Internal — never reachable from a browser"]
        ENGINE["ouroboros-engine :8000<br/>Python · FastAPI"]
        DB[("ouroboros-db :5432<br/>PostgreSQL 17 · Flyway")]
    end

    UI -- "HTTPS / JSON<br/>generated TS client<br/>session cookie · X-Ouro-Tenant" --> REST
    REST -- "internal HTTP<br/>X-Ouro-Internal-Key" --> ENGINE
    REST -- "Kysely over pg" --> DB
    GH["GitHub<br/>OAuth · issues · pull requests"] -.->|"OAuth code flow"| REST
```

That single boundary is the load-bearing idea. Authentication, tenant resolution and
authorization all happen in one process, so there is one place to audit and one place to
change when the rules change. A UI that could query the database directly, or a browser
that could reach the engine, would mean the same rules re-implemented — and eventually
re-implemented differently.

### Port map (development defaults)

| Service | Port | Published in development | Reachable from the browser |
|---|:---:|:---:|:---:|
| `ouroboros-ui` | 3000 | yes | yes |
| `ouroboros-rest` | 4000 | yes | yes |
| `ouroboros-engine` | 8000 | no — compose-internal | **no** |
| `ouroboros-db` (PostgreSQL) | 5432 | `127.0.0.1` only | **no** |

Every service reads its listen port from the unprefixed `PORT`, because that is what
container platforms set. `ouroboros-web` also defaults to 3000; it is the marketing site,
is not part of the application stack, and the two are never up at once.

The database is published on the loopback interface deliberately: a development password
is a real password to anything that can reach the port, and Docker's default is every
interface on the machine. The full-stack compose file
([#55](https://github.com/NobuData/ouroboros/issues/55)) publishes only `ui:3000` and
`rest:4000`; the engine and the database stay on the internal network, and a check that
the engine port is *unreachable* from the host is one of that issue's acceptance
criteria.

## 2. The modules

| Module | Responsibility | Talks to | Never talks to |
|---|---|---|---|
| `ouroboros-ui` | Renders the product; holds no business rules | `ouroboros-rest` | the database, the engine |
| `ouroboros-rest` | Auth, sessions, tenancy, the public API, the engine gateway | `ouroboros-db`, `ouroboros-engine`, GitHub | — |
| `ouroboros-engine` | Executes the work REST brokers | (nothing outbound yet) | the browser, the database |
| `ouroboros-db` | Owns the schema; stores tenancy data | — (it is spoken to) | — |

### 2.1 `ouroboros-ui` — the product UI

**Running** ([#39](https://github.com/NobuData/ouroboros/issues/39)). Next.js 16 App
Router, TypeScript `strict`, Yarn 4, port 3000. What is up is the skeleton — route
groups, the three self-hosted faces, and the lint/typecheck/test/build pipeline `ci/ui`
runs; the screens below are what lands on it.

It renders the screens designed in [`mockups/`](mockups/README.md) inside the shell
specified in [`DESIGN_SYSTEM_APP_SHELL.md`](DESIGN_SYSTEM_APP_SHELL.md), with on-the-fly
light/dark switching driven by `data-theme` on `<html>` and CSS custom properties. It
reads exactly one service address, `OURO_REST_URL`, because there is exactly one service
it may call.

What it must not do is as important as what it does: **no business rules, no direct data
access, no second source of API types.** Its client is generated from the REST layer's
OpenAPI document ([§5.1](#51-ui--rest--the-public-contract)), so a contract change is a
compile error rather than a runtime surprise.

### 2.2 `ouroboros-rest` — the communications layer

**Running** ([#27](https://github.com/NobuData/ouroboros/issues/27)). NestJS 11,
TypeScript `strict`, port 4000, all routes under `/api/v1` — a global `/api` prefix and
URI versioning defaulting to v1, so a route is versioned by omission rather than by
remembering to be. What is up is the skeleton: `src/modules/app` answering a heartbeat
that names the service and the build, `PORT` and `NODE_ENV` validated before a socket is
bound, and shutdown hooks enabled ahead of the first provider that will need to drain
something. It also publishes the contract it is written against — Swagger UI at
`/api/docs` and the committed document at `/api/openapi.json`, served verbatim rather
than generated ([§5.1](#51-ui--rest--the-public-contract)). Kysely over `pg` arrives with
[#30](https://github.com/NobuData/ouroboros/issues/30).

It is the only module that talks to the database and the only module that talks to the
engine, and it owns everything that follows from that:

- **Configuration** — every `OURO_*` variable validated by zod at boot, failing fast and
  naming the offending variable ([#28](https://github.com/NobuData/ouroboros/issues/28)).
- **Health** — `/health/live` for the process, `/health/ready` for the process *and* its
  dependencies ([#29](https://github.com/NobuData/ouroboros/issues/29)).
- **Data access** — a typed Kysely instance over a `pg` pool; repositories live with
  their feature module ([#30](https://github.com/NobuData/ouroboros/issues/30)).
- **Tenancy** — tenants, domains, members and GitHub org/repo enablement
  ([#31](https://github.com/NobuData/ouroboros/issues/31)), plus the per-request tenant
  context ([#32](https://github.com/NobuData/ouroboros/issues/32)).
- **Auth** — the GitHub OAuth code flow and the session cookie
  ([#33](https://github.com/NobuData/ouroboros/issues/33)).
- **The engine gateway** — a typed internal client and the one route that exposes engine
  state to authenticated users ([#35](https://github.com/NobuData/ouroboros/issues/35)).
- **The contract** — an OpenAPI document served at `/api/docs` and exported for client
  generation ([#34](https://github.com/NobuData/ouroboros/issues/34)).

It writes no DDL. The schema belongs to Flyway; Kysely's `Database` interface mirrors the
migrations rather than defining them.

### 2.3 `ouroboros-engine` — the backend

**Running.** Python 3.12, FastAPI, uv, port 8000. The scaffold —
`src/ouroboros_engine/` with its application factory, `OURO_*` settings validated at
import, and `GET /` naming the service and version — landed with
[#50](https://github.com/NobuData/ouroboros/issues/50); the guarded surface with
[#51](https://github.com/NobuData/ouroboros/issues/51).

The engine executes the work the REST layer brokers, and in time the autonomous loops the
product is named for. It is **internal only**, and enforces that itself rather than
trusting the network to: `/healthz` is open so a container platform can probe liveness,
and **every other path** — `/v0/status`, `GET /`, the OpenAPI document, a path
that does not exist — requires the shared secret on `X-Ouro-Internal-Key`, compared in
constant time. The check is middleware, so it runs before routing and a request without
the key gets a 401 that reveals nothing about whether the path exists.

`OURO_ENGINE_SHARED_SECRET` is therefore **mandatory**: an engine without one could serve
nothing but liveness, so it names the missing variable and exits 2 rather than starting.
Records are emitted as one JSON object per line, uvicorn's included, and a rejected key
is never one of the fields.

It holds no database connection. Anything the engine needs to know arrives in the request
the REST layer makes, which keeps tenancy enforcement on the REST side of the boundary
rather than duplicated behind it.

### 2.4 `ouroboros-db` — the tenancy database

**Running.** PostgreSQL 17, Flyway 11, schema `ouroboros`, port 5432.

Flyway is the **sole owner of DDL** — no application module creates or alters schema.
Migrations live in [`ouroboros-db/migrations/`](../ouroboros-db/migrations) as plain SQL,
one concern per file, immutable once applied; the naming rule
(`V###__snake_case.sql` / `R__snake_case.sql`) is enforced by Flyway's own
`validateMigrationNaming` and asserted before the run by `scripts/verify-dev-env.sh`.

Two ways to apply them, both live today: the repo-root
[`docker-compose.yml`](../docker-compose.yml) migrates on the way up, and
[`ouroboros-db/run.sh`](../ouroboros-db/run.sh) migrates a database that is already
running — the compose one, a PostgreSQL installed on the machine, or a server across the
network.

The tenancy schema itself lands over
[#20](https://github.com/NobuData/ouroboros/issues/20)–[#23](https://github.com/NobuData/ouroboros/issues/23):

```mermaid
erDiagram
    tenants ||--o{ tenant_domains : "resolves sign-in via"
    tenants ||--o{ tenant_members : "grants membership through"
    tenants ||--o{ github_orgs : "enables"
    github_orgs ||--o{ github_repos : "scopes"
    users ||--o{ tenant_members : "belongs to tenants via"
    users ||--o{ user_identities : "signs in with"
```

Every table above the identity layer hangs off `tenants`, which is what makes a single
tenant predicate sufficient to isolate a customer — and what makes row-level security
([#25](https://github.com/NobuData/ouroboros/issues/25)) a later addition rather than a
redesign.

### 2.5 `ouroboros-web` — the marketing site

**Running**, and deliberately outside everything above. It is
[ouroboros.build](https://ouroboros.build): its own Next.js application, its own build,
its own image, its own deploy. It shares the brand and nothing else — no API, no
database, no session. It appears here only so that its absence from the diagrams is
understood as a decision rather than an omission.

## 3. Request paths

### 3.1 A browser request

**Specified.** The path every product screen takes, with the checkpoints that make it
safe:

```mermaid
sequenceDiagram
    participant B as Browser
    participant U as ouroboros-ui :3000
    participant R as ouroboros-rest :4000
    participant D as ouroboros-db :5432

    B->>U: navigate / interact
    U->>R: GET /api/v1/... (cookie: ouro_session, X-Ouro-Tenant)
    R->>R: session → principal
    R->>R: tenant context → membership + role
    R->>D: parameterised query, tenant-scoped
    D-->>R: rows
    R-->>U: JSON (typed by the generated client)
    U-->>B: rendered screen
```

Three things happen in the REST layer between the request arriving and the query being
made, and none of them are optional: the session is resolved to a principal, the tenant
is resolved and the principal's membership of it verified, and only then is a query
issued — already scoped to that tenant. A request that fails the second step never
reaches the third.

### 3.2 An engine call

**Specified.** The UI never calls the engine; it calls REST, and REST calls the engine.

```mermaid
sequenceDiagram
    participant U as ouroboros-ui
    participant R as ouroboros-rest
    participant E as ouroboros-engine

    U->>R: GET /api/v1/engine/status (authenticated)
    R->>E: GET /v0/status (X-Ouro-Internal-Key)
    alt engine healthy
        E-->>R: { version, uptime }
        R-->>U: { engine: "up", version }
    else engine unreachable or key rejected
        E--xR: timeout · connection refused · 401
        R-->>U: 502 { code: "engine_unavailable", message }
    end
```

The failure branch is a design decision, not an accident. An engine that is down, an
engine that rejects the shared secret, and an engine at an address that no longer resolves
all surface to the client as the same 502 — never as a 401, and never carrying the
internal URL. The caller learns that the system cannot serve the request; it learns
nothing it could use to probe the inside of the network. The detail goes to the logs.

## 4. Authentication, sessions and tenant context

**Specified** ([#33](https://github.com/NobuData/ouroboros/issues/33),
[#32](https://github.com/NobuData/ouroboros/issues/32)).

### 4.1 Signing in

Sign-in is GitHub OAuth. The browser never handles a token; the code exchange happens
server-side in the REST layer, and what comes back to the browser is a cookie.

```mermaid
sequenceDiagram
    participant B as Browser
    participant R as ouroboros-rest
    participant G as GitHub

    B->>R: GET /auth/github
    R-->>B: 302 → github.com/login/oauth/authorize (state)
    B->>G: authorize the application
    G-->>B: 302 → /auth/github/callback?code&state
    B->>R: callback(code, state)
    R->>R: verify state (CSRF)
    R->>G: exchange code → profile + primary email
    R->>R: upsert users / user_identities
    R-->>B: Set-Cookie: ouro_session (httpOnly) · 302 → /
    B->>R: GET /auth/me
    R-->>B: { user, memberships }
```

The session cookie:

| Property | Value | Why |
|---|---|---|
| Name | `ouro_session` | One cookie, one purpose |
| Contents | Signed principal reference — user id and issue time | No profile data in the browser |
| `httpOnly` | yes | Script on the page cannot read it |
| `SameSite` | `Lax` | The OAuth redirect still works; cross-site posts do not |
| `Secure` | outside development | A development stack has no TLS |
| Signing key | `OURO_SESSION_SECRET` | Rotating it invalidates every open session |

The MVP session is a stateless signed cookie, which is honest about its trade-off: there
is no server-side record to delete, so revocation before expiry is a v2 concern tracked
with the security hardening pass
([#38](https://github.com/NobuData/ouroboros/issues/38)) and documented here when it
lands. Local development without GitHub credentials uses a dev-mode bypass that is hard
disabled when `NODE_ENV=production`.

### 4.2 Resolving the tenant

Authentication answers *who*; tenant context answers *on whose behalf*. Every request past
sign-in operates as a member of exactly one tenant, resolved centrally rather than
per-controller:

1. The active tenant comes from the `X-Ouro-Tenant` header (slug or uuid), falling back
   to the user's sole membership when they belong to exactly one tenant.
2. Membership and role are looked up and attached to a request-scoped context
   (`AsyncLocalStorage`), so services read the current tenant without it being threaded
   through every signature.
3. A tenant the principal is not a member of returns **404, not 403** — a 403 would
   confirm that the tenant exists.

Roles are `owner`, `admin`, `member`, `viewer`, checked by a guard at the route rather
than by hand in service code, with owner-protection rules (the last owner of a tenant
cannot be demoted or removed).

Tenancy is enforced in the REST layer and, for the MVP, only there — which is exactly why
[§8](#8-architectural-invariants) states it as an invariant. The defence in depth is
PostgreSQL row-level security keyed on `current_setting('ouro.tenant_id')`
([#25](https://github.com/NobuData/ouroboros/issues/25)); the tenant-context middleware is
where the setting will be applied, so adopting it is a change in one place.

## 5. The API contracts

Two contracts, and **both are written first and served verbatim**. A document generated
from whichever service happened to be edited last is a report about code, not something
two sides agreed on; it changes when a docstring does, it carries the titles a generator
invents, and it cannot say anything the framework has no field for. So each service
commits its specification, serves those exact bytes, and lets its own test suite fail when
the code and the document disagree — which is the property that actually matters, not
which of the two was typed first. Generation stays where it belongs: at the *consuming*
end, where the UI's client is derived from the contract REST publishes.

### 5.1 UI ↔ REST — the public contract

**Running** ([#34](https://github.com/NobuData/ouroboros/issues/34) landed the
specification and the checks around it; the typed client is
[#43](https://github.com/NobuData/ouroboros/issues/43)). Roadmap decision **D4** stands
where it counts — there is one source of truth for the API and the UI's client is
generated from it — with the source being
[`ouroboros-rest/openapi.yaml`](../ouroboros-rest/openapi.yaml) rather than the
decorators, so the contract is a thing to agree on before the code exists.

```mermaid
flowchart LR
    SPEC["ouroboros-rest/openapi.yaml<br/>authoritative · hand-written"] --> JSON["openapi.json<br/>rendered by yarn openapi · committed"]
    JSON --> HUMAN["/api/docs · /api/openapi.json<br/>served verbatim"]
    JSON --> GEN["yarn api:sync in ouroboros-ui<br/>openapi-typescript + openapi-fetch"]
    GEN --> CLIENT["Typed client<br/>cookie · X-Ouro-Tenant · ApiError"]
    CODE["NestJS controllers"] -. "ci/rest fails on disagreement" .-> JSON
```

Every link in that chain is checked. `yarn test` in `ouroboros-rest` fails when the two
files have drifted apart, when the application serves a route the document does not
describe *or* describes one it does not serve, when a response body carries a field the
schema does not list, when `info.version` stops matching `package.json`, or when the
document is not valid OpenAPI 3.1. The generated client is committed and a CI check fails
when it is stale. Renaming a field therefore means editing the specification, which breaks
the UI's typecheck after a sync — which is the entire point of generating it.

`@nestjs/swagger` is still a dependency, and does two jobs: it renders Swagger UI over the
committed document, and in the test suite it derives what the code serves so that answer
can be compared against what the document promises. It is never asked to *build* the
contract.

The client wrapper adds what every call needs and no call should repeat: the base URL from
`OURO_REST_URL`, credentials included so the session cookie travels, the `X-Ouro-Tenant`
header from the active-tenant store, and parsing of the error envelope into a typed
`ApiError` — with a 401 routing to the login screen.

### 5.2 REST ↔ engine — the internal contract

**Partly running** ([#51](https://github.com/NobuData/ouroboros/issues/51) landed the
first two routes; [#52](https://github.com/NobuData/ouroboros/issues/52) and
[#35](https://github.com/NobuData/ouroboros/issues/35) are the rest). The engine
publishes a versioned contract under `/v0/`, and REST mirrors it in a typed client:

| Route | Auth | Purpose | State |
|---|---|---|---|
| `GET /healthz` | open | Liveness, for the container healthcheck and REST's readiness probe | **Running** (#51) |
| `GET /v0/status` | `X-Ouro-Internal-Key` | Version and uptime | **Running** (#51) |
| `POST /v0/tasks/echo` | `X-Ouro-Internal-Key` | The contract exemplar: `{task_kind, payload}` → `{accepted, echo, engine_version}` | Specified (#52) |

The version lives in the path (`/v0`), so a breaking change to the internal contract is a
new prefix served alongside the old one rather than a flag day. `OURO_ENGINE_SHARED_SECRET`
must carry the same value on both sides; the engine compares it in constant time, and a
mismatch is logged there and surfaced by REST as a 502 as described in
[§3.2](#32-an-engine-call).

**The engine is spec-first.**
[`ouroboros-engine/openapi.yaml`](../ouroboros-engine/openapi.yaml) is the document, not a
report about the code: FastAPI generates nothing, the application loads the committed file
and serves it verbatim at `/openapi.json`, and
[`openapi.json`](../ouroboros-engine/openapi.json) is rendered from the YAML by
`uv run openapi` for the process and for whatever catalogues the contract. That direction
suits a boundary between two services — the document is where the two agree, and it can
state things FastAPI has no field for, like the `X-Ouro-Internal-Key` scheme and the `401`
every guarded operation returns. The check that replaces generation is the engine's own
test suite, which fails when the served routes, the response models, the version or the
public-path set stop matching what the document claims.

### 5.3 The error envelope

Every error a client sees has the same shape, from both services:

```json
{ "code": "domain_taken", "message": "That domain belongs to another tenant", "details": {} }
```

`code` is stable and machine-readable, `message` is for a human, `details` carries
per-field validation output. Database constraint violations are mapped into it rather than
leaking through — a duplicate domain is a `409` with `code: "domain_taken"`, not a
PostgreSQL error string. The engine mirrors the shape so that a failure crossing the
gateway does not change form on the way out.

## 6. Configuration — the `OURO_*` registry

### 6.1 The rules

1. **`PORT` is unprefixed**, because that is what container platforms set. Other platform
   standards (`NODE_ENV`, `HOSTNAME`) likewise stay unprefixed.
2. **Everything Ouroboros-specific is prefixed `OURO_`**, so a container can inherit
   unrelated environment without collision and a developer can see at a glance which
   variables belong to this system.
3. **Configuration is validated at boot and fails fast** — zod in the REST layer,
   pydantic-settings in the engine. A missing or malformed variable exits non-zero naming
   the exact variable; it never surfaces as a stack trace on the first request.
4. **Real `.env` files are never committed.** [`.env.example`](../.env.example) is the
   complete list with development defaults, and is the file that is committed. A module
   may add its own template for what only its tooling reads — as
   [`ouroboros-db/.env.example`](../ouroboros-db/.env.example) does — but the root file
   stays the full registry and the module's is a subset of it.
5. **Secrets are redacted from configuration logging**, and no value in a committed
   template is a real credential.

### 6.2 The registry

Every variable in [`.env.example`](../.env.example) — plus the two unprefixed platform
standards the services also read — with what reads it and the development default a clean
checkout runs with:

| Variable | Read by | Purpose | Development default |
|---|---|---|---|
| `PORT` | every service | HTTP listen port — 3000 UI, 4000 REST, 8000 engine | per module |
| `NODE_ENV` | `ouroboros-ui`, `ouroboros-rest` | `development` \| `production` \| `test`; gates the dev auth bypass and cookie `Secure` | `development` |
| `OURO_DB_HOST` | `ouroboros-db/run.sh` | Host the database is reachable on | `localhost` |
| `OURO_DB_PORT` | compose, `run.sh` | Host port the database is published on; inside the compose network it is always 5432 | `5432` |
| `OURO_DB_NAME` | compose, `run.sh` | Database name, created on first boot | `ouroboros` |
| `OURO_DB_USER` | compose, `run.sh` | Role that owns the database | `ouroboros` |
| `OURO_DB_PASSWORD` | compose, `run.sh` | Password for that role — local development only | `ouroboros` |
| `OURO_DB_SCHEMA` | compose, `run.sh` | Schema Flyway owns and migrates | `ouroboros` |
| `OURO_DATABASE_URL` | `ouroboros-rest` | Connection string for the Kysely pool | `postgresql://ouroboros:ouroboros@localhost:5432/ouroboros` |
| `OURO_REST_URL` | `ouroboros-ui` | Base URL of the communications layer — the only service address the UI knows | `http://localhost:4000` |
| `OURO_ENGINE_URL` | `ouroboros-rest` | Base URL of the engine; never exposed to a browser | `http://localhost:8000` |
| `OURO_ENGINE_SHARED_SECRET` | `ouroboros-rest`, `ouroboros-engine` | Value of `X-Ouro-Internal-Key`; compared in constant time. Both sides must match | `dev-engine-shared-secret-change-me` |
| `OURO_SESSION_SECRET` | `ouroboros-rest` | Signing key for the session cookie; rotating it invalidates every session | `dev-session-secret-change-me` |
| `OURO_GITHUB_CLIENT_ID` | `ouroboros-rest` | GitHub OAuth application, client id | `dev-github-client-id` |
| `OURO_GITHUB_CLIENT_SECRET` | `ouroboros-rest` | GitHub OAuth application, client secret | `dev-github-client-secret` |
| `OURO_LOG_LEVEL` | `ouroboros-engine` | Log verbosity: `debug`, `info`, `warning`, `error` | `info` |

The database variables appear twice on purpose: the six discrete parameters configure the
containers and the migration runner, while `OURO_DATABASE_URL` is what an application
connects with. Compose does not derive one from the other, so a change to the parameters
means a matching change to the URL.

A variable that no longer appears in the template is a variable a developer cannot
discover, so `scripts/verify-dev-env.sh` fails when the template falls behind the compose
stack or a module README, and `scripts/verify-architecture.sh` fails when it falls behind
*this table* in either direction.

## 7. Environments

### 7.1 Local development

**Running for the data tier.** [`docker-compose.yml`](../docker-compose.yml) at the repo
root brings up PostgreSQL 17 and applies every migration:

```bash
docker compose up            # database on :5432, migrations applied
docker compose down -v       # reset — stops everything and drops the volume
```

It needs no `.env` at all: every value is interpolated with a development default, so a
clean checkout works as-is, and every credential arrives by interpolation rather than
being written into the file. The migrator waits on the database's healthcheck rather than
on a sleep, which is what stops the first migration racing the restart PostgreSQL performs
at the end of its own initialisation.

The remaining services join **this same file** — not a second one — in
[#55](https://github.com/NobuData/ouroboros/issues/55), gated on healthchecks in dependency
order:

```mermaid
flowchart LR
    DB[(db)] -->|healthy| FW["flyway migrate<br/>runs once, exits"]
    FW --> REST
    ENG["engine :8000<br/>internal"] -->|healthy| REST["rest :4000"]
    REST -->|healthy| UI["ui :3000"]
```

### 7.2 Continuous integration

Every module has its own path-filtered workflow, so a pull request runs only the checks it
can affect: `ci/ui`, `ci/rest`, `ci/engine`, `ci/db`. A module's checks activate by
themselves when its manifest lands — the pull request that adds a `package.json` or a
`pyproject.toml` is the one that turns them on, and no workflow is edited. The detail is
[`CONVENTIONS.md` § 9](CONVENTIONS.md#9-ci); the routing is asserted from the checkout by
`scripts/verify-ci.sh`.

A change to `docs/` or `scripts/` queues no module workflow, which is why the repo-level
checks are dependency-free POSIX shell that anyone can run at any time.

### 7.3 Deployment

Out of MVP scope and deliberately undecided. Images publish to GHCR in
[#57](https://github.com/NobuData/ouroboros/issues/57) and the single-host runbook —
TLS, real OAuth callback URLs, backups, upgrade procedure — is
[#58](https://github.com/NobuData/ouroboros/issues/58). What is already settled is the
shape it has to fit: five containers, only two of them published, all configuration by
environment, and no schema change outside Flyway.

## 8. Architectural invariants

These are properties of the system rather than preferences. Breaking one is an
architecture decision, not a code review comment — if a change needs one of these to be
false, the decision to make it false comes first, in this document.

1. **The UI never touches the database or the engine.** All browser traffic goes through
   `ouroboros-rest`. *Why:* one boundary means one implementation of authentication,
   tenancy and authorization — and one place to audit them. *Breaking it looks like:* a
   database driver or an engine URL appearing in `ouroboros-ui`.

2. **Flyway owns all DDL.** No application module creates or alters schema. *Why:* two
   things that both believe they own the schema will eventually disagree, and the
   disagreement surfaces in production. It is also why the data layer is Kysely — a query
   builder, not an ORM with migrations of its own (decision **D3**). *Breaking it looks
   like:* a `CREATE TABLE` or an auto-synchronising ORM in `ouroboros-rest`.

3. **The engine is internal.** It is reachable only from `ouroboros-rest`, authenticated
   by a shared secret on `X-Ouro-Internal-Key`. *Why:* the engine executes work; anything
   that can reach it directly bypasses every rule the REST layer enforces. *Breaking it
   looks like:* an engine port published to the host, or a browser call to `/v0/`.

4. **Tenancy is enforced in one place** — the REST layer's tenant-context resolution, with
   database row-level security as later defence in depth
   ([#25](https://github.com/NobuData/ouroboros/issues/25)). *Why:* a tenant check
   re-implemented per controller is a tenant check that will be forgotten in one of them.
   *Breaking it looks like:* a query filtered by a tenant id read straight from a request
   parameter.

## 9. Trust boundaries and secrets

The system has three trust boundaries, and each one has a rule:

| Boundary | Crossed by | Rule |
|---|---|---|
| Browser → REST | Session cookie | The cookie is `httpOnly` and signed; a request without a valid one is anonymous, and `/api/v1` is authenticated by default with explicit opt-outs (health, docs, auth routes) |
| REST → engine | `X-Ouro-Internal-Key` | Constant-time comparison; failure is a 502 to the client and a log line internally — never a 401, and never the engine's address |
| REST → database | Connection string | Parameterised queries only; the tenant predicate comes from the resolved context, never from request input |

Secrets follow one rule each way: **in through the environment, out through nothing.**
They are validated at boot, redacted from any configuration logging, never written into a
committed file, and never sent to the browser. The values in `.env.example` are
placeholders that make a clean checkout run, chosen so that they are obviously not
credentials — `dev-session-secret-change-me` is a value nobody deploys by accident.

Two more properties belong here as they land: the security baseline pass
([#38](https://github.com/NobuData/ouroboros/issues/38) — headers, CORS allow-list, rate
limiting, session revocation) records its threat notes in this document, and row-level
security ([#25](https://github.com/NobuData/ouroboros/issues/25)) adds a fourth row to the
table above when the database stops trusting the application to filter by tenant.

## 10. Keeping this document true

A document that describes a system it no longer matches is worse than no document, so the
parts of this one that a script can check are checked:

```bash
scripts/verify-architecture.sh    # this document's contract
scripts/run-tests.sh              # the tests for that check, and the repo's other tooling
```

[`verify-architecture.sh`](../scripts/verify-architecture.sh) asserts that the required
sections exist, that the diagrams are fenced as `mermaid` so GitHub renders them, that the
port map names every service and port, that the invariants are all stated, that every
relative link resolves to a file in the checkout, and — the acceptance criterion of
[#12](https://github.com/NobuData/ouroboros/issues/12) — that the registry in
[§6.2](#62-the-registry) and [`.env.example`](../.env.example) name exactly the same set
of `OURO_*` variables, so neither can drift behind the other.

What no script can check is whether the prose is still true. That is a review obligation:
**a pull request that changes the shape of the system updates this document in the same
pull request.** Specifically, an issue that scaffolds a module flips its row in the status
table and its section from *specified* to *running*; an issue that adds or removes an
`OURO_*` variable updates the registry; and an issue that changes what may talk to what
amends [§8](#8-architectural-invariants), because that is the section that says it may
not.

| Document | What it covers |
|---|---|
| [`CONVENTIONS.md`](CONVENTIONS.md) | Toolchains, env-var rules, containers, code style, git workflow, CI |
| [`ROADMAP_OUROBOROS_APPLICATION_SCAFFOLDING.md`](ROADMAP_OUROBOROS_APPLICATION_SCAFFOLDING.md) | The plan this repository is executing, issue by issue |
| [`DESIGN_SYSTEM_APP_SHELL.md`](DESIGN_SYSTEM_APP_SHELL.md) | The application shell every screen is built into |
| [`mockups/README.md`](mockups/README.md) | The 22 designed screens and the design system they share |
| [`../README.md`](../README.md) | The repository entry point — module map and getting started |
