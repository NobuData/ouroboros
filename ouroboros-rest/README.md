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
| Tests           | Jest (unit), plus a Supertest suite over a PostgreSQL the run starts for itself — Testcontainers, migrated by Flyway ([#37](https://github.com/NobuData/ouroboros/issues/37)); fast-check for the code view's property and fuzz suites ([#168](https://github.com/NobuData/ouroboros/issues/168))  |
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
| `GET /api/v1/runs/{id}`                             | [The Run Console page](#run-console-reads) (#304): the `RunSummary` row as `run`, plus head, stage timeline, changes, resources and guardrails; another workspace's id is a `404`, never a `403` |
| `GET /api/v1/runs/{id}/events`                      | The transcript's tail past `?after=` (#304): typed entries, `live`, `latestSeq`, `pollAfter`, with `X-Ouro-Poll-After` |
| `GET /api/v1/runs/{id}/transcript.jsonl`            | *Raw JSONL ↗* (#304): the `run_events_jsonl` projection, streamed, opening with `# simulated run` on a simulated run |
| `GET /api/v1/queue`                                 | The ordered queue (#73) — `position` ascending, optional `repo` filter, `totalEstMinutes` equal to the stat row's own sum |
| `GET PATCH /api/v1/policies/dry-run`                | [The dry-run policy](#the-dry-run-policy) (#382) — read by any member, flipped by `owner`/`admin`, audited `policy.dry_run_changed` |
| `GET POST /api/v1/policies` · `POST …/preview`      | [The org policy document](#the-org-policy-document) (#481) — read by any member; preview and publish `owner`/`admin`, a loosening `owner` only; audited `policy.published` |
| `GET /api/v1/insights`                             | [The Insights page](#insights-page) (#438) — `?range=7d\|30d\|90d` (`30d` when absent), optional `?repo=owner/name`; head, KPIs, series, bar cards with computed lines, performance, flaky, scoreboard, DORA and the rollups' freshness (#447) in one payload; any member |
| `GET /api/v1/insights/digest`                      | [The weekly email digest](#email-digest) (#440) — the caller's subscription, the workspace's weekly slot (UTC) with `nextRunAt`, and `mail.transport` (`smtp`, or `none` when no mail server is configured); any member |
| `PUT /api/v1/insights/digest/subscription`         | Opt yourself in or out of this workspace's digest (#440) — `{subscribed}`; `409 insights_digest_mail_unconfigured` when subscribing on a deployment that sends no mail; any member |
| `PATCH /api/v1/insights/digest/schedule`           | Move the workspace's weekly slot (#440) — `{weeklyDay?, weeklyTime?}`, ISO day 1–7 and `HH:MM` UTC; `owner`/`admin` |
| `GET /api/v1/insights/digest/preview`              | The digest as it would be sent now (#440) — `{subject, html, text, window, contentVersion}`; any member |
| `GET POST /api/v1/insights/digest/unsubscribe/{token}` | A digest's unsubscribe link (#440) — **no session**; `GET` renders a confirmation and changes nothing, `POST` unsubscribes; HTML, with a `404` page for a link no mail carried |
| `GET /api/v1/insights/calibration`                 | [Estimator calibration](#estimator-calibration) (#435) — `?window=7d\|30d\|90d`; within-band headline, unestimated count and per-effort bias direction; any member |
| `GET /api/v1/insights/interventions`               | [Intervention causes](#intervention-causes) (#445) — `?range=7d\|30d\|90d&cause=`; the events behind the interventions card's bars, newest first, at most 50, with `total`; any member |
| `POST /api/v1/insights/interventions/{id}/recategorize` | [Intervention causes](#intervention-causes) (#434) — a person's cause with a reason, audited in `intervention_overrides`; never overwritten by a rule run; re-fills the event's day (#445); `owner`/`admin`/`member` |
| `POST /api/v1/analyzer/runs`                       | [Build Analyzer runs](#build-analyzer-runs) (#510) — *Run analysis now*: `{repo}`; `202` with the run `running` in `assembling`; `409 analysis_already_running` naming the run that is; audited `analyzer.run_requested`; `owner`/`admin` |
| `GET /api/v1/analyzer/runs/latest`                 | [Build Analyzer runs](#build-analyzer-runs) (#510) — `?repo=owner/name`; the newest run or `{run: null}`; any member |
| `GET /api/v1/analyzer/runs/{id}`                   | [Build Analyzer runs](#build-analyzer-runs) (#510) — status, phase, per-analyzer progress, corpus manifest; any member |
| `GET PUT /api/v1/analyzer/schedule`                | [Build Analyzer runs](#build-analyzer-runs) (#516) — `?repo=owner/name`; the weekly slot, every-N threshold with the live `buildCounter`, and budgets; read by any member, saved whole by `owner`/`admin`, audited `analyzer.schedule_updated` |
| `GET /api/v1/analyzer/duration`                    | [Build Analyzer runs](#build-analyzer-runs) (#517) — `?repo=owner/name`; the newest annotated run's daily-median duration series and its change-points — ranked candidates with scores, attribution window, confidence basis, evidence resolved to the farm, a PR or a workflow; any member |
| `GET /api/v1/analyzer/suggestions`                 | [Build Analyzer runs](#build-analyzer-runs) (#518) — `?repo=owner/name`; the build-process and workflow suggestions still current, in every status, each with its confidence and impact bases, the measurement its apply opened and the findings it cites with their evidence resolved; plus the calibration cells; any member |
| `GET /api/v1/analyzer/tickets`                     | [Build Analyzer runs](#build-analyzer-runs) (#519) — `?repo=owner/name`; the drafted-tickets card: the ticket suggestions nobody has drafted yet, and the planning batches the rest were drafted into — each batch as planning answers it, with the evidence every draft's body states, resolved; any member |
| `GET PATCH /api/v1/settings/auto-merge`             | The auto-merge switch (#74) — read by any member, flipped by `owner`/`admin` only; the dashboard's one write |
| `GET PATCH /api/v1/settings/workspace`              | [The workspace card](#the-workspace-card) (#483) — name and tenant domain, read by any member, saved by `owner`/`admin`; region and training data as deployment truth |
| `GET /api/v1/settings/members`                     | [Members, capabilities & service accounts](#members-capabilities--service-accounts) (#485) — S3 display roles, `canApproveLoops`, last active, pending invitations, `Service` rows and the footer; any member, people only |
| `POST DELETE /api/v1/settings/members/invitations…` | Invite, resend (`…/{id}/resend`) and revoke through the organization plugin; `owner`/`admin`; audited `member.invited \| invitation_resent \| invitation_revoked` |
| `PATCH DELETE /api/v1/settings/members/{memberId}`  | Role and/or `canApproveLoops`; remove. The last owner is `409 owner_protected` (audited); `owner`/`admin` |
| `GET POST /api/v1/settings/service-accounts`       | List (tokens masked) and create (token shown once); `/{id}/rotate` and `/{id}/revoke`; `owner`/`admin`; audited `service_account.*` |
| `GET /api/v1/settings/audit`                       | [The audit log](#the-audit-log) (#486) — keyset-paged events filtered by time, actor kind, person, service, plane/action and reference; each with its composed `actor` and `event`; `owner`/`admin` |
| `GET /api/v1/settings/audit/today`                 | The Audit Log card's `time · actor · event` lines for today in `?tz=`, and `retainedDays`; `owner`/`admin` |
| `GET /api/v1/settings/audit/export.csv`            | The filtered view as a streamed CSV over a required range of at most 366 days; audited `audit.exported` before the first byte; `owner`/`admin` |
| `GET POST /api/v1/settings/webhooks`               | [Outbound webhooks](#outbound-webhooks) (#487) — endpoints with health, counted `activeCount`, derived `siem` row and the event registry; create answers with the signing secret once; `owner`/`admin` |
| `GET PATCH DELETE /api/v1/settings/webhooks/{id}…` | Read, edit/enable/disable, delete; `/rotate-secret` (secret once), `/ping` (a logged test delivery), `/deliveries?status=` (the log; `dead_lettered` is the DLQ), `/deliveries/{deliveryId}/redeliver`; `owner`/`admin`; audited `webhook.*` |
| `GET PATCH /api/v1/onboarding`                      | [The Get Started wizard](#the-onboarding-wizard-api) (#385) — `?repo=owner/name`; steps derived from subsystem truth, choices stored; any member may dismiss |
| `POST /api/v1/onboarding/complete-step`             | Complete a step, guarded — `409 onboarding_step_incomplete` with the stated reason unless it is done in reality |
| `POST /api/v1/onboarding/skip`                      | *I've done this before* — marks the wizard bypassed, answers `/settings`; imports nothing (BD.3, #398) |
| `GET /api/v1/onboarding/surfacing`                  | The fresh-org rule with no repository named (#390) — `{offer, reason}`, what the dashboard's *Get started* banner reads; any member |
| `GET /api/v1/onboarding/detection`                  | [The detection card](#repository-detection) (#384) — the newest scan's rows, evidence, `detected \| measured` label and progress |
| `GET /api/v1/onboarding/detection/scans/{scanSeq}`  | One earlier scan, as stored — re-scans version by `scan_seq` |
| `POST /api/v1/onboarding/detection/scan`            | `202` — scan (or join the running scan); debounced 30 s, `409 detection_rescan_too_soon` |
| `PUT /api/v1/onboarding/detection/protected-paths`  | Owner/admin — save the protected-path list (#391); scans stop suggesting; `422 detection_glob_invalid` |
| `GET /api/v1/onboarding/first-issue`                | [The safe first issue](#the-safe-first-issue-picker) (#387) — a scored, explained pick; cold states answered honestly |
| `GET /api/v1/onboarding/first-issue/alternatives`   | *Or pick your own* — the qualifying backlog, safest first, each with its own reasoning (`?limit=` 1–50) |
| `GET /api/v1/onboarding/defaults`                   | [The right column](#the-first-run-launcher-and-smart-defaults) (#388) — Smart Defaults rows by declared deployment capability, reassure claims with their mechanisms, the projected timeline |
| `POST /api/v1/onboarding/launch`                    | *Run my first loop* (#388) — guarded; queues the pick with the instantiated workflow pinned, completes the wizard, answers the receipt |
| `GET POST /api/v1/workflows`                        | [The workflow lifecycle](#the-workflow-lifecycle-api) (#134) — the rail with P.4's captions; **+ New workflow** |
| `GET PATCH /api/v1/workflows/{id}`                  | One workflow, its draft and one version (`?version=` for history); rename, pause or archive |
| `PUT /api/v1/workflows/{id}/draft`                  | The canvas's autosave, guarded by an `If-Match` draft etag — a stale one is a `409`, never an overwrite |
| `POST /api/v1/workflows/{id}/publish`               | The next immutable version, behind the zod **and** engine validators; a finding is a `422` and nothing is written |
| `GET /api/v1/workflows/{id}/versions`               | The version history, newest first, without the documents |
| `GET /api/v1/workflows/catalog`                     | [The stage catalog](#the-stage-catalog) (#145) — every node type's glyph, class, config schema and defaults, and advisory skill and task-route suggestions |
| `GET POST /api/v1/skills`                           | [Skills](#skills) (#410) — the registry; **+ New skill** as a draft |
| `…/skills/{slug}` · `…/draft` · `…/publish`         | Read, switch/lock (`required` owner-only; disabling it is the designed `403`), guarded delete; draft-save and publish |
| `…/skills/{slug}/scope/preview` · `…/scope` · `…/code` · `/skills/stats` | Scope moves with a conflict preview; the code view's `skills/*.skill.md`; Used-by over a stated window |
| `GET POST /api/v1/facts` · `/facts/needs-you` · `/facts/sweep` | [The fact lifecycle](#fact-lifecycle-and-the-staleness-sweep) (#411) — the learned-facts card, a manual proposal, the `fact_review` feed, an on-demand staleness sweep |
| `…/facts/{factId}` · `…/confirm` · `…/reject` · `…/reconfirm` · `…/expire` · `…/relearn` · `…/anchors` | One fact and its audit; the K3 transitions (member+, actor recorded); anchor add/remove |
| `GET /api/v1/fact-proposers` · `…/suppressions` · `POST …/backfill` | [Deterministic fact proposers](#deterministic-fact-proposers) (#412) — the registry, the dedupe record, every proposer over one run's sources |
| `POST /api/v1/knowledge/import/preview` · `…/apply` | [Rule-file import](#rule-file-import) (#413) — `CLAUDE.md` / `AGENTS.md` / `.cursorrules` / Copilot instructions → draft skills and proposed facts, previewed then applied exactly |
| `POST /api/v1/knowledge/context/preview` · `…/injections` | [Context assembly](#context-assembly-and-manifests) (#414) — the what-would-inject manifest (closest scope wins, required locked on, trims recorded); a consumer's injection record |
| `GET POST /api/v1/sources`                          | [Ticket sources](#pluggable-ticket-sources) (#141) — the workspace's list with masks, never values; add one, checked against its kind's schema |
| `GET /api/v1/sources/catalog`                       | Every registered kind as the form it takes — `configSchema()` rendered to fields — plus its capabilities |
| `GET PATCH /api/v1/sources/{id}`                    | One source; rename, change its settings, pause or resume it — `owner`/`admin` only |
| `POST /api/v1/sources/{id}/credentials`             | Store a credential — write-only; the answer carries the mask                        |
| `POST /api/v1/sources/{id}/test`                    | `validateConfig` over the stored settings and the opened credential; writes nothing |
| `POST /api/v1/sources/{id}/sync`                    | One source, now — `202`, or a `409` for paused, running, or sooner than 30s |
| `GET /api/v1/sources/{id}/status`                   | The row plus the loop's memory: `running`, `retryAfterSeconds`, the last cycle's counts |
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
| `OURO_GITHUB_API_BASE_URL`  | Where GitHub's REST API is — a GitHub Enterprise Server installation, or the e2e suite's sandbox tracker ([#288](https://github.com/NobuData/ouroboros/issues/288)). Moves the address and nothing else | no — `https://api.github.com` | an absolute `http://` or `https://` URL, such as `https://ghe.example.com/api/v3`            |
| `OURO_VAULT_MASTER_KEY`     | The credential vault's key-encryption key — see [The vault](#the-vault) |        yes         | **exactly** 32 bytes, base64 (`openssl rand -base64 32`)                    |
| `OURO_CORS_ORIGINS`         | Browser origins allowed to call the API with credentials |        yes         | comma-separated origins — scheme, host, optional port; no path, no wildcard |
| `OURO_DASHBOARD_POLL_SECONDS` | Seconds sent as `X-Ouro-Poll-After` on dashboard answers — raise it to slow every poller under load |      no — 15       | a whole number of seconds, 1–3600                                           |
| `OURO_LISTEN_HOST`          | Bind-interface override — set only by the e2e stack ([#647](https://github.com/NobuData/ouroboros/issues/647)); unset, `NODE_ENV` decides as always |     no — unset     | exactly `127.0.0.1` or `0.0.0.0`                                            |
| `OURO_FARM_CLIENT_CERT_HEADER` | The header a **trusted** reverse proxy forwards a runner's TLS client certificate in ([#250](https://github.com/NobuData/ouroboros/issues/250)). Unset, the certificate is read from the TLS socket and from nowhere else — see [The build farm's identity layer](#the-build-farms-identity-layer). Set it only when something in front of this service terminates TLS, and strip the header at the edge: a certificate is public, so a header trusted unconditionally is an impersonation of any runner |     no — unset     | an HTTP field name, such as `x-ouro-client-cert`                            |
| `OURO_FARM_MIN_AGENT_VERSION` | The oldest `ouroboros-runner` build the [agent gateway](#the-agent-gateway) accepts ([#251](https://github.com/NobuData/ouroboros/issues/251)) — a `hello` below it is refused with `version.below_minimum` and a sentence naming the floor, and the agent exits rather than reconnecting. Compared by SemVer precedence; the template's `0.0.0-0` admits every build |     no — unset     | a semantic version, such as `0.2.0`                                         |
| `OURO_FARM_PUBLIC_URL` | The https origin runner machines reach this deployment at — what [the runner installer](#the-runner-installer) writes into `/install.sh` as the agent's `--server` ([#248](https://github.com/NobuData/ouroboros/issues/248)). Unset, `OURO_REST_URL` is used when it is https |     no — unset     | an https origin, such as `https://ouroboros.acme.dev`                       |
| `OURO_FARM_RELEASES_DIR` | Where [the runner installer](#the-runner-installer) serves `ouroboros-runner` releases from — one directory per version, as `make release` writes them ([#248](https://github.com/NobuData/ouroboros/issues/248)). Unset, no installer is served |     no — unset     | a directory, such as `../ouroboros-runner/dist`                             |
| `OURO_FARM_LOG_BUDGET_BYTES` | The bytes of finished builds' logs one workspace keeps — [build logs](#build-logs)' retention sweep removes the oldest finished jobs' logs, whole, until a workspace is under it ([#253](https://github.com/NobuData/ouroboros/issues/253)) |     no — `2147483648`     | a whole number of bytes, 1 MiB to 1 TiB |
| `OURO_ARTIFACT_STORE` | Which driver keeps [build artifacts](#build-artifacts) ([#330](https://github.com/NobuData/ouroboros/issues/330)): the local volume, or any S3-compatible store (S3 or MinIO). The swap is configuration only |     no — `local`     | `local` or `s3` |
| `OURO_ARTIFACT_DIR` | The local volume's directory, resolved against the working directory — `/app/.artifacts` in the image, which its user owns and a deployment mounts a volume at |     no — `.artifacts`     | a path |
| `OURO_ARTIFACT_S3_ENDPOINT` | The S3-compatible endpoint, addressed path-style |     with `s3`     | an http(s) origin, no path |
| `OURO_ARTIFACT_S3_BUCKET` | The bucket — which must already exist |     with `s3`     | an S3 bucket name |
| `OURO_ARTIFACT_S3_REGION` | The region S3 requests are SigV4-signed for |     no — `us-east-1`     | a region name |
| `OURO_ARTIFACT_S3_ACCESS_KEY_ID` | The S3 access key id |     with `s3`     | a string |
| `OURO_ARTIFACT_S3_SECRET_ACCESS_KEY` | The S3 secret access key — **redacted** from the boot log |     with `s3`     | a string |
| `OURO_ARTIFACT_QUOTA_BYTES` | Live artifact bytes one workspace keeps; a file past it is skipped with a job **warning**, never a failure |     no — `10737418240`     | 1 KiB to 1 PiB |
| `OURO_ARTIFACT_MAX_FILE_BYTES` | The per-file cap each offer carries; larger files are sent cut to it, as truncated |     no — `67108864`     | 1 KiB to 64 GiB |
| `OURO_ARTIFACT_MAX_JOB_BYTES` | The per-job cap each offer carries; files past it are listed as skipped |     no — `268435456`     | at least the per-file cap, ≤ 64 GiB |
| `OURO_ARTIFACT_RETENTION_DAYS` | Days an artifact is kept in a workspace with no `artifacts` [retention tier](#data-retention) of its own |     no — `30`     | 1–3650 |
| `OURO_LOCAL_PROVIDER_URLS`  | Where this deployment's **local** model providers are — what a worker is told by the [internal surface](#the-internal-surface) ([#224](https://github.com/NobuData/ouroboros/issues/224)) |     no — unset     | comma-separated `kind=url` pairs; `ollama` and `openai_compatible` only, each an absolute `http(s)` URL |
| `OURO_PROVIDER_HEALTH_INTERVAL_SECONDS` | Seconds between [provider health](#provider-health) sweeps, and the age at which a local provider's last check is stale ([#196](https://github.com/NobuData/ouroboros/issues/196)) — jittered ±25% |      no — 60       | a whole number of seconds, 10–86400 |
| `OURO_PROVIDER_HEALTH_KEY_CHECK_SECONDS` | Seconds before a cloud provider's key validation is redone — deliberately much slower, because it asks a vendor rather than the operator's own machine |     no — 900      | a whole number of seconds, 60–86400 |
| `OURO_BACKLOG_SYNC_INTERVAL_SECONDS` | Seconds between [backlog sync](#the-backlog-sync) cycles ([#102](https://github.com/NobuData/ouroboros/issues/102)) — jittered ±25%, and what the intake page's freshness tag counts from. Since [#139](https://github.com/NobuData/ouroboros/issues/139) the [ticket-source loop](#pluggable-ticket-sources) shares it: one knob for *how often does Ouroboros ask a tracker what changed*, for the one release in which two loops ask it |     no — 300      | a whole number of seconds, 60–86400 |
| `OURO_ESTIMATION_CONCURRENCY` | How many issues the [estimation pipeline](#the-estimation-pipeline) sizes at once ([#107](https://github.com/NobuData/ouroboros/issues/107)) — the bound on outbound engine calls for sizing |      no — 4       | a whole number, 1–32 |
| `OURO_ESTIMATION_CONFIDENCE_FLOOR` | Below what confidence an estimate sends its issue to `needs_human` — this service's policy, defaulted to the engine's own published floor |      no — 70      | a whole number, 0–100 |
| `OURO_ESTIMATION_STALE_SECONDS` | How long an issue may sit in `estimating` before the recovery sweep re-queues it — a restart mid-flight is the case it exists for |     no — 600      | a whole number of seconds, 60–86400 |
| `OURO_ESTIMATION_SWEEP_INTERVAL_SECONDS` | Seconds between recovery sweeps — jittered ±25%, and one indexed query against this deployment's own database |     no — 120      | a whole number of seconds, 10–86400 |
| `OURO_RUN_CONTROL_TTL_SECONDS` | How long a pause, resume or abort is worth delivering before it is [expired](#run-controls) ([#306](https://github.com/NobuData/ouroboros/issues/306)) |     no — 120      | a whole number of seconds, 10–3600 |
| `OURO_RUN_STEER_TTL_SECONDS` | How long a steer is worth delivering — longer, because it lands at the executor's next point of context injection |     no — 300      | a whole number of seconds, 10–3600 |
| `OURO_RUN_CONTROL_SWEEP_SECONDS` | Seconds between control-expiry sweeps — jittered ±25%; the routes sweep their own run first, so this decides only how soon an expiry is audited for a run nobody is watching |     no — 15       | a whole number of seconds, 5–3600 |
| `OURO_LIFECYCLE_PURGE_SWEEP_SECONDS` | Seconds between [workspace-purge](#workspace-lifecycle) sweeps — jittered ±25%; a workspace past its 30-day recovery window is purged on the next one ([#489](https://github.com/NobuData/ouroboros/issues/489)) |    no — 3600      | a whole number of seconds, 60–86400 |
| `OURO_WEBHOOK_DISPATCH_SECONDS` | Seconds between [webhook dispatcher](#outbound-webhooks) ticks — jittered ±25%; the delay between an event and its first attempt ([#487](https://github.com/NobuData/ouroboros/issues/487)) | no — 5 | a whole number of seconds, 1–300 |
| `OURO_WEBHOOK_MAX_ATTEMPTS` | Attempts a [webhook delivery](#outbound-webhooks) gets before it is dead-lettered ([#487](https://github.com/NobuData/ouroboros/issues/487)) | no — 5 | a whole number, 1–20 |
| `OURO_WEBHOOK_INTERNAL_ALLOWLIST` | Internal collectors a [webhook](#outbound-webhooks) may reach despite the SSRF policy ([#487](https://github.com/NobuData/ouroboros/issues/487)) | no — empty | comma-separated hostnames, addresses or CIDR blocks |
| `OURO_BACKLOG_STALE_DAYS` | Days without a tracker update after which an open ticket counts as stale on the [Backlog Health card](#backlog-health-and-nightly-re-estimation) ([#281](https://github.com/NobuData/ouroboros/issues/281)) |      no — 30      | a whole number of days, 1–3650 |
| `OURO_REESTIMATION_HOUR_UTC` | The UTC hour the [nightly re-estimation job](#backlog-health-and-nightly-re-estimation) is scheduled at |      no — 2       | a whole number, 0–23 |
| `OURO_REESTIMATION_JITTER_MINUTES` | The window after that hour a night's run is jittered across, so installations do not all run on the hour |      no — 30      | a whole number of minutes, 1–180 |
| `OURO_REESTIMATION_BATCH` | The most unsized tickets one night's run queues, across every workspace — the job's bound |     no — 100      | a whole number, 1–1000 |
| `OURO_FLAKE_RESCORE_HOUR_UTC` | The UTC hour the [nightly flake re-scorer](#flake-scorer) is scheduled at; each pass lands at a random minute in the hour after it ([#331](https://github.com/NobuData/ouroboros/issues/331)) |      no — 3       | a whole number, 0–23 |
| `OURO_FLAKE_RESCORE_CAP` | The most cases one workspace's nightly flake re-score covers, least recently scored first — the job's bound |     no — 2000     | a whole number, 1–100000 |
| `OURO_FACT_SWEEP_HOUR_UTC` | The UTC hour the [nightly fact staleness sweep](#fact-lifecycle-and-the-staleness-sweep) is scheduled at; each pass lands at a random minute in the hour after it ([#411](https://github.com/NobuData/ouroboros/issues/411)) |      no — 4       | a whole number, 0–23 |
| `OURO_INSIGHTS_ROLLUP_INTERVAL_SECONDS` | Seconds between [Insights rollup](#insights-rollups) ticks — jittered ±25%; each re-fills today and steps any backfill ([#433](https://github.com/NobuData/ouroboros/issues/433)) | no — 3600 | a whole number of seconds, 60–86400 |
| `OURO_INSIGHTS_ROLLUP_CONSOLIDATE_DAYS` | Days, ending yesterday, the first tick of a UTC day re-fills so late data reaches its day | no — 3 | a whole number of days, 1–31 |
| `OURO_INSIGHTS_ROLLUP_BACKFILL_DAYS` | How far back a family's first fill reaches; also the furthest any consolidation reaches | no — 90 | a whole number of days, 1–730 |
| `OURO_INSIGHTS_ROLLUP_DAYS_PER_TICK` | Most backfill days one tick fills per family; the next tick resumes at the cursor | no — 31 | a whole number of days, 1–366 |
| `OURO_SMTP_URL` | The SMTP server [mail](#mail) is sent through ([#440](https://github.com/NobuData/ouroboros/issues/440)); unset, this deployment sends no mail and the [weekly digest](#email-digest) is off |     no — unset     | `smtp://host:port` or `smtps://user:password@host:port` |
| `OURO_MAIL_FROM` | The address mail is sent from; it goes out as *Ouroboros* | with `OURO_SMTP_URL` | a bare address — no display name; refused without `OURO_SMTP_URL` |
| `OURO_INSIGHTS_DIGEST_INTERVAL_SECONDS` | Seconds between checks for a workspace whose [weekly digest](#email-digest) slot has come due — jittered ±25% | no — 300 | a whole number of seconds, 5–3600 |
| `OURO_REPO_MAP_HOUR_UTC` | The UTC hour the [nightly repo-map generator](#playbooks-and-the-repo-map-generator) is scheduled at; each pass lands at a random minute in the hour after it ([#415](https://github.com/NobuData/ouroboros/issues/415)) |      no — 5       | a whole number, 0–23 |
| `OURO_ONBOARDING_UNLOCK_THRESHOLD` | The merged-loop count that unlocks an advanced [onboarding template tile](#template-tiles-and-instantiation) ([#386](https://github.com/NobuData/ouroboros/issues/386)), replacing each template's own rule |     no — unset     | a whole number, 0–10000; `0` unlocks every tier |
| `OURO_MANAGED_KEY_POOL` | Whether this deployment declares a managed key pool — selects the [Smart Defaults](#the-first-run-launcher-and-smart-defaults) models row ([#388](https://github.com/NobuData/ouroboros/issues/388)) |     no — false     | `true` or `false` |
| `OURO_MANAGED_KEY_TRIAL_CENTS` | The trial credit the managed key pool gives a new workspace, printed on the managed row; unset, the row names no figure |     no — unset     | whole cents, 1–1000000; refused unless `OURO_MANAGED_KEY_POOL` is `true` |
| `OURO_HOSTED_RUNNER_POOL` | Whether this deployment declares a hosted runner pool — selects the Smart Defaults build row ([#388](https://github.com/NobuData/ouroboros/issues/388)) |     no — false     | `true` or `false` |
| `OURO_DATA_REGION` | Where this deployment keeps its data, shown read-only on [the workspace card](#the-workspace-card) ([#483](https://github.com/NobuData/ouroboros/issues/483)); a label that moves nothing |     no — unset     | up to 64 of letters, digits, `. _ : / ( ) -`; no spaces; unset reads `self-hosted` |

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
calendar day, hashed. That is what a `304` costs — seven aggregate subqueries returning no
rows (runs, queue, token usage, settings, and since #437 the PR plane, intervention events and
the rollup bookkeeping the shared metrics are read from) — and it is why the poll loop is cheap. The day is in the hash because two of the
payload's numbers are calendar facts that change at midnight with no row having moved.
The rest of the contract — the 15-second visible-tab interval, the `X-Ouro-Poll-After`
backoff hint every answer carries, and the SSE upgrade path — is
[`docs/ARCHITECTURE.md` § 5.4](../docs/ARCHITECTURE.md#54-the-polling-contract)
([#75](https://github.com/NobuData/ouroboros/issues/75)).

**Every window is published, because a number whose definition is not written down is a
number a screen renders under the wrong label.** The pulse meters, *PRs merged · 7d* and *since
this morning* are not computed here: they are [windowed metrics](#windowed-metrics-service)
(#437, decision I1) — the registry's `merge_rate`, `cycle_time` (a median), `human_interventions`
and `merged_prs` over the last seven **UTC days**, today included — so the dashboard and the
Insights page cannot disagree. The day's token spend is measured from **midnight UTC**, the day
`token_usage_daily` is keyed by. `openapi.yaml`'s `LoopPulse` carries each definition, and
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
controller at all** until mockup 21 arrived; CH.2
([#585](https://github.com/NobuData/ouroboros/issues/585)) added a *read*, CH.1
([#584](https://github.com/NobuData/ouroboros/issues/584)) is the alias CRUD, CH.4
([#587](https://github.com/NobuData/ouroboros/issues/587)) is the import wizard, and
`registry.module.spec.ts` asserts the controller list so a fourth entry has to be stated out
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

### Import from provider

**Forty models, curated names, one transaction** (CH.4,
[#587](https://github.com/NobuData/ouroboros/issues/587)). Mockup 21's head has two buttons and
this is the other one: bulk alias creation from what discovery found, where humans still choose
the names.

```
GET  /api/v1/registry/import/{connectionId}/candidates
  ─▶ [✓ aliased: coder-max] claude-fable-5
     [ ] claude-opus-5   → "opus-5"   $10 · $50   thinking · 1M ctx
     [✓ aliased: sizer]   claude-haiku-4-5
POST /api/v1/registry/import {connectionId, items: [{modelId, alias, params?}]}
  ─▶ tx: validate all ─▶ create all, enabled          │ 422 itemized · create none
  ─▶ re-run ─▶ skips what is already aliased, and reports what it skipped
```

**Import never invents a model** — decision **R7**, and the one rule that makes a bulk path
safe. The candidate rows are `provider_models` and nothing else, and an item naming a model
discovery has not reported is refused per item. This is deliberately *stricter* than
`POST /registry/aliases`, which warns and saves: one alias typed by somebody who knows what
they are doing may well be valid during a discovery gap, and forty pasted ones are the typo
class the registry exists to remove.

**There is no import-all.** Auto-creating an alias per discovered model floods the registry
with names nothing routes to and makes the page's own caption false, so `selected` is a
*suggestion* — false for a model that already has an alias, and false when no name could be
offered — and the service creates what the request names.

**Names are suggested, not decided.** The template drops the leading segment every model of a
connection shares — derived from the catalog rather than from a table of vendor names, so
`claude-opus-5` becomes `opus-5` while an Ollama box's `qwen3-coder:32b`, `llama4:scout` and
`phi4:14b` keep theirs — folds the rest into V015's shape, and suffixes `-2`, `-3` … past
every name the workspace has *and* every suggestion above it in the same list. A name that
cannot be made to fit is `null` and an empty cell, never a truncation nobody chose.

**Nothing partial is ever committed.** Every item is checked before the transaction opens, and
a batch with anything wrong in it is a `422 model_import_invalid` whose `details.items` is
keyed by request position — the same contract `PUT /routing/routes` publishes, deliberately, so
a client learns one batch shape rather than two. Seven aliases created and a refusal on the
eighth leaves somebody reconciling by hand.

**Re-running is safe and says what it meant.** A model that already has an alias on the
connection is skipped *before* it is validated — so the name the last run created is never
checked against itself — and the answer's `skipped` names the alias that was already there.
Imported aliases arrive **switched on**, which is the deliberate opposite of duplicate's
off-default: every row is bound to a connection the operator just chose and was ticked by hand,
and forty aliases that then have to be enabled one at a time would make the wizard a way of
generating work.

**The preview is CH.2's and CH.3's, consumed rather than re-derived.** Each row carries the
price `GET /registry/prices` would resolve, rendered by the same function — so a local model
reads `$0` and an uncovered one reads `—`, never the other way round — and a capability
headline projected from the same merged schema the inspector's form is drawn from. Asking
about a whole connection costs a fixed handful of statements rather than two per model:
`ParamSchemaService.forModels` resolves the adapter once and batches both metadata reads.

### Resolution snapshots

**What routing decided for a run, kept** (CH.6, [#589](https://github.com/NobuData/ouroboros/issues/589),
decision **R9**). Mockup 21's chain card promises *every hop is inspectable in the run console
transcript*, and that is a promise about stored truth: a card that re-ran `resolve()` whenever it
rendered would print today's health beside last week's run number. So the card reads V024's
`resolution_snapshots` — `src/modules/registry/resolutions.*.ts`, member read.

```
GET /api/v1/registry/resolutions/latest?alias=coder-max
 ─▶ { alias: coder-max,
      snapshot: { shapeVersion: 1, run: {issueNumber: 482}, taskKind: implement, routeTag: implement-primary,
                  outcome: resolved, durationMs: 42, resolvedHopIndex: 1,
                  chain: [ {alias: coder-max, modelId: claude-fable-5, provider: {displayName: Anthropic Claude, keySuffix: Xq4A}, decision: kept, durationMs: 42},
                           {alias: coder-fallback, decision: dropped, code: provider_error, explanation: "Fallback 1 dropped — …"}, … ],
                  rules: [], resolvedAt } }
```

**Latest is by containment**, `chain @> '[{"alias": …}]'` over V024's GIN index, newest first with
the id breaking a millisecond tie — and a hop counts whether it was kept or dropped, because an alias
that has been skipped for a week is what somebody inspecting it needs to see. **`snapshot: null` is
an answer**: no run here has resolved through the alias, and the card renders a Simulate preview
labelled as one rather than a fabricated run.

**The writer's contract is `routing/snapshot.ts`.** `snapshotOf(resolution, measurements)` builds
the row's versioned document from a `Resolution` plus what only execution knows — the masked key
suffix and each tried hop's timing — and refuses what V024's CHECKs refuse (a whole key where the
suffix belongs, a timing on a dropped hop) with a `RangeError` naming the hop. The chain executor
([#235](https://github.com/NobuData/ouroboros/issues/235)) and the workflow bridge
([#160](https://github.com/NobuData/ouroboros/issues/160)) write through it; until they land, the
dev seed's run #482 is the one stored snapshot. The consumers are the chain card
([#595](https://github.com/NobuData/ouroboros/issues/595)) and the run console
([#304](https://github.com/NobuData/ouroboros/issues/304), [#312](https://github.com/NobuData/ouroboros/issues/312)).

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

**The one check that arrives from outside the sweep is written through this module all the
same** ([#230](https://github.com/NobuData/ouroboros/issues/230)). Mockup 07's **Test
connection** is an administrator's press of a button, goes through the adapter's own
`validate` — a models-list or a version ping, the same class of call the sweep makes and never
a completion (decision **P9**) — and is admitted by the lifecycle's role gate rather than by
anything here. What it owes this module is the write: `ProviderHealthService.recordValidation`
merges the answer into the same column with the same `mergeHealth`, under the same check name
the table gives the kind, so the strip and the card's pill are one measurement. It adds one
probe key the sweep never writes — `error_class`, the taxonomy's word for *why* — which is what
lets a card draw `degraded upstream` after a reload and what the next sweep clears again.

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
| an operator switched the alias off | `alias_disabled`      |
| a `route_local` rule fired         | `rule_route_local`    |
| the route allows no local models   | `local_not_allowed`   |
| an operator paused the provider    | `provider_paused`     |
| a check found the provider unusable| `provider_error`      |

Policy is tested before health, deliberately: a hop the route's own configuration excludes is
not in play whatever a provider is doing, and an operator asking *why is hop 3 not being used*
should be told about the floor they set rather than about a latency that would not have
mattered.

**A switched-off or unbound alias is a dropped hop, never a failed run on its own** (CH.6,
[#589](https://github.com/NobuData/ouroboros/issues/589)). The sentences say which —
*Fallback 1 dropped — coder-std: alias disabled by Ken Suenobu 2026-08-01.*, the actor and day
from `model_aliases.updated_by`/`updated_at`, or *…: alias unbound — no provider.* The switch is
tested *after* the floor, so a breach counts exactly the hops it always did; a rule naming a
switched-off alias is `alias_disabled` too, and neither moves a primary nor adds a vote.

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
finds. The routes over it are the lifecycle's — `POST` and `GET /api/v1/providers/{id}/pulls`
([#230](https://github.com/NobuData/ouroboros/issues/230)), which resolve the connection for
the session's workspace and hand the tracker a thunk that opens the stream *when the pull
starts*; this module still declares no controller.

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
GET    /api/v1/providers/catalog    the registry, as forms + capabilities — one entry per kind · every member
GET    /api/v1/providers/spend      the UTC calendar month's spend per kind — the cards' meters · every member
POST   /api/v1/providers            schema ─▶ live validate ─▶ seal ─▶ store   ✗ = nothing stored
GET    /api/v1/providers            ••••Xq4A + the adder's name, computed server-side · every member
GET    /api/v1/providers/{id}       the same, for one
POST   /api/v1/providers/{id}/reveal   rate limit ─▶ step-up ─▶ open ─▶ audit · no-store
POST   /api/v1/providers/{id}/rotate   validate NEW ─▶ one conditional UPDATE ─▶ old retired
PATCH  /api/v1/providers/{id}       switch · cap · note · address (validated like an add)
DELETE /api/v1/providers/{id}       409 while aliases resolve on it, naming them
POST   /api/v1/providers/{id}/test      adapter.validate ─▶ 200 whatever it said ─▶ Z.3 snapshot · audit
GET    /api/v1/providers/{id}/models    the discovered catalog + the aliases it stranded · every member
POST   /api/v1/providers/{id}/discover  adapter.discoverModels ─▶ V017 upsert + delete ─▶ added/removed
POST   /api/v1/providers/{id}/pulls     202 · running or queued · one active pull per connection
GET    /api/v1/providers/{id}/pulls     the tracker's records · no-store · every member
```

**The catalog is the registry crossing the wire** ([#231](https://github.com/NobuData/ouroboros/issues/231)).
`GET /api/v1/providers/catalog` answers one entry per registered kind — the schema's `title`
and the fields `provider.forms.ts` derives from it — so mockup 07's **Browse catalog** draws
its tiles from what this build can actually connect, and a new adapter is in the catalog the
day it is registered. `src/modules/provider-connections/catalog.ts` is one total function over
the registry with no provider kind in it, and its spec registers the conformance kit's fake
under `custom` to prove the point. Since AE.2 ([#228](https://github.com/NobuData/ouroboros/issues/228))
each entry also carries the adapter's own `capabilities()`, unchanged: the provider card is
composed from the same two answers the SPI gives core code — the fields decide the key row,
`pull` decides whether the models region is chips or Ollama's pull-list — and the card lives
where neither the registry nor an adapter can be reached.

**The cards' meters are the routing card's statement over a different window** ([#228](https://github.com/NobuData/ouroboros/issues/228),
decision **P7**). `GET /api/v1/providers/spend` answers the current **UTC calendar month**'s
spend per provider kind — the window a cap is agreed over, and the one `tests/seed.sql`
asserts the seeded meters against — by handing `RoutingStatsRepository.byProvider` the first
of the month instead of thirty days ago. `src/modules/provider-connections/spend.ts` is the
month's boundary and the row mapping; nothing there coalesces, so an unpriced kind stays
`null` (a local card's *no metered spend*) and a kind priced at nothing stays `0`. Each
listed connection also carries `addedByName`, resolved at read time through the workspace's
own connections (`ProviderConnectionsRepository.adderNames`) so a card prints *Added by Ken*
and never an id.

**The card's live surfaces are the adapter's three questions, over the wire** ([#230](https://github.com/NobuData/ouroboros/issues/230),
decisions **P6** and **P9**). `POST …/test` runs `validate` and answers **`200` whatever the
provider said** — a `503` is the state the card foot exists to render, `△ 503 upstream ·
retrying`, so `connection-test.ts` composes it through `validationPill` and `validationNote`
rather than turning it into a refusal of our own; the answer is written to the strip's
snapshot through `ProviderHealthService.recordValidation` and audited as `provider.tested`
with what was found. `POST …/discover` runs `discoverModels` and **replaces** the catalog —
`provider-models.repository.ts` is V017's `insert … on conflict`, inside a transaction that
locks the connection row for the workspace first, plus the delete of every row the report did
not name. What that deletion would hide comes back as `unlisted`: `models.ts` joins the
registry's aliases on the connection and flags every one whose model the catalog no longer
lists, so a route that is now broken stays visible on the card instead of being tidied away —
and flags nothing on a connection nothing has discovered on, which V017 calls a gap rather
than a mismatch. A failed discovery is `502 provider_discovery_failed` and changes nothing.
`POST …/pulls` is the handler over `ModelPullTracker.request`: `202` with the record as it
stands, the stream opened lazily so a queued pull reads its connection when its turn comes,
and a successful pull re-runs discovery from this process whether or not a page is still
watching. `GET …/pulls` is what a page polls, and the `404` for another workspace's
connection is the whole of its tenancy.

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

## The GitHub token

**One personal access token per workspace, sealed by the vault, and never returned**
([#101](https://github.com/NobuData/ouroboros/issues/101), decision **K1**).
`src/modules/github/` is the credential's whole life and the client every call to GitHub goes
through; [the backlog sync](#the-backlog-sync) is what uses it.

```
PUT    /settings/github-token  ─▶ seal ─▶ upsert ─▶ forget budget ─▶ audit ─▶ ghp_••••abcd
DELETE /settings/github-token  ─▶ delete ────────▶ forget budget ─▶ audit ─▶ configured:false
GET    /settings/github-token  ─▶ find ─▶ open ─▶ mask ─▶ erase ─▶ ghp_••••abcd
                                  owner & admin only — the read included
GithubClient  guard ─▶ request ─▶ observe x-ratelimit-* ─▶ classify
              401 → unauthorized · 404 → not_found · 403/429 → rate_limited · … → upstream
```

**Setting and rotating are one `PUT`**, because there is one token per workspace: two
endpoints would mean a client had to know which state it was in before it could ask. What
separates them is the audit trail — `github.token_set` the first time, `github.token_rotated`
after — and `github.token_cleared` records the press even when there was nothing to remove,
because a trail of outcomes rather than of actions loses the attempt.

**The token is never in a response, and no route could put it there.** `masked` is composed on
the server from the stored ciphertext, so what crosses the wire cannot be un-masked. There is
no reveal operation and there will not be one: `/api/v1/providers/{id}/reveal` exists because a
person has to copy a provider key into another tool, and nothing copies this token anywhere.
`github.secrecy.spec.ts` is the proof — it drives a real lifecycle and greps every response,
every audit row and every log sink for any eight-character run of the token.

**The read is `owner`/`admin` too**, which is this surface's one departure from
`/api/v1/settings/auto-merge`, whose read is every member's. A viewer looking at the auto-merge
switch learns a policy; a viewer looking at this learns that a credential exists, when it was
last rotated and its last four characters.

**The rate guard backs off *before* exhaustion.** GitHub reports the token's hourly budget on
every response, and `github.rate-limit.ts` keeps the last fifty requests of it back for whoever
is actually waiting — so a poller stops and says *"sync paused (rate-limited)"* instead of
spending the budget and taking the intake page down with it. A secondary limit (`403`/`429`
with `retry-after`) is recorded separately, because it can arrive with thousands of requests
remaining. Rotating or clearing a token forgets the guard's view of it: the numbers described
the old token's window, and a fresh token arrives with a full one.

**Octokit lives behind one file.** Everything in the module is written against `OctokitLike`,
and `github.octokit.ts` is the only file in the service that may import `@octokit/*` — enforced
by `.dependency-cruiser.cjs` and spot-verified in `github/boundary.spec.ts` by adding the
violation. That is the amendment posted on #101 on 2026-08-09, and it is the seam Q.3
([#140](https://github.com/NobuData/ouroboros/issues/140)) moves when the GitHub client becomes
the first `TicketSourceProvider`.

**Where GitHub is, is a setting.** `createOctokit` has taken a `baseUrl` since K.3 — *"a GitHub
Enterprise Server installation is the reason this is a parameter rather than a constant"* — and
until AM.6 ([#288](https://github.com/NobuData/ouroboros/issues/288)) nothing could supply one:
`GithubModule` bound `OCTOKIT_FACTORY` to `createOctokit({ token })`. It is now a `useFactory`
over **`OURO_GITHUB_API_BASE_URL`**, which is validated as an absolute URL at boot and defaults to
`https://api.github.com` — so the public API is still what every deployment gets and nothing that
did not ask for this changed. It moves the *address* only: the credential is
still the workspace's or the source's own, the rate-limit guard is the same one, and every failure
is classified by the same code. Its two callers are a GHES installation and the e2e suite's
sandbox tracker (`tests/e2e/README.md`, leg 15).

**Pagination holds one page.** `GithubClient.pages()` is a generator over Octokit's
`Link`-header walk: a repository with ten thousand issues costs one page of memory, a caller
that stops reading stops the walk, and a conditional first request that GitHub answers `304` to
ends it immediately — which costs nothing from the hourly budget at all.


## The backlog sync

**`github_issues` is filled by a poller, and the *"synced 40s ago"* tag counts from what it
wrote** ([#102](https://github.com/NobuData/ouroboros/issues/102), decision **K2**).
`src/modules/backlog-sync/` is mockup 03's subline made true: *"Ouroboros watches the GitHub
backlog and continuously estimates effort, risk, and routing for every open issue — before you
ever ask it to work."*

```
every OURO_BACKLOG_SYNC_INTERVAL_SECONDS, jittered ±25%
  for each workspace with a token
    for each enabled repo (its org enabled too), 3 at a time
      no cursor  ─▶ GET /repos/:o/:r/issues?state=open&sort=updated&direction=asc
      a cursor   ─▶ …?state=all&since=<watermark>&sort=updated&direction=asc
      drop pull requests · map · one transaction:
        upsert changed rows ─▶ repo.issues_synced_at + issues_sync_cursor
      hand new & reopened issues to the estimation pipeline
```

**An initial import and an incremental poll ask different questions, and `state=all` on the
second one is the interesting half.** A cold import takes `state=open`, which is what stops a
first sync dragging in a decade of closed issues. Every poll after it takes `state=all` bounded
by `since` — because an issue that closes upstream simply *leaves* an `open` listing, and a
mirror that only ever asked for open issues would hold it open forever. A closed issue the
mirror has never seen is still not stored, so `state=all` widens what the sync **learns**
without widening what it **keeps**.

**The watermark is what the poll saw, never this host's clock.** The next `since` is the
greatest `updated_at` among the issues GitHub returned. A clock-derived watermark is wrong by
however far this machine has drifted from GitHub's, and it is wrong in the direction that loses
issues. A poll that returned nothing leaves the watermark where it was and still stamps
freshness, because *"we looked and nothing had changed"* is exactly what the tag claims.

**A second poll with no upstream changes touches no rows.** GitHub's `since` is inclusive, so
every incremental poll re-reads the one issue sitting exactly on the watermark. The poll
compares it field by field and writes nothing when nothing differs — which is the only way to
keep `github_issues.updated_at` meaning *"GitHub changed this"*, since the touch trigger is
unconditional.

**Rows, cursor and freshness move in one transaction**, so the tag can never claim a sync that
partly failed. A repository whose poll failed is not stamped at all: its stored `synced_at`
goes on saying when the last good poll was, which is the honest answer.

**Pull requests are dropped before a row exists.** GitHub's issues endpoint returns both, and
the only thing that distinguishes them is a `pull_request` key. There is no column that could
record the difference, deliberately — a PR in the backlog table is a bug a user sees
immediately, and the way to be sure one is never stored is for the mirror to have no way to say
*this one is a pull request*.

**Nothing is ever a silent no-op.** A workspace with no token pauses `not_configured`; one with
a token and nothing enabled pauses `no_repositories`; a repository the token cannot see pauses
`not_found` without costing its neighbours their poll; a spent budget pauses the whole
*workspace*, because the budget belongs to the token. Five of those six words are the taxonomy
[the GitHub client](#the-github-token) already named, so M.4
([#113](https://github.com/NobuData/ouroboros/issues/113)) has a vocabulary to store rather than
one to invent.

**A poll holds at most five hundred issues**, which is a bound on memory rather than a
truncation: the walk is in ascending `updated` order, so what a capped poll stored is exactly
what its watermark claims, and the loop books the next cycle a second later instead of waiting
a full interval. A cold import of a large backlog is therefore several quick cycles rather than
an afternoon, and it says so in its report and its log.

**The estimation handoff is a seam, not a queue.** New and reopened issues are handed to
`EstimationIntake` after the transaction commits, and the sync knows nothing about what happens
next. [The estimation pipeline](#the-estimation-pipeline)
([#107](https://github.com/NobuData/ouroboros/issues/107)) is what is bound to that token; the
seam is one line in `backlog-sync.module.ts`, which is the whole reason it exists.

**There are no routes here.** `POST /api/v1/backlog/sync` and `GET
/api/v1/backlog/sync-status` are [the backlog surface](#the-backlog-surface)'s, in
`src/modules/backlog/`; this module owns the cycle they call, which is why
`BacklogSyncService`, `BacklogSyncRepository` and `BacklogSyncScheduler` are exported and no
controller is declared. Keeping the routes out is what preserves the one property the module is
written around: nothing an HTTP request does can reach inside a cycle.

## The backlog surface

**The freshness tag has data, and it is clickable**
([#113](https://github.com/NobuData/ouroboros/issues/113)). `src/modules/backlog/` is mockup
03's `synced 40s ago` and the two things it has to be able to say — *how fresh* and, when there
is no such number, *why not*.

```
GET  /api/v1/backlog/sync-status   any member
  ─▶ { syncedAt, state, pause, message, retryAfterSeconds, running, repositories[] }

POST /api/v1/backlog/sync          owner · admin · member
  ─▶ 202  the status at acceptance — running: true, freshness not yet moved
  ─▶ 409  backlog_sync_running   a cycle is in flight
  ─▶ 409  backlog_sync_too_soon  one ran < 30s ago — details.retryAfterSeconds
```

**Three sources, and none of them is a status column.** `syncedAt` and `cursor` are columns a
poll wrote; `not_configured` is whether `github_credentials` has a row; `no_repositories` is how
many repositories are enabled; `rate_limited` is read from [the same rate
guard](#the-github-token) the client enforces, so a countdown on the card and a refusal in the
client cannot disagree; and `unauthorized`, `not_found` and `upstream_error` come from the last
cycle's report. There is no `sync_state` column deliberately — a stored status is a status that
goes stale, and this one changes without anybody writing anything.

**So a pause reason does not survive a restart, and that is the honest answer to the question
the sync left open.** A fresh process has attempted nothing and therefore *knows* nothing about
`unauthorized`; the two reasons a reader can act on immediately — no token, no enabled
repository — are read from tables and are right the moment the service is up.

**Freshness is the oldest poll, not the newest**, and `null` while any enabled repository has
never been polled. The tag sits over the whole backlog, so what it may honestly claim is the
freshness of the stalest thing in it: one repository that synced a second ago must not speak for
nine that failed an hour ago. Each repository carries its own stamp, watermark and reason, so a
client can be more precise than the tag.

**Two guards on the trigger, and both are properties of the endpoint rather than of the cycle.**
A cycle already in flight is `409 backlog_sync_running` — two cycles walk the same repositories
twice, spend one token's budget twice for one answer, and race each other's upserts. A cycle
that ran within thirty seconds is `409 backlog_sync_too_soon` carrying how long to wait; the
interval is measured from the last cycle's *start*, whoever caused it, because what it protects
is the token's hourly budget rather than any one caller's fairness. Neither is a `429`: that
status means *you* have done this too often, and this is a guard on a loop the caller does not
own.

**`202`, because the cycle outlives the response.** A poll of a large backlog is several seconds
of somebody else's network, and a request that waited for it would turn a click into a timeout.
The body is the status at acceptance — `running: true`, and a `syncedAt` the cycle has not moved
yet — and what a client watches for is that instant advancing.

**A cycle polls every workspace this deployment has a token for**, which is the shape of the
poller behind it: this is *sync now*, not *sync mine now*, and it is why the minimum interval is
process-wide too. Narrowing a cycle to one workspace is a change to the sync service rather than
to this surface, and the place for it is [#140](https://github.com/NobuData/ouroboros/issues/140).

**Reading is every member's; starting a cycle is not.** A `viewer` may look at the status —
looking is what the role is for — and may not spend the workspace's GitHub budget, so the
trigger carries `@Roles(...CONTRIBUTORS)`: owner, admin or member. That list is deliberately not
`ADMINISTRATORS`; a re-sync is work rather than administration.

**The rest of Epic M lands here.** The bulk queue action
([#112](https://github.com/NobuData/ouroboros/issues/112)) is still this module's controller to
add.

**The order the module lists its controllers in is a routing rule**, and the panel is what made
it one: `GET /api/v1/backlog/{id}` is the first path under this prefix that is a bare parameter,
and Express matches in registration order. `BacklogController` — which holds the two literal
segments — is listed first, so a freshness poll cannot become a request for an issue whose id is
the word *sync-status*.

### The listing

**The filter bar is a query string**
([#110](https://github.com/NobuData/ouroboros/issues/110), decision **K8**). Every control on
mockup 03's `.filter-bar` card writes one parameter, so a filtered view is a URL somebody pastes
to a colleague and a backlog larger than a page is still shareable — which is the whole reason
filtering, sorting and searching are server-side rather than an array filter over a fetched page.

```
GET /api/v1/backlog?repo=&labels=&state=&sort=&q=&limit=&offset=      any member
  ─▶ items[]      one row per issue: number, title, labels, state, sizingStatus, queued,
                  repository, and estimate{effort, confidence, workflow, model, estMinutes} | null
     total        how many rows the filter matched
     meta         { openCount, sizedCount, syncedAt }   the page head and the freshness tag
     labelFacets  every label in scope, ascending       the chip set
```

**The head describes the backlog; the table describes the filter.** `openCount` and `sizedCount`
are scoped by the workspace and by `repo` and by nothing else — that head sits *above* the filter
bar, and counts that moved as chips were toggled would make *"38 already sized"* a statement
about the filter. `total` beside them is the filtered count, so a client has both numbers and
neither has to be inferred. `sizedCount` counts the open issues that are `sized`: one sentence
about one set.

**`labelFacets` is not narrowed by the chips either**, and that one is load-bearing rather than
tidy: `labels=bug` ANDed into the facets would leave only the labels that co-occur with `bug`, so
selecting a first chip would delete most of the set it was selected from and a second chip could
never be chosen.

**`meta.syncedAt` is this module's own `syncedAt`** — `SyncStatusService`'s, lifted rather than
re-derived, so the tag beside the listing and the tag from `/backlog/sync-status` are one number.
A second `max(synced_at)` here would have answered a different question: that column moves when a
row is *written*, and the tag is about when a poll *ran*.

**Four filters, three indexes, one lateral.**

| The parameter          | The predicate                                | What answers it                              |
| ---------------------- | -------------------------------------------- | -------------------------------------------- |
| `repo`, `state`        | `organization_id`, `github_repo_id`, `state` | `github_issues_organization_repo_state_idx`  |
| `labels` (AND)         | `labels @> '["bug","tech-debt"]'`            | `github_issues_labels_idx` — GIN, one probe  |
| `q` — title            | `title ilike '%watchdog%'`                   | `github_issues_title_trgm_idx` — GIN trigram |
| `q` — label, `#number` | `labels ? 'watchdog'`, `number = 485`        | the GIN index; the scope                     |

Label filtering is **AND** — turning on a second chip narrows what is on screen, which is the
only reading under which a chip set is a filter — and it is one containment against the whole
selection rather than a chain of them. `q`'s label half is a **name** rather than a substring,
because one disjunct no index can answer makes the whole search a scan; a label name is a short
token out of the set `labelFacets` just handed back.

The estimate is a `left join lateral (… order by version desc limit 1)`. Decision **K4** is that
re-estimation writes a new row and the highest version wins, so a plain join would render a
twice-estimated issue as two rows — and it is `left` because `unsized` and `estimating` are two of
the four pills the table draws.

**`sort=effort` is the chip order with the unsized last**, which is one clause: `array_position`
over the five sizes — declared smallest-first in `schema.ts` so an index into it is a rank — and
`nulls last`, because an issue with no estimate has no position. `confidence` is
most-certain-first, `updated` and `number` are newest-first, and every ordering ends on the row id
so a page boundary cannot show one row twice and another never.

### The detail panel

**The listing is the table's cells and this is everything else**
([#111](https://github.com/NobuData/ouroboros/issues/111)). Mockup 03's `ISSUE DETAIL` card wants
the body, the author, the opening instant, the GitHub URL, the whole breakdown, the risk sentence
and the trace — and fetching all of that per row would make the list pay for a panel most rows
never open. This pays for it once, for the issue somebody clicked.

```
GET /api/v1/backlog/{id}                                             any member
  ─▶ issue     the row's cells + body, authorLogin, ghCreatedAt, ghUrl
     estimate  { version, effort, confidence, suggestedWorkflow, routedModel,
                 breakdown{files, estTokens, cycleMin, cycleMax, estMinutes},
                 risk, riskNote, trace{estimator, sizedAt, tokensUsed, signals} } | null
     history   [ {version, estimator, createdAt}, … ]  oldest first
  ─▶ 404  issue_not_found  no such issue here — including one that is somebody else's
```

**`{id}` is `github_issues.id`, not GitHub's number**, exactly as on `POST {id}/estimate`: the
mirror is unique on `(github_repo_id, number)`, so a workspace watching two repositories has two
issue `#485`s and a numeric path would name neither.

**`body` is raw and untruncated.** The client cuts it to the panel's width; a server that cut it
would be choosing a line count for a layout it cannot see, and *read more* would become a second
request. It is Markdown as GitHub stores it, unrendered.

**An unsized issue answers the issue-only shape** — `estimate: null`, `history: []`, and every
other field still there to draw — rather than a `404` or an estimate object of nulls. That is
what `unsized` means, and what `estimating` means before the first answer lands.

**`estimate` and `history` are the same rows.** One statement reads every version of the issue;
the panel's estimate is the highest and the history is all of them. Read separately they would
eventually answer a trace naming version 3 over a history that ends at 2, because a re-estimation
landed in between. It costs one small `jsonb` column per superseded version — `trace` has to be
read for all of them anyway, since that is where each entry's `estimator` lives.

**Both statements carry `organization_id`,** and the estimates one reaches it through a join
because `issue_estimates` has no such column of its own. An issue in another workspace is a `404`
with the caller's own id echoed back, never a `403`: a `403` would confirm that a guessed id
names a real issue somewhere.

### The backlog API's matrix suite

**The regressions here are the ones nine rows cannot show**
([#114](https://github.com/NobuData/ouroboros/issues/114)). Each route above has an integration
suite of its own against mockup 03's nine issues — `listing.`, `detail.`, `queue.` and
`backlog.integration-spec.ts` — and each answers *does this endpoint reproduce the screen*. The
suite below answers the other question: *does every combination of five parameters answer
correctly, and does any of them leak*, over 160 generated issues in two repositories with a
second workspace holding an identical backlog beside it.

| Where                               | What it holds                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `backlog-api.integration-spec.ts`   | the filter/sort/search matrix, the queue write's four outcomes, both panel shapes, both sync guards |
| `src/testing/volume.fixture.ts`     | the generated population, and the restatement of these rules the matrix derives its expectations from |

**Every filter case is an isolation case.** The two workspaces are seeded with the *same*
numbers, titles and labels, so a row's `github_issues.id` is the only thing that says whose it
is — which is what every case checks alongside the rows, the counts and the chip set. Written as
two suites, the isolation half would quietly stop covering the parameters the day a case was
added to one and not the other.

**No expectation was recorded from a run.** The fixture carries the population *and* a plain
array-filter restatement of the rules above, and each case derives its answer by running it. One
side is SQL over a GIN index and a lateral; the other is `Array.prototype.filter`. The two
agreeing is the test.

## The estimation pipeline

**An issue the sync mirrored reaches `sized` on its own**
([#107](https://github.com/NobuData/ouroboros/issues/107), decision **K7**).
`src/modules/estimation/` is the second half of mockup 03's subline — the *"continuously
estimates effort, risk, and routing"* half — and it is the state machine the four status pills
render.

```
unsized ──▶ estimating ──▶ sized          engine answered, confidence ≥ floor
                       └─▶ needs_human    confidence < floor, or two failed attempts
sized | needs_human ──▶ estimating        re-estimate (L.4)
```

```
accept(issues)    from the backlog sync — new & reopened
sweep()           rows estimating longer than OURO_ESTIMATION_STALE_SECONDS
enqueue(issueId)  L.4's re-estimation endpoints
   └─▶ EstimationQueue: OURO_ESTIMATION_CONCURRENCY at once, one entry per issue
         └─▶ resolve the workspace's tags & models
             claim ─▶ POST /v0/estimate (one retry) ─▶ one transaction:
               insert issue_estimates v(max+1)  ─▶  github_issues.sizing_status
```

**Decision K7: estimation runs *through the engine*, even though the estimator is a rule
engine.** That pipeline shape is the product architecture, and swapping `heuristic-v0` for the
LLM estimator ([#123](https://github.com/NobuData/ouroboros/issues/123)) is an engine-internal
change nothing here sees. What a caller reads is `trace.estimator` to know what sized an issue
and `confidence` to know whether to trust it — never which engine build answered.

**The `needs_human` transition is this service's, and it is one comparison.** The L.1 contract
has no `needs_human` field on purpose: an estimator says how sure it is, and what that means is
an installation's policy. `ouroboros-engine` publishes the floor its tables were *calibrated*
against and `OURO_ESTIMATION_CONFIDENCE_FLOOR` defaults to it, so the two cannot drift apart in
silence. **An estimate under the floor is still stored in full** — mockup 03's own `#490` is
that row, `XL` at 61% with a `needs human` pill beside all of it, and refusing to store it would
throw away the thing a person is being asked to look at.

**The models come from routing, not from configuration** (Z.4,
[#197](https://github.com/NobuData/ouroboros/issues/197), decision **M6**). `model_defaults` is
filled by [`ResolutionService`](#route-resolution) — the same method `POST
/api/v1/routing/simulate` serves — and each value is the resolved chain's first **kept** hop,
which is the model an executor would actually try. Two keys are offered, `default` (through the
`implement` route) and `docs` (through `docs`), which is what the engine's own per-tag lookup
falls through. **Resolved, never invoked:** nothing here calls a model, and the engine's trace
says so in those words.

**A workspace whose routing resolves nothing is not dispatched at all.**
`issue_estimates.routed_model` is `not null` and non-blank, so an installation with no route
genuinely has no estimate to store. Its issues stay `unsized` — which is what they already are —
and one log line says why. Deliberately not `needs_human`: that status means *this issue wants a
person to size it*, and burning a backlog into it for a reason that has nothing to do with any
of the issues would be the page telling a story about the wrong thing.

**A failure writes no estimate, and is not silent.** An engine error or timeout is retried once
and then the issue is moved to `needs_human`, with the repository, the issue number, both
attempts and the reason in the service log. There is no fabricated row behind it:
`issue_estimates` has no nullable effort and no *unknown*, so a failure row would put an effort
chip on the backlog table for an issue nothing sized, and a `trace.estimator` on a record of
nothing — which is decision **K10** read backwards.

**The version is computed by the writer and checked by the database.** The write asks for
`max(version) + 1` inside its transaction, and a second writer that got there first is a unique
violation on `issue_estimates_issue_version_key` that is retried with a fresh number. There is
no `select … for update`: locking the issue row would serialise the engine call behind whoever
got there first and would put a lock across a network hop, which is how a deadlock is built
rather than avoided.

**No row is ever stuck.** Every path out of an estimate writes a terminal status, including the
one where the write itself failed. What that cannot cover is a process that stops existing
between the claim and the write, and the recovery sweep is what covers it: every
`OURO_ESTIMATION_SWEEP_INTERVAL_SECONDS`, jittered ±25%, one indexed query re-queues rows that
have been `estimating` longer than `OURO_ESTIMATION_STALE_SECONDS`. It is the third background
loop in this service and the only one that knocks on nothing outside this deployment. A sweep
whose every row was already in flight says so, because that means the threshold is set below how
long an estimate legitimately takes.

**The two routes are here, under the backlog's prefix.**
`POST /api/v1/backlog/{id}/estimate` and `POST /api/v1/backlog/estimate-all`
([#108](https://github.com/NobuData/ouroboros/issues/108)) are the pipeline's only external
trigger — mockup 03's panel button and its head action — and they live in this module because
everything they touch is this module's: the queue, the claim and the limiter.
[The backlog surface](#the-backlog-surface) owns the prefix; `AuditModule` serves
`GET /api/v1/providers/audit` on the same argument.

```
POST /api/v1/backlog/{id}/estimate   member+   ─▶ 202 {issueId, number, repository, status}
                                               ─▶ 404 issue_not_found        (cross-org too)
                                               ─▶ 409 issue_already_estimating {status}
POST /api/v1/backlog/estimate-all    admin+    ─▶ 202 {enqueued, skipped, total}
                                               ─▶ 409 backlog_already_estimating
both                                           ─▶ 429 estimation_rate_limited {retryAfterSeconds}
```

**`{id}` is `github_issues.id`, not GitHub's number.** The ticket's own diagram writes
`POST /backlog/485/estimate`, and that is the issue rather than the path: `github_issues` is
unique on `(repository, number)`, so a workspace watching two repositories has two issue
`#485`s and a path carrying `485` would name neither. A path that is not a uuid is a `422`
before a statement is issued.

**The row is claimed before the work is queued**, which is what makes the `202`'s
`status: "estimating"` true when it is sent rather than a promise about a row that still says
`sized` — and it makes the double-fire `409` a fact any replica can read instead of one
process's memory. The orchestrator claims again when the work starts, unconditionally and
idempotently, and a process that dies in between leaves a row the recovery sweep is built to
find.

**Scope and claim are one statement for the fan-out.** `update … where organization_id = $1
and sizing_status != 'estimating' returning id` is the whole of *touches only non-`estimating`
rows*: two administrators pressing together cannot claim the same issue twice, and the count it
returns is a fact rather than an estimate of one. A second press while the first is running
finds nothing to take and is a `409` — `202 {enqueued: 0}` would report *accepted* for a
request that started nothing. A workspace that mirrors **no** issues is different and answers
`202` with zeros: *empty* and *busy* are not the same state.

**Two role gates, because the two cost different things.** One issue is `member+` —
re-estimating something you are working on is work. The whole backlog is `admin+`, because a
fan-out spends the workspace's engine quota in one press and real money once
[#123](https://github.com/NobuData/ouroboros/issues/123) puts a model behind the estimator.

**The rate limit is per workspace, thirty a minute, sliding.** The quota being protected is the
workspace's rather than any caller's, so three members share one window and one member acting in
two workspaces is limited in each. **Every request that reaches the operation counts, including
the ones refused `409`** — the hammering caller the ticket names is *mostly* collecting
conflicts, because their second click lands on an issue their first one moved into `estimating`,
and a limiter that only counted accepted work would never see them. It is a `429` where
[the backlog surface](#the-backlog-surface)'s re-sync guard is a `409`, and the difference is
real: that one protects a shared background loop the caller does not own, and this one counts
what this workspace asked for.

### How the pipeline is proved

**The suite runs against a real engine, and the engine holds itself to its own contract**
([#109](https://github.com/NobuData/ouroboros/issues/109)).
`src/testing/engine.stub.fixture.ts` is an `ouroboros-engine` on a loopback port:
`OURO_ENGINE_URL` points at it, the shared secret is checked on it, and the body that reaches
`issue_estimates` is one that went over a socket and back through the real zod parse. What that
catches is a `snake_case` key nobody translated, which is the failure this boundary actually
has.

**Every answer it serves is validated against `ouroboros-engine/openapi.yaml`, and every
request it receives with it** — `Estimate`, `WorkflowValidation` or `WorkflowDryRun` for a
`200`, `Error` for a failure, and the matching request schema on the way in. The document is the engine's own, committed and served
verbatim rather than generated, and reading it here is what closes the hole an ad-hoc fake
leaves open: a stub that answers whatever a test typed is free to be wrong in the same
direction as the code, so a body carrying a field `/v0` does not publish would pass a suite
that only ever compared it against itself. A test that means to answer off-contract says so;
one that did not gets a `500`, and the violation is asserted away in `afterEach`.

```ts
const engine = await startEngineStub();
const api = await ApiHarness.start({ OURO_ENGINE_URL: engine.url });

engine.respond(() => engineFailure()); // 503, in the engine's own envelope
engine.respond(() => estimateAnswer({ confidence: 61 })); // under the floor
engine.respond(() => offContractAnswer()); // outside /v0, deliberately
```

**A contract change breaks the stub before it breaks a test.** `startEngineStub()` validates
the body it is about to serve and refuses to start when it no longer satisfies the document, so
adding a required field to `Estimate` fails with the field named rather than as twenty
assertion diffs. Its own 38 cases need no database and run in the fast suite, which is where a
developer should learn that the engine's contract moved.

**The studio's two workflow routes are scriptable too** — R.4
([#146](https://github.com/NobuData/ouroboros/issues/146)). A publish gate whose engine can
only ever say *green* is a gate no suite can prove is there, so `respondToValidation` makes the
engine refuse or fail, under the same contract check:

```ts
engine.respondToValidation(() => validationFindings({ code: "node.unreachable", message, path, node_id }));
engine.respondToValidation(() => engineFailure()); // → 502 engine_unavailable, nothing published
```

`POST /v0/workflows/dry-run` is published beside it and answers, by default, **the example
exchange the engine's own document commits to** (`dryRunExample()`), read from the YAML rather
than typed — so the stub's walk cannot drift from the engine's description of one. Its caller is
the studio's dry run, S.6 ([#152](https://github.com/NobuData/ouroboros/issues/152)), and
`engine.respondToDryRun` scripts findings or a failure for it the way `respondToValidation` does
for the gate. Because the stub reads that document, `ci/rest` watches
`ouroboros-engine/openapi.yaml`.

**`POST /api/v1/workflows/{id}/dry-run` is the studio's *Dry run with issue #485*.** The request
names an issue by id and nothing about it: `WorkflowDryRunService` reads the issue's labels and
the effort of its estimate in force from this workspace (`dry-run.repository.ts`), walks the
stored draft — or the version in force when none is open — through `EngineClient.dryRunWorkflow`,
and relays the engine's walk in camelCase with the ticket it tested. A definition the engine
finds fault with is a `200` carrying publish-shaped findings (`source: "engine"`, node-anchored);
an issue or workflow that is not this workspace's is a `404`; an engine that cannot answer is a
`502`. It writes nothing, so it carries no `@Roles()` — every member, viewers included.

**The studio's cross-service behaviour is `studio.integration-spec.ts`**: the publish gate's
engine refusals (nothing written, counted), a twenty-case R.1 trigger matrix through the queue
write (response *and* stored pin), dry-run contract fidelity from the data REST holds, and org
isolation on every workflow route — enumerated from the route table, so a route added without a
case fails. `catalog.synthetic.integration-spec.ts` serves R.3's synthetic node type from a
running application, through the `providers` seam on `ApiHarness.start` that overrides one token
and nothing else.

**The pipeline's matrix is `estimation.integration-spec.ts`** — the lifecycle, the engine-down
fallback and its recovery, the stale sweep, concurrent re-estimates, provenance, `estimate-all`
scope and the role gates. Two of those are held to a standard a passing suite cannot show on
its own, so the deletions were performed by hand and the results recorded in the file's header:
neutering `sweep()` reddens five cases, and cutting the retry reddens exactly two while leaving
every recovery case green. A suite where any deletion reddens everything cannot tell one
mechanism from another.

## The workflow DSL

**A workflow is one JSON document, and this is the half of its validator that answers the
browser** ([#133](https://github.com/NobuData/ouroboros/issues/133)). The language itself is
specified in [`docs/WORKFLOW_DSL.md`](../docs/WORKFLOW_DSL.md) and published as
[`schemas/workflow-dsl/v1.json`](../schemas/workflow-dsl/v1.json); `src/modules/workflows/` is
that schema written in zod, the structural rules a schema cannot express, and the YAML
projection mockup 05's code view is a view of.

P.2 is the language, P.4 is the derivation over it (below), and the CRUD, draft and publish
routes are P.3 ([#134](https://github.com/NobuData/ouroboros/issues/134)) — [the lifecycle
API](#the-workflow-lifecycle-api), whose publish gate is `validateWorkflowDocument`, the
workspace's model registry — every `pinned_model: {alias}` must name an alias it holds, since
CH.6 ([#589](https://github.com/NobuData/ouroboros/issues/589)) — and the engine's own reading of
the same document. The module also *exports* two providers, as
`PricingModule` does, so the rail its own controller serves and the vocabulary the intake
surfaces read are one derivation rather than three.

```ts
const verdict = validateWorkflowDocument(definition, { catalogue });
// { valid, errors: Diagnostic[], warnings: Diagnostic[], document? }
```

**Every diagnostic is anchored** — an RFC 6901 pointer, plus the node id or the edge endpoints
when there is one — so the canvas can select the offending stage rather than showing a banner.
There is no bare *invalid document*. `errors` and `warnings` are separate lists rather than one
list with a severity, because decision **P7** says an unknown skill must not fail a save and a
caller who has to filter by severity to learn that is a caller who will forget to.

**The typed document comes back exactly when the document is valid.** A document with an error
has a node whose config did not parse, and there is no honest typed value for it.

### Four stages, in one order

The frame; then each node and each edge; then each node's type-dependent config and each edge's
condition; then the structural rules; then decision P7's reference warnings. Each stage runs only
over what the one before it accepted, and the elements are validated one at a time so that a
mistake in one node does not hide a different one in the next — a canvas that reports one error,
is corrected, and then reports another is a canvas an author stops trusting.

`ouroboros-engine`'s `ouroboros_engine.workflows` runs the same four stages in the same order
with pydantic, and the order is part of the contract: it decides *which* diagnostics a broken
document gets.

### What keeps the two validators honest

| Suite | What it asserts |
|---|---|
| `dsl.parity.spec.ts` | Every case in [`fixtures/expected.json`](../schemas/workflow-dsl/fixtures/expected.json) — one document per rule, and the verdict both validators must produce. The engine's `test_workflows_parity.py` asserts the same file. |
| `dsl.conformance.spec.ts` | ajv compiles the published schema in strict mode, and ajv and zod classify every fixture alike. |
| `dsl.yaml.spec.ts` | Every valid document round-trips through YAML value for value, and renders exactly the projection committed beside it. |

Neither module imports the other and no third process compares two outputs: each reads
`schemas/workflow-dsl/` from its own suite. A rule added to one validator and forgotten in the
other is a red check in the half that forgot it. `ci/rest` and `ci/engine` both watch
`schemas/**` for that reason.

The fixture set is checked for completeness in both directions — every document on disk has a
recorded case, and every code the validator can emit has a case behind it — so a rule added
without a fixture fails before it can quietly go unasserted.

### The code projection

**Mockup 05's editor shows a workflow as TypeScript, and `printWorkflowCode` writes it** (U.1,
[#165](https://github.com/NobuData/ouroboros/issues/165)). The language is closed, specified in
[`docs/WORKFLOW_CODE_DSL.md`](../docs/WORKFLOW_CODE_DSL.md), and never evaluated.

```ts
const { text, spans } = printWorkflowCode("standard-fix", document);
// text:  'import { defineLoop, effort, route, … } from "@ouroboros/sdk";\n\nexport default defineLoop(…'
// spans: [{ node: "issue-queued", startLine: 10, endLine: 14 }, …]  — the node→line map #178 reads
```

**The printer is deterministic and lossless, and the compiler checks both.** The same document
prints the same bytes whatever order its keys arrived in. The stage calls carry what the workflow
does, and a trailing layout block carries positions, edge labels and edge order. The input is a
*valid* document: a draft is not validated, and a document the grammar has no spelling for is
refused with `WorkflowCodePrintError` rather than printed as something it is not.

**`parseWorkflowCode` reads a file back, statically** (U.2,
[#166](https://github.com/NobuData/ouroboros/issues/166)). It builds a tree with
`ts.createSourceFile` and walks it; nothing is emitted, run or imported. It returns the slug and
the *candidate* document, or every error at once, each anchored to a line and column range:
`code_syntax_error`, `code_out_of_grammar` (always with the pointer to the full-SDK decision, #180)
or `code_layout_invalid`. It checks shape only. An unreachable stage parses, and
`validateWorkflowDocument` is what refuses it. This parser is why `typescript` is a runtime
dependency here rather than a development one.
[`docs/WORKFLOW_CODE_DSL.md` §13](../docs/WORKFLOW_CODE_DSL.md#13-reading-a-file-back) lists what
it accepts and normalises, and what a stale layout line means.

```ts
const { slug, document, errors } = parseWorkflowCode(text);
// errors: [{ code: "code_out_of_grammar", line: 13, column: 5, endLine: 13, endColumn: 11, message, hint }]
```

| Suite | What it asserts |
|---|---|
| `code.printer.spec.ts` | Every valid fixture prints exactly `fixtures/code/<name>.loop.ts`. The print has no syntax error, and the graph `ts.createSourceFile` reads back (positions; each edge's kind, condition, label and order) is the document's. Also covers the constructs the golden files don't reach, each of which also parses back into its document, and every refusal. |
| `code.seed.spec.ts` | All six seeded definitions print, give back their graph and parse back into the stored document. |
| `code.parser.spec.ts` | Every committed projection parses back to the JSON it was printed from, and prints back to the same bytes. Also covers the non-canonical spellings the parser accepts, what stale layout lines mean, and files that spell invalid workflows: those parse, and the validator reports them. |
| `code.parser.errors.spec.ts` | Each file in `fixtures/code-invalid/` reports exactly the codes and ranges its `expected.json` records. Every refused construct is checked one at a time against the text its range covers, as are several errors from one parse and syntax errors that don't cascade. |
| `code.parser.static.spec.ts` | The parser's module graph imports only `typescript` and `zod`, and never names `eval`, `Function` or `require`, imports at run time, or emits. A file that would leave a mark if it ran leaves none, and no file is read. |
| `code.errors.spec.ts`, `code.reader.spec.ts` | Positions count line feeds only. Each literal reading returns its value or one anchored error. |
| `code.predicates.spec.ts` | Every predicate form and trigger combination has exactly one spelling, and the compiler reads each spelling back into its structure. |
| `code.literals.spec.ts`, `code.layout.spec.ts` | Strings, prompts, token budgets and coordinates survive the compiler. The layout block reads back exactly and reports each unreadable line by number. |
| `code.roundtrip.spec.ts` | `parse(print(doc))` is `doc` over 1000 documents that `code.arbitrary.fixture.ts` generates, and the compiler's reading of each print is the document's graph. Printing is deterministic and ignores key order. The run fails unless it reaches every feature in `GRAMMAR_FEATURES`: each stage callee, predicate form, edge spelling, position oddity and hostile string. |
| `code.parser.fuzz.spec.ts` | 2800 texts: mutations of every committed file and of generated prints, token soup, and arbitrary code points. The parser never throws. Every error has a documented code, the #180 hint exactly when out of grammar, and a range inside the text in reading order. A text it reads that spells a valid document prints and parses back to that document. |
| `code.parity.spec.ts` | The seeded `standard-fix` v14 prints the golden file byte for byte, and mockup 05's listing, read from its HTML, agrees with `WORKFLOW_CODE_DSL.md` §10 line by line. |

**The generated runs replay.** The property and fuzz suites use the fixed seed `168` (U.4,
[#168](https://github.com/NobuData/ouroboros/issues/168)). A failure's report names the seed and a
`path`, and passing both to `fc.assert` replays the shrunk counterexample.

**The seeded `standard-fix` doesn't print to mockup 05's 32-line listing.** The listing is drawn
from a simpler document than the one the seed writes, so a byte-exact print would be a lossy one.
[`docs/WORKFLOW_CODE_DSL.md` §10](../docs/WORKFLOW_CODE_DSL.md#10-against-mockup-05) records each
line that differs and why.

## The workflow rail's statistics

**Every string on mockup 04's rail is computed on the read, and none of them is stored** (P.4,
[#135](https://github.com/NobuData/ouroboros/issues/135)). `6 stages · auto-merge`,
`5 stages · needs review`, `5 stages · paused` and the page head's `used by 61% of runs` are
derived from a definition, a `status` column and a count of runs — V029 says why from the other
side: *"a stored count would be a number that drifts from the document it counts."*

```ts
const rail = await workflowStats.forWorkspace(organizationId);
// [{ slug, name, status, currentVersion, stageCount, terminal,
//    caption: "6 stages · auto-merge",
//    runs, usagePercent: 61, usageCaption: "used by 61% of runs" }, …]
```

| Field | Where it comes from |
|---|---|
| `stageCount` | `jsonb_array_length(definition -> 'nodes')` of the version `current_version` points at. `null` for a workflow with only a draft — there is no document in force to count, and `0 stages` would be a number about one that does not exist. |
| `terminal` | The `action` of the definition's `term` nodes, resolved by precedence — `open_pr_automerge` beats `needs_review` beats `back_to_queue`, because the caption answers *what does this do when it works?* and `standard-fix` legitimately ends in two places. |
| `caption` | The two composed, with `paused` replacing the behaviour exactly as the mockup's `hotfix-p0` does. |
| `usagePercent` | Runs carrying this slug over **every** run in a rolling 30-day window, both counted in one statement so numerator and denominator cannot disagree. `null` when the window holds no runs. |
| `usageCaption` | `used by 61% of runs`, `used by <1% of runs` for a workflow that ran but rounds to nothing, or **`no runs yet`** when there are none. |

**`no runs yet` is the answer, not a formatting choice.** An installation with no runs must
never read a plausible-looking percentage — the honesty rule that governs the dashboard and
intake surfaces — so `usagePercent` is `null` rather than `0` and the sentence ships with it.

**Two facts are asked of PostgreSQL rather than fetched.** A definition holds a prompt template
per model stage, up to 20 000 characters each, so a rail of twenty workflows would move
megabytes of prose to compute two integers. Every jsonb expression is guarded:
`workflow_versions.definition` is CHECKed to be an *object* and no further, and a document this
build cannot read produces no stage count rather than a `500` for the whole rail.

**The mockup disagrees with itself about `standard-fix`, and this is where that is recorded.**
Its rail caption reads `6 stages` beside a canvas of twelve nodes — six is what the *primary
path* holds, with the trigger, the forks, the terminals and the `> M` branch left out. A stage
is a **node** here: that is what the issue's own diagram says (`nodes.count = 6`), what mockup
20's draft panel counts (`01 trigger` … `09 open PR`, captioned *9 stages*), and what the
canvas's **Add stage ▾** and the inspector's **Delete stage** act on. Which number the *seeded*
`standard-fix` shows is therefore #136's to settle.

### The workflow registry, and the intake amendment

`WorkflowRegistryService.offered(organizationId)` is *which workflows may this workspace name* —
its **active** workflows, in the rail's order. `paused` is deliberately out (queueing work onto
a switched-off workflow is not something to offer) and `archived` is V029's soft delete.

This is the amendment absorbed from [#124](https://github.com/NobuData/ouroboros/issues/124):
the two intake surfaces that name a workflow used to read decision **K5**'s four tags from a
constant, and now read a workspace.

| Surface | Before | Now |
|---|---|---|
| `POST /api/v1/backlog/queue`'s `workflow` | `@IsIn` over four tags, refused by the pipe | a slug by shape, then the registry — `422 queue_workflow_unknown` carrying `details.offered` |
| The estimate request's `workflowTags` | the same four | the workspace's own, so an estimate is held to workflows that exist |

**A workspace with no workflows is offered the built-in four**, and that is neither a default
merged into the registry nor a fabrication. It is the empty-registry answer and no other case:
`POST /api/v1/workflows` is the create (#134) and #136 is the seed, and until a workspace has
used one of them an empty vocabulary would take a shipped intake pipeline offline
(`issue_estimates.suggested_workflow` is `not null`, and the engine refuses an estimate naming
anything outside the offered set). `offered()` says which answer it gave, so *the menu lists the
registry* is a claim a test makes about a workspace that has one. A workspace with **one**
workflow is offered that one and nothing beside it.

**Nothing already stored stops resolving.** `runs.workflow_tag` and `queue_items.workflow_tag`
are still opaque text by decision **F8**, V029 added no foreign key, and `workflows.slug` is
bounded to exactly what a tag can hold — so every tag in the database is a slug, and a tag whose
workflow was renamed or removed is a fact about history rather than a broken row.

**One bound came with the registry that a constant never reached.** `ouroboros-engine`'s
estimation contract *refuses* a request offering more than 64 workflow tags, so
`estimation.context.ts` cuts the list at `MAX_OFFERED_WORKFLOW_TAGS` — keeping the rail's order,
so adding a workflow does not change which 64 are offered — and logs it. The alternative is a
`422` from the engine and no estimate at all for that workspace. The queue write is unaffected:
it validates one slug against the whole vocabulary.

## The onboarding wizard API

`/api/v1/onboarding` ([#385](https://github.com/NobuData/ouroboros/issues/385), BB.2) is mockup
13's Get Started wizard, per repository (`?repo=owner/name`), since REST 0.37.25:

```
GET   /api/v1/onboarding                  any member — the rail, choices, card refs, surfacing
PATCH /api/v1/onboarding                  template/ticket/issue picks: owner, admin, member · dismiss: any member
POST  /api/v1/onboarding/complete-step    owner, admin, member — guarded by the derived rail
POST  /api/v1/onboarding/skip             owner, admin, member — the import-skip
GET   /api/v1/onboarding/surfacing        any member — the fresh-org rule alone, no repository (#390)
```

**Every step is derived on read, never stored** (decision **O1**). `onboarding.derivation.ts`
is the contract V070's header restates:

| Step | Done when | Derived from |
|---|---|---|
| 1 Connect GitHub | an `active` GitHub ticket source's config names the owner and lists the repository | sources |
| 2 Pick a repo | the `github_repos` row and its `github_orgs` account are both enabled | tenancy |
| 3 Choose a starting workflow | a workflow's `template_slug` is the picked template (V068 provenance) | workflows |
| 4 Run your first loop | the picked ticket's issue has a `queue_items` or `runs` row in the repository | intake |

A step that is not done but shows evidence of having been — a later step is done, the wizard was
completed, or its source is paused or failing — is `todo` with `regressed: true` and a `reason`,
so a revoked connection flips step 1 on the very next read. `onboarding_state` holds only the
choices (template, ticket, dismissed, `completed_at`, V070's `bypassed_at`).

**Completion is guarded.** `complete-step` re-derives the rail and answers
`409 onboarding_step_incomplete` — `message` is the blocking step's reason — unless every step
up to the one asked for is done. Steps 1–3 write nothing; step 4 stamps `completed_at` once.

**The import-skip imports nothing.** It stamps `bypassed_at`, answers `settingsPath: "/settings"`
and `configurationImported: false`; the bundle import is BD.3
([#398](https://github.com/NobuData/ouroboros/issues/398)).

**Surfacing** (`onboarding.surfacing.ts`): `/get-started` is offered while the workspace has
never had a run and no repository's wizard in it is completed, dismissed or bypassed. Dismissal
sticks because it is server state; any repository stays re-enterable by naming it.

## Repository detection

`/api/v1/onboarding/detection` ([#384](https://github.com/NobuData/ouroboros/issues/384), BB.1)
fills the *"We already figured this out"* card, since REST 0.37.27. **It never clones**: versioned
rule packs probe the repository through the ticket-source SPI's fourth capability family
(`ProbeCapableProvider` — languages, one recursive tree listing, single files), on the same
connection and rate guard (#101) as the backlog sync.

```
GET  /api/v1/onboarding/detection?repo=owner/name                  any member — newest scan + progress
GET  /api/v1/onboarding/detection/scans/{scanSeq}?repo=owner/name  any member — an earlier scan
POST /api/v1/onboarding/detection/scan?repo=owner/name             owner, admin, member — 202, debounced
PUT  /api/v1/onboarding/detection/protected-paths?repo=owner/name  owner, admin — { globs }, the whole list
```

| Pack | Reads | Row |
|---|---|---|
| `language` | languages API; `west.yml` / `package.json` / `pyproject.toml` hints | `C 92% · Zephyr RTOS 4.1` |
| `build` | manifest table over the tree | `west + twister (found west.yml)` |
| `devcontainer` | `.devcontainer.json` or `.devcontainer/devcontainer.json`, parsed | `found .devcontainer.json → image …` |
| `tests` | per-ecosystem suites, ≤ 12 files counted | `5 suites, 63 tests (detected)` |
| `protected_paths` | boot / keys / secrets / infra directories | `boot/, keys/ suggested` — written as `suggested` policy |
| `conventions` | `CONTRIBUTING`, `CODEOWNERS`, commit-convention files | ok, or the warn — in the future tense since 1.1.0 (#391): learning conventions from merged PRs is the knowledge roadmap, not built |

**Bounded and honest.** A scan spends at most 24 probes in 20 s, 4 at a time, and stops at the
host's first rate-limit refusal. A row it could not determine is stored with verdict `warn`,
`evidence.undetermined: true` and a value that says why — never omitted. `duration_ms` is the
card's `scanned in 38s`. Re-scans take the next `scan_seq`; an `edited` protected path is never
overwritten. When the test plane (#324) has a completed run, the tests row is relabelled
`measured` with the real counts — at scan time, and on read.

**The protected-path list is a person's once saved** (since REST 0.40.6,
[#391](https://github.com/NobuData/ouroboros/issues/391)). `PUT …/protected-paths` replaces the
repository's list: every glob in it becomes `edited`, every other is removed, and V105's
`onboarding_state.protected_paths_edited_at` is stamped (the database's clock — the column may not
predate the row), after which no scan writes a suggestion for the repository. These are the rows
AP.3's `allowed_paths` guardrail (#305) reads on the next run, so the route is owner/admin, and a
glob the guardrails cannot enforce (blank, padded, absolute, a backslash, a `..` segment, a control
character, over 512 characters) is refused `422 detection_glob_invalid` with every refused glob in
`details.invalid`, writing nothing.

**A new pack is a file in `detection/packs/` and an entry in `CORE_PACKS`** — it may emit
`custom:<name>` rows, and the orchestrator (`detection.scan.ts`) never names a pack.

**Rows are served in card order** — the six core rows as mockup 13 draws them, then any
`custom:*` rows by key. The order is the row key's rather than the insert's since REST 0.37.40
([#389](https://github.com/NobuData/ouroboros/issues/389)): a scan writes its rows in one
statement, so they share a `created_at`, and ordering by it had left the card's order to a random
`id` for every scan but the seeded one.

## Template tiles and instantiation

Step 3 of the wizard ([#386](https://github.com/NobuData/ouroboros/issues/386), BB.3 — the service
layer of WF-T.5, #159), since REST 0.37.28. The tiles are V068's `workflow_templates`, and
**selecting one creates a real workflow** (decision **O4**):

```
GET  /api/v1/onboarding/templates?repo=owner/name        any member — the tiles, gates evaluated
POST /api/v1/onboarding/select-template?repo=owner/name  owner, admin — instantiate { slug }
```

```
select quick-fixes ─▶ locked? ─▶ 409 onboarding_template_locked { progress: "3 of 10 merged loops" }
                   ─▶ live workflow from it? ─▶ reuse it (created: false)
                   ─▶ WorkflowsService.createFromTemplate:
                        publish gate (zod · registry · engine) ─┬─ findings ─▶ 422 onboarding_template_invalid
                                                                └─ green ───▶ one transaction:
                                                                   workflow {template: quick-fixes@v1} + draft
                                                                   publish v1
                   ─▶ onboarding_state.selected_template = quick-fixes
                   ─▶ { created, workflow { studioPath: /workflows/quick-fixes }, kept[], onboarding }
```

- **No wizard bypass.** Instantiation goes through the lifecycle's own publish gate, exactly as
  the studio's Publish does, and the gate runs before the transaction opens — a refused
  definition leaves no workflow, draft or choice behind. The onboarding module writes no
  `workflows` row of its own (`templates.service.spec.ts` scans for one).
- **Provenance** — `workflows.template_slug` + `template_version`. A later template version is a
  new immutable row (V068), so it never changes a workflow already made.
- **Slug collision → suffix flow**: `quick-fixes-2`, titled `Quick fixes (2)`, and so on.
- **Re-selection deletes nothing**: the active choice switches, and every other live instantiated
  workflow is reported in `kept`.
- **The lock is computed** by V068's `workflow_template_unlocked` against `merged_loop_count(org)`
  (merged runs), with `OURO_ONBOARDING_UNLOCK_THRESHOLD` as the operator's override. A gated tile
  carries `unlock { locked, mergedLoops, threshold, rule, progress }`.
- **Captions are qualitative** (**O8**): a caption with a digit or `%` is dropped on the way out,
  on top of V068's CHECK — no tile prints an invented statistic.
- Selecting publishes, so it takes the studio's publish roles (owner, admin), not a pick's.

## The safe-first-issue picker

Step 4's *"We picked a safe one"* ([#387](https://github.com/NobuData/ouroboros/issues/387), BB.4,
decision **O5**), since REST 0.37.31. The pick is **a deterministic score, never a model's
opinion**, over the repository's sized GitHub mirror (INTAKE-L.3's estimates), and the card's
line is that score rendered:

```
GET /api/v1/onboarding/first-issue?repo=owner/name               any member — the card
GET /api/v1/onboarding/first-issue/alternatives?repo=…&limit=10  any member — or pick your own
```

| Component | Signal                          | `safety-v1` points                                    |
|-----------|---------------------------------|-------------------------------------------------------|
| effort    | the estimate's size             | XS 35 · S 20 · M 5 · L / XL **excluded**              |
| workflow  | the suggested workflow          | `docs-loop` 30 · `standard-fix` 15 · anything else 0  |
| paths     | breakdown files                 | ∩ protected globs ≠ ∅ **disqualifies** · no code 25 · code 5 |
| freshness | the issue's last activity       | 10, halved every 14 days of quiet                     |

The safety bar is 45 of 100. The weights live in `onboarding/first-issue.score.ts` and every
answer names their version (`weightsVersion`).

```
score(#488) = XS 35 + docs-loop 30 + no code 25 + fresh 9.4 = 99.4 ─▶ picked
reasoning.fragments = [paths "no code paths touched", estimate "est. 4 min"]  (+ cost "est. $0.03" only when priced)
reasoning.line      = fragments joined with " · "
```

- **The reasoning is the score, rendered.** Each fragment names its source — a score component
  or the estimate — and `reasoning.components` is the full breakdown for the detail affordance.
  No string is written for a particular issue (`first-issue.score.spec.ts` asserts it).
- **Minutes come from the estimate**: the midpoint of `breakdown.cycle_min`/`cycle_max`, rounded
  down — a loop's wall clock — not `est_minutes`, which is the queue's planning number.
- **Cost only when priced** (decision N10): the routed model through `ouroboros.model_price()`,
  costed at its input rate as the planning footer does. Unpriced, seat- or usage-billed →
  `cost` is **absent**, never `$0`.
- **A protected path disqualifies** (`protected_path_policies`, #380) — the candidate leaves the
  ranking whatever it would score. **Nothing below the bar is ever picked.**
- **Cold states**: `sizing` (open issues, none sized — `estimator` is the nightly job's real
  schedule and last run, AL.5 #281), `empty` (no open issues — `planning.path` is `/planning`),
  `none_safe` (sized issues, none clears the bar). `estimator` travels on any answer while issues
  still wait to be sized.

## The first-run launcher and smart defaults

**Run my first loop** and the wizard's right column
([#388](https://github.com/NobuData/ouroboros/issues/388), BB.5, decisions **O6**–**O9**), since
REST 0.37.38:

```
POST /api/v1/onboarding/launch?repo=owner/name    owner, admin, member — guard, queue, receipt
GET  /api/v1/onboarding/defaults?repo=owner/name  any member — rows, reassure claims, timeline
```

### The launch

```
launch ─▶ guards: steps 1–3 done · a pick that is this repository's issue ──✗─▶ 409 + stated reason
       ─▶ queue (M.3 #112), naming the instantiated workflow ─▶ R.1 (#143) pins its version, `explicit`
       ─▶ complete-step 4: completed_at stamped · dry-run defaulted ON if unset
       ─▶ dry-run read back ─▶ receipt {queue item, pin, dryRun, links, run: null, timeline [projected]}
```

- **It launches what exists.** The issue is queued; nothing here starts a loop, because autonomous
  execution (AR.1, [#315](https://github.com/NobuData/ouroboros/issues/315)) does not exist. The
  receipt's `run` is `null` until a run of the issue does (BD.1,
  [#396](https://github.com/NobuData/ouroboros/issues/396), fills it live) and `links.console`
  with it.
- **The guards state their reason.** `409 onboarding_step_incomplete` carries the blocking step
  (1–3) and its derived sentence; `409 onboarding_pick_required` says why there is nothing to
  queue — nothing picked, a pick that is another repository's, or one the backlog does not mirror.
  Nothing is written on a refusal.
- **The queue item is the dashboard's own.** `queue` is `QueueItemSummary`, mapped by the same
  function `GET /api/v1/queue` uses, and `workflow` is that item's pin — so the receipt names what
  the queue holds, not what the launcher intended.
- **Dry-run is confirmed, not assumed.** It is read from the database *after* completion. A
  workspace that turned it off keeps it off, and `dryRun.note` says *"Dry-run is off … not
  draft-only"*.
- **A repeat is not a second launch.** `outcome` is `queued`, `already_queued` (the queue already
  held the issue — a double press, or a race the queue's own key settles) or `already_started` (a
  run exists). The queue write's own refusals (`queue_issues_not_queueable`,
  `queue_workflow_unknown`, `queue_issues_conflict`) pass through and nothing is completed.

**The pick link.** The wizard stores a canonical ticket (`picked_ticket_id`), while the queue write
and BB.4's picker speak `github_issues` ids. The launcher resolves ticket → mirrored issue by
repository and number — the join the rail's step 4 already uses — and `PATCH /api/v1/onboarding`
accepts `pickedIssueId` (the picker's `issueId`), which it resolves to that issue's canonical
ticket and stores: `404 onboarding_issue_not_found` outside this repository's backlog,
`422 onboarding_issue_ticket_missing` when no GitHub source has read the issue yet,
`422 onboarding_pick_ambiguous` when both pick fields are sent.

### The smart defaults

Rows are **selected by declared deployment capability, not greyed out** (O6). The flags are
configuration — `OURO_MANAGED_KEY_POOL`, `OURO_HOSTED_RUNNER_POOL`, both `false` unless declared —
and the pools themselves arrive with BD.2 ([#397](https://github.com/NobuData/ouroboros/issues/397)):

| Row | Pool declared | Not declared — the self-hosted default |
|---|---|---|
| models | `managed_keys` — *managed keys* (+ *with $5 trial credit* only when `OURO_MANAGED_KEY_TRIAL_CENTS` is set) | `bring_your_own_keys` → `/models/providers` |
| build | `hosted_runner` — *hosted runner for your first loops* | `enroll_runner` → `/build-farm` |
| estimator | `nightly_estimator` — the real nightly job's schedule and last run (AL.5, #281) | the same |
| slack | `slack_future` — `optional`, unlinked: there is no Slack surface yet | the same |

A self-hosted payload therefore contains **no** managed-key or hosted-runner row and no trial
copy — `defaults.resources.spec.ts` and `defaults.service.spec.ts` assert it from the environment
variable down. No trial figure is built in.

**The reassure strip** (O9) is assembled from claims whose mechanism the workspace has, each
naming that mechanism (`key`, `description`, `issue`, `path`):

| Claim | Holds when | Mechanism |
|---|---|---|
| `draft_only` — *Nothing is written to main.* | dry-run is on, or was never answered (launching turns it on); dropped on an explicit *off* | `dry_run_policy` (#382) |
| `uninstall` — *The app can be uninstalled in one click.* | the account records a GitHub App installation | `github_app_uninstall` (#122) |
| `uninstall` — *The GitHub connection can be paused in one click.* | a token source covers the repository | `source_pause` (#141) |
| `vault` — *Your keys are sealed in the tenant vault and never leave the control plane.* | always — the service does not start without the vault's key | `vault_envelope_encryption` (#222) |

**The timeline** (`launch.timeline.ts`) is a projection and says so: `kind: "projected"` on the
card and on every row. Its only number is the picked issue's own estimate — the first-issue card's
`est. 4 min`, on the draft-PR row — and the review and merge rows follow the dry-run state. It is
the same projection before launch (`defaults`) and after it (the receipt).

**No aggregate statistic** (O8) appears in either payload: nothing is measured across teams, so
the mockup's *"4m 10s"* and *"92%"* have no counterpart, and the suites assert their absence.

### Onboarding suites & mutation checks

BB.6 ([#389](https://github.com/NobuData/ouroboros/issues/389)) certifies the onboarding plane
under `yarn test:integration`, beside BB.1–BB.5's own suites. Most of the plane's risk is in the
joins — the rail reads four subsystems, the launcher composes three, and dry-run is enforced in
the PR plane — so each suite writes the *other* plane's rows and reads the wizard back:

| Suite | Holds |
| ----- | ----- |
| `onboarding/derivation.certification.integration-spec.ts` | every subsystem state × its step, written to `ticket_sources`, `github_orgs`/`github_repos`, `workflows`, `queue_items`/`runs` and read over HTTP, with the wizard's own row untouched; a forward traversal that tries every `complete-step` at every stage; `onboarding_state` has no column for a step status and no second table exists for one |
| `detection/detection.certification.integration-spec.ts` | the four archetype trees scanned through `POST …/detection/scan` — registry, GitHub provider, rate guard, rule packs, V067 — and what the card serves held to `detection.archetypes.golden.json`; evidence names pack, version and probes really asked; join, debounce and `scan_seq`; detected → measured; a pack beside the core; budget exhaustion |
| `onboarding/launch.certification.integration-spec.ts` | twelve guards, each taken away through its owning subsystem: the refusal's code and reason, and a zero write footprint (no queue item, no completion stamp, no policy row) — beside a control launch of the same bench |
| `onboarding/onboarding.certification.integration-spec.ts` | the picker reordered by a weight change and answering `none_safe`; the caption statistic scan (O8), first run against the mockup's own two invented lines; one workspace read under three deployments (O6) |
| `onboarding/dry-run.roundtrip.integration-spec.ts` | the wizard's launch turning dry-run on, then the PR plane on the in-memory git host: a PR forced to draft, arm and merge refused, the armed plan refused at execution, auto-merge overridden with every workflow document unchanged — and the flip restoring all of it |
| `onboarding/onboarding.isolation.integration-spec.ts` | two workspaces mirroring the **same** repository, so every stored `repo_ref` is the same string; every onboarding route, enumerated from the route table, answers each from its own rows only |

**The archetype host** (`detection/detection.archetypes.fixture.ts`) replaces one provider — the
Octokit factory — and answers GitHub's three probe routes from the checked-in trees in
`detection.fixture.ts`, in GitHub's own shapes (`blob`/`tree` items, base64 contents, `404`, the
empty repository's `409`). Everything above Octokit is the application's own, and no request
leaves the process. Regenerate the golden file with
`OURO_UPDATE_GOLDENS=1 yarn test:integration src/modules/detection/detection.certification` and
review the diff.

**`onboarding.integration.fixture.ts`** is the shared bench, and `shipTemplates` in it is why
these suites do not care what ran before them: `ApiHarness.truncate` empties `workflow_templates`,
V068's shipped rows included, so a suite re-runs the migration's own `insert` rather than
restoring a copy it read from a table an earlier suite may already have emptied.

**Mutation checks.** Each suite's header names the production change that turns it red, and each
was run: a launcher guard removed (one fixture each), a rule pack removed or a probe-table entry
renamed (the goldens), the debounce or the relabel skipped, each of the four dry-run enforcement
points deleted, the plan's auto-merge override dropped, completion no longer adopting dry-run,
`pick` ignoring the safety bar, a statistic served in a caption, a capability flag ignored, a
`step_status` column added to `onboarding_state`, and the workspace predicate taken off seven
statements one at a time.

## The workflow lifecycle API

**Seven operations under `/api/v1/workflows`, and two of them are the whole of P.3**
([#134](https://github.com/NobuData/ouroboros/issues/134)). The rest is ordinary CRUD; the
draft save and the publish are where a workflow studio is easy to get subtly wrong, so they
are specified rather than assumed.

```
GET    /api/v1/workflows                 any member      the rail — P.4's entries, verbatim
POST   /api/v1/workflows                 owner · admin   + New workflow: entity + draft, one transaction
GET    /api/v1/workflows/{id}            any member      the canvas: entity + draft slot + one version
PATCH  /api/v1/workflows/{id}            owner · admin   name and status — never the slug
PUT    /api/v1/workflows/{id}/draft      owner · admin   autosave, If-Match required
POST   /api/v1/workflows/{id}/publish    owner · admin   [zod ✓][engine ✓] → v+1, immutable
GET    /api/v1/workflows/{id}/versions   any member      the history, documents excluded
```

**The rail is P.4's answer served, not recomposed.** `GET /api/v1/workflows` returns
`WorkflowStatsService`'s entries — the same objects [the statistics
section](#the-workflow-rails-statistics) describes — which is what that module's export was for.
It is a named array rather than a page, because the rail is a workspace's *whole* set and every
`usagePercent` is a fraction of one denominator measured across all of them.

### The draft, and the etag that guards it

A workflow has **one** draft (`workflow_versions.version is null`, V029) and any number of
published versions. The draft is the only mutable document; a published one cannot be revised by
anybody, including an owner, because a run pins the version it executed (decision **P1**,
enforced by a trigger for every role).

```
GET  /api/v1/workflows/{id}          →  { draft: { etag: "2f0a…", definition: {…} }, … }
PUT  /api/v1/workflows/{id}/draft       If-Match: 2f0a…
                                     →  200  { etag: "8b1c…", … }        the next save's token
                                     →  409  workflow_draft_conflict     someone else got there
                                     →  400  workflow_draft_etag_required  no header at all
```

Four decisions hold that together, and each is a failure mode rather than a preference:

* **The etag is a digest of the draft row's identity and its document — not its `updated_at`.**
  A `timestamptz` reaches this service as a `Date`, whose resolution is a millisecond, so two
  autosaves that close together would share a stamp and therefore an etag, and one edit would
  be lost with nobody told. Hashing the document makes *stale* mean what a person means by it:
  **the document you edited is not the document that is stored**.
* **"There is no draft" has an etag of its own** (`none`), so a client's first write is the same
  three lines as its hundredth — read, edit, `If-Match`. Two writers who both hold it do not
  both create one: `workflow_versions_one_draft_idx` refuses the second, reported as the same
  `409`.
* **A missing `If-Match` is a `400`, not a default and not a conflict.** Forgetting the guard
  and losing a race are different mistakes, and a client that could opt out by omitting a header
  would opt out by accident. `*` is the only opt-out and has to be typed.
* **The comparison is made against a `for update` read inside the write's own transaction.** Two
  autosaves a millisecond apart are then separated by PostgreSQL rather than by luck: the second
  blocks, re-reads what the first committed, and is told.

**The draft is not validated.** `{}` is the blank canvas and a half-built graph is what autosave
exists to keep; the grammar is checked once, at publish. An autosave that refused work in
progress would be an autosave nobody could use.

### Publishing: two validators, and nothing written unless both are green

```
draft ─▶ zod (P.2, in process) ─┬─ any error ─▶ 422, and the engine is never asked
                                └─ green ────▶ engine (R.2, over the wire)
                                               ─┬─ any finding ─▶ 422
                                                └─ green ──────▶ BEGIN
                                                                  lock the workflow
                                                                  draft still the one validated?
                                                                  INSERT v+1 · move current_version
                                                                 COMMIT
```

**The gate runs before a transaction is opened**, which is what makes *creates nothing*
structural: there is no unit of work to roll back. It is also why the engine call cannot be
inside one — a five-second network deadline holding a pooled connection would put the engine's
latency into this service's connection budget. What replaces the transaction's protection is the
re-check inside it: the draft's etag is compared against the one the validated document came
from, so **what becomes immutable is what passed**.

**zod first, and a document it refuses never reaches the engine.** The overwhelmingly common
failure is a canvas somebody is still building, which then costs no hop; and a list of findings
never says the same thing twice in two vocabularies. Each finding carries `source` (`dsl` or
`engine`), that validator's own `code`, and an anchor — `node`, `edge`, or a `path` JSON
Pointer — so the studio can select the offending node when somebody clicks one.

**The engine leg is not optional.** R.2 ([#144](https://github.com/NobuData/ouroboros/issues/144))
publishes `POST /v0/workflows/validate`, so an engine that cannot answer it — **down**, refusing,
answering off-contract, or a build that does not serve the route at all — is
`502 engine_unavailable`, and the publish is refused. Until R.2 landed, a `404` was read as *this
engine build predates the route* and the publish went ahead on the zod verdict; that tolerance was
retired together with the tripwire in `engine.contract.spec.ts` that was written to ask for exactly
that. The integration harness's engine stub publishes the route too, answering green and recording
what the gate sent.

**Publishing copies the draft rather than promoting it.** V029 permits either; copying is what
leaves the canvas with a draft to autosave into and an etag that did not move, so *edit →
publish → edit again* needs no round trip to re-create one. The version number is offered as
`max + 1` and the database decides: `workflow_versions_next_version` refuses anything else and
the unique key lets one of two racing publishers commit, which surfaces as
`409 workflow_publish_conflict` rather than a silent retry — the loser's document may no longer
be the one they meant to build on.

### What this API will not do

| | Why |
|---|---|
| Change a slug | It is the bridge a stored `runs.workflow_tag` resolves through (decision **F8**, V029). Renaming it would silently re-point every closed run that carried it. |
| `DELETE` a workflow | `archived` is the soft delete: off the rail and out of the assign vocabulary, history intact. A hard delete would have to mean destroying the provenance of every run that named it. |
| Invent a slug from an unfoldable name | A title with no ASCII letter or digit yields none, and `workflow-1` would be an identifier with no relationship to what somebody typed. `422 workflow_slug_required` asks for one. |
| Inline documents in the history | A definition holds up to 20 000 characters of prompt per model stage. One document is read by number, through `?version=`. |
| Answer `403` for another workspace's id | A `403` confirms that an identifier names something real, which is the whole of what somebody enumerating uuids is trying to learn. |

**Reading is every member's, `viewer` included; every write is `owner` or `admin`.**
`CONTRIBUTORS` was the wrong list here: a `member` is somebody who works here, and publishing
changes what every future run of the workspace does.



## The stage catalog

**`GET /api/v1/workflows/catalog` is what Add stage ▾ and the inspector render from**
([#145](https://github.com/NobuData/ouroboros/issues/145)). Hard-coding node types in the UI would
fork the DSL — the schema saying one thing and the form another — so the node types, their forms
and their defaults cross the wire instead. Any member may read it.

```
GET /api/v1/workflows/catalog
 ─▶ { schemaId: https://ouroboros.build/schemas/workflow-dsl/v1.json,
      nodeTypes: [ {type: trigger, label, glyph: ▸, class: trigger, configSchemaRef, configSchema, defaults},
                   {type: llm … ◆}, {type: infra … ▣}, {type: flow … ◇}, {type: term … ●} ],
      suggestions: { skills: registry slugs (non-draft, published), taskRoutes: task_kinds in matrix order } }
```

| Field | Where it comes from |
| --- | --- |
| `nodeTypes[].type`, and their order | `$defs.node.properties.type.enum` in the published schema |
| `configSchema`, `configSchemaRef` | The definition `$defs.node.allOf` dispatches that type to, served with a `$defs` holding exactly the definitions it reaches — the parsed file itself, read once at boot (`catalog.schema.ts`) |
| `label`, `glyph`, `class` | `catalog.presentation.ts` — mockup 04's `.node.<class>` treatments, held to the mockup by its spec |
| `defaults` | `catalog.presentation.ts` — a model stage omits `prompt_template`, `routing` and `permissions` (decision **P9**) and is flagged until the author decides them; every other type's defaults validate |
| `suggestions.taskRoutes` | The workspace's `task_kinds`, by `sort_order` — registry data, so the DSL, the catalog and the routing matrix share one vocabulary (decision **M3**) |
| `suggestions.skills` | The [skills registry](#skills) ([#410](https://github.com/NobuData/ouroboros/issues/410)) — every skill that is not a draft and has a published version, by slug. P7's unknown-skill warning checks the same list, so it fires only for a skill that genuinely does not exist |

**The config schemas are the published artifact, not a copy.** The service reads
`schemas/workflow-dsl/v1.json` — the file `dsl.conformance.spec.ts` compiles — and the container
carries it at `/app/schemas/workflow-dsl/v1.json`. `catalog.schema.spec.ts` asserts that the served
keywords are the file's parsed values by identity, and that each served schema classifies every
golden fixture's configs exactly as the definition inside `v1.json` does.

**A node type added to the DSL needs no UI change.** Add it to the `type` enum, give it a
`<type>_config` definition and its `allOf` branch, and it is served with a working form and a
neutral presentation — `□`, its own name as label and class, an empty config. `catalog.fixture.ts`
does exactly that with a synthetic `sandbox` type. `catalog.presentation.spec.ts` then fails until
the type is drawn a glyph, so a shipping type never keeps the placeholder.

**Suggestions are advice** (decision **P7**). Nothing constrains a stored reference: a draft or a
publish naming an unlisted skill succeeds, and `toDslCatalogue(suggestions)` is the catalogue the
inspector validates with, so an unknown name comes back as a `reference.unknown_*` **warning**. An
empty list means *nothing to suggest*, and is left out of that catalogue rather than flagging every
name. A pinned **alias** is the one exception, and only at publish: routes and workflows may only
reference registry aliases, so the publish gate refuses a pin the workspace's registry does not hold
— or a raw model id where the alias belongs — with a `suggestion`
([`docs/WORKFLOW_DSL.md` §8.3](../docs/WORKFLOW_DSL.md#83-publishing-registry-aliases-only)).

### The code symbol table

**`GET /api/v1/workflows/code-symbols` is what the code editor completes and documents from** (W.1,
[#177](https://github.com/NobuData/ouroboros/issues/177)). Decision **C5** asks for editor
intelligence from what is already on disk rather than from a language server, and most of it is
already in this module: the grammar's tables and the published schema.

```
GET /api/v1/workflows/code-symbols
 ─▶ { schemaId,
      scopes:  [ {scope: stage.llm.options,  completions: [{label: tokenBudget, kind: property, symbol: stage.llm.tokenBudget}, …]},
                 {scope: stage.openPr.merge, completions: [squash, merge, rebase]},
                 {scope: route.task,         completions: [this workspace's task kinds, each suggestion: true]}, … ],
      symbols: [ {symbol: route.task, signature: route.task(name: TaskKind): ModelRoute,
                  doc: "Resolves the model assigned to a task kind in Model Routing."}, … ] }
```

| Part | Where it comes from |
| --- | --- |
| Scope and symbol names, option keys and their order, predicate methods, effort constants | `code.grammar.ts`, the tables the printer and parser already read |
| Where each word lives in the schema | `code.grammar.ts`' pointer tables: `STAGE_OPTION_FIELDS`, `ROUTE_SIGNATURES` and the rest |
| Types, enum values and docs | `schemas/workflow-dsl/v1.json`, read at boot by `code.symbols.schema.ts` |
| `route.task` and `stage.llm.skill` suggestions | The stage catalog's suggestions, from the same read (`WorkflowCatalogService.codeSymbols`) |

**Nothing is invented.** A doc is a schema `description`, verbatim. A symbol whose location has
none has a signature and no doc, and the editor shows no card for a name the table does not list.
Mockup 05's Types card adds *"Falls back to the tenant default chain."* Routing has no such chain
(an unrouted task kind is `route_not_found`), so the served doc is the first sentence, which
`v1.json` carries as `inherit_task`'s description.

**A change at a source surfaces with no other edit.** A key added to `STAGE_OPTIONS` is offered,
with a name-only card until it points into the schema. A value added to a schema `enum` is offered
wherever its key takes it, and a description added to the schema becomes the doc. A value the
grammar cannot spell, such as `effort.XXL`, is not offered, because the parser would refuse it. A
pointer the schema no longer has fails the service at boot. `code.symbols.spec.ts` proves each, and
`schemas/workflow-dsl/fixtures/code-symbols/table.json` is the golden answer `ouroboros-ui`'s suites
are written against.

### The code view

**`GET` and `PUT /api/v1/workflows/{slug}/code` are mockup 05's editor over the draft the canvas
edits** (U.3, [#167](https://github.com/NobuData/ouroboros/issues/167)), and `code-tree` and
`code-config` are its explorer.

```
GET /api/v1/workflows/standard-fix/code ─▶ { path, slug, text, etag, readOnly, version, currentVersion, spans, diagnostics, outlineRef, checksRef }
PUT /api/v1/workflows/standard-fix/code   If-Match: <etag> · { text }
 ├ does not parse, or names another slug ─▶ 422 workflow_code_invalid {errors: [{code, line, column, endLine, endColumn}], diagnostics}
 ├ stale etag                            ─▶ 409 workflow_draft_conflict {editedIn: visual | code, updatedAt, current}
 └ WorkflowsService.writeGuarded(…, "code") ─▶ 200, the file as it now reads, with the new etag
GET /api/v1/workflows/standard-fix/code/checks ─▶ { path, slug, etag, readOnly, version, rows: [graph, references?] }
POST /api/v1/workflows/standard-fix/code/validate ─▶ the publish gate (zod ▸ registry ▸ engine), nothing written
 ├ engine cannot answer                  ─▶ 502 engine_unavailable — never a pass
 └ 200 { file (diagnostics + registry/engine findings on their lines), checks, findings, engineConsulted }
GET /api/v1/workflows/code-tree          ─▶ { files: [workflows/<slug>.loop.ts …, ouroboros.config.ts] }
GET /api/v1/workflows/code-config        ─▶ { path: ouroboros.config.ts, text, readOnly: true }
PUT /api/v1/workflows/code-config        ─▶ 405 workflow_code_read_only, Allow: GET
```

| Rule | Where it lives |
| --- | --- |
| One draft, two editors (C3): both saves go through one guarded write, and V033's `edited_in` records which editor wrote the draft, so a `409` can name it | `WorkflowsService.writeGuarded`, `workflows.errors.ts`' `draftConflict` |
| A file that does not read changes nothing (C4): it is parsed, and its slug checked, before a transaction opens | `code.service.ts` |
| A document is shown only when its file reads back as it | `code.projection.ts` |
| The explorer lists files only, from the rail's own statement (C6) | `code.resources.ts`, `WorkflowStatsRepository.registryEntries` |
| `ouroboros.config.ts` is the registry, printed read-only | `code.config.ts` |
| Findings and reference checks sit on the lines of the stage they are about, through the printer's span map, errors first (W.2) | `code.diagnostics.ts` |
| Loop Checks rows say only what was checked, and no infra row can be built (C7) | `code.checks.ts` |
| Validate is the publish gate with nothing written (V.6, [#174](https://github.com/NobuData/ouroboros/issues/174)): the gate publishing runs, its registry and engine findings placed on their stages' lines, every member's | `WorkflowCodeService.validate`, `code.diagnostics.ts`' `placeFindings` |

**A draft that has no faithful file is refused, not approximated.** The printer takes valid documents
and a draft is saved as the canvas holds it, so the rule is the round trip itself: `GET` shows a
document only when printing it and parsing the print gives it back. A graph with an unreachable stage
passes, since the code view edits work in progress. The blank canvas **+ New workflow** leaves does
not, and answers `409 workflow_code_unprojectable` with the validator's findings. A workflow with no
draft opens on the version in force, and its first save creates the draft.

**The `422` is proven byte-identical.** `code.integration-spec.ts` compares the draft row as
PostgreSQL renders it, every column included, before and after a refused save.

**Two editors on one draft are proven to converge** (U.4,
[#168](https://github.com/NobuData/ouroboros/issues/168)). The same suite runs four sequences:

* a canvas save, then a save from a code tab holding the old etag: a `409`, then a reload whose save
  keeps both edits;
* saves alternating between the two editors;
* two saves racing on one etag: exactly one is written, and the loser is told which editor won;
* a file that doesn't read: a `422` that moves neither the row nor the etag the canvas holds.

After each step it reads the draft through both editors and requires the file to parse back to
exactly the canvas's document.

**Every file carries its span map and its diagnostics** (W.2,
[#178](https://github.com/NobuData/ouroboros/issues/178)). The printer's `spans` place each
validation finding and reference check on the lines of the stage it is about, and a refused save's
`422` carries its parse errors in the same `{severity, range, code, message, note?}` shape as
`details.diagnostics`. The findings come from this process's validator, which `expected.json` holds
in parity with the engine, so opening a file makes no engine call. References are checked against
the workspace's own task kinds and skill suggestions, so the development seed's `standard-fix` shows
`split` as unrouted: the seeded routing matrix has no `split` kind. `checksRef` points at
`…/code/checks`, whose rows (`graph`, then `references`) say only what was checked, with no infra
row (C7). A cycle of `next` and `branches` edges that no loop edge declares is
`graph.undeclared_cycle`, a warning checked here rather than in the shared validator, so it changes
no publish. `outlineRef` stays `null`: the outline is the stage calls `spans` already lists.
`code.checks.spec.ts` reads the Loop Checks rows out of `docs/mockups/05-workflow-code.html` at test
time, so `ci/rest` watches that one file too.

**The code view's intelligence is held to golden files** (W.3,
[#179](https://github.com/NobuData/ouroboros/issues/179)). A grammar change that adds a line to the
print shifts every span below it, and nothing crashes. So `code.intelligence.spec.ts` holds every
seeded workflow's span map, diagnostics, Loop Checks rows and completion contexts to
`schemas/workflow-dsl/fixtures/code-intelligence/`. `code.intelligence.integration-spec.ts` holds
what `GET` and `PUT /code`, `…/code/checks` and `code-symbols` serve to the same files. Two oracles
share none of the printer's arithmetic. The TypeScript compiler reads each stage call's lines, and a
walk of its tree names each word's scope the way `ouroboros-ui`'s `context.ts` does. Edit-shift
cases grow and shrink the content above each stage, and every span and finding below must move by
exactly that much. A moved answer fails naming the golden, the case and the command that
regenerates the files. That command is refused where `CI` is set:

```bash
OURO_UPDATE_GOLDENS=1 yarn jest src/modules/workflows/code.intelligence.spec.ts
```

## Skills

**`/api/v1/skills` is mockup 14's skills registry** (BF.1,
[#410](https://github.com/NobuData/ouroboros/issues/410)) over V069's `skills` and
`skill_versions`: markdown with YAML frontmatter, scoped `org`, `repo` or `workflow`, versioned on
the workflow lifecycle's model — one mutable draft, immutable published versions. Every member
reads; `owner` and `admin` write; `required` is an owner's.

```
GET    /api/v1/skills                    ─▶ { skills: [...], active }       drafts never counted as active
POST   /api/v1/skills                    { text, slug?, scope?, repoRef?, workflowId? } ─▶ 201, a draft
PUT    /api/v1/skills/{slug}/draft       If-Match: <etag> · { text }  ─▶ the draft   (stale ─▶ 409)
POST   /api/v1/skills/{slug}/publish     { changeNote? } ─▶ v+1, in force; earlier versions immutable
PATCH  /api/v1/skills/{slug}             { enabled?, required?, draft? }
 ├ enabled: false on a required skill ─▶ 403 skill_required_locked "required by policy — cannot disable"
 └ required changed by a non-owner    ─▶ 403 skill_required_owner_only
DELETE /api/v1/skills/{slug}             referenced by published workflows ─▶ 409 skill_referenced {workflows}
POST   /api/v1/skills/{slug}/scope/preview { scope, repoRef?, workflowId? } ─▶ { reach, references, clashes, previewToken }
POST   /api/v1/skills/{slug}/scope       { …, previewToken, resolve?: keep_both } ─▶ 200 | 409 stale | 409 conflict
GET    /api/v1/skills/stats?days=30      ─▶ { window: {days, from, to}, skills: [{ slug, active, usedBy, injections }] }
GET|PUT /api/v1/skills/{slug}/code       skills/<slug>.skill.md — the code view's document API
```

| Rule | Where it is held |
| --- | --- |
| The frontmatter's shape | `skills.frontmatter.ts` checks V069's `skill_frontmatter_typed` first (plus `name` and `description`), so a bad file is a line-anchored `422 skill_document_invalid`, never a `500` |
| The required lock | the service's designed `403` over V069's `skills_required_enabled` — a direct API call gets the same refusal the locked switch renders |
| A reference is a string (P7) | the delete guard and the scope preview read `config.skill` out of each non-archived workflow's version in force |
| A scope move's clash | another skill at the destination scope and referent with the same name, case-insensitive — slugs are unique per workspace, so the name is what can collide |
| Used by | counted from V071's `context_injections` over the stated window with the BE.5 rule: `—`, `every run`, `every PR`, `physical tests`, else the rounded share |

**The workflow studio reads this registry.** The stage catalog's `suggestions.skills`, the code
symbol table's `stage.llm.skill`, and P7's unknown-skill warning are the published, non-draft
slugs (`SkillsRegistryService`, the module's only export), and the code view's `code-tree` lists a
`skills/<slug>.skill.md` per skill. `OURO_WORKFLOW_SKILL_SUGGESTIONS` is retired.

## Fact lifecycle and the staleness sweep

**`/api/v1/facts` is mockup 14's *Learned by the loop* card** (BF.2,
[#411](https://github.com/NobuData/ouroboros/issues/411), decisions **K3**/**K4**) over V071's
`facts`, `fact_anchors` and `fact_transitions`. Every member reads; `owner`, `admin` and `member`
decide, and the session's person is recorded as every transition's actor.

```
GET    /api/v1/facts?status=              ─▶ { items: [...], counts: {proposed, confirmed, …} }   "2 awaiting review"
POST   /api/v1/facts                      { text, repoRef?, provenanceLine?, refs?, anchors? } ─▶ 201, proposed
GET    /api/v1/facts/needs-you            ─▶ { count, items: [{ kind: fact_review, severity: info, factId, reason, … }] }
POST   /api/v1/facts/sweep                owner/admin ─▶ { changes, anchors, flagged: [...], uncovered }
GET    /api/v1/facts/{factId}             ─▶ the fact + its audit history, oldest first
POST   …/{factId}/confirm | /reject       proposed ─▶ confirmed | rejected        "confirmed by Ken, 6w ago"
POST   …/{factId}/reconfirm               stale ─▶ confirmed
POST   …/{factId}/expire                  { reason } stale ─▶ expired; confirmed ─▶ stale ─▶ expired (two audited edges)
POST   …/{factId}/relearn                 { text? } expired ─▶ a NEW proposal, relearnedFromFactId = the expired one
POST   …/{factId}/anchors · DELETE …/anchors/{anchorId}    path_glob | dependency | platform_version
```

| Rule | Where it is held |
| --- | --- |
| The transition matrix | `facts.lifecycle.ts` — a copy of V071's `facts_legal_transition`, checked first so a refusal is `409 fact_transition_refused` with a stated reason; the trigger is the backstop |
| Every transition is audited | V071's `fact_transitions_record()` trigger, from the `status_changed_by` / `status_reason` the repository writes in the same statement; `confirmation`, `staleness` and `expiry.stamp` are read back from it |
| Expiry snapshots the use count | `previous_use_count` is `count(*)` over `context_injections` in the expiring statement; V071 freezes it, and `usedCount` answers it from then on |
| Re-learn never resurrects | a new `proposed` row with `relearned_from_fact_id`; the expired row, its reason and count stay as they were |
| Anchor-less facts are never swept | the sweep reads only anchored confirmed facts, and every fact's `sweep: {covered, reason: "no_anchors"}` says so |

**The staleness sweep** (`facts.sweep.ts`) flags, it never expires: a matching anchor means
*something changed near this fact*, so a confirmed fact moves to `stale` with nobody behind it and
the matched anchor as the reason — `platform_version anchor zephyr-4.0 matched: removed "revision:
v4.0.0" in west.yml (PR #531)` — and joins the needs-you feed for a person to re-confirm or expire.

| Trigger | What it reads |
| --- | --- |
| Sync-driven | PR sync reports a PR it is the first to see `merged` to `FACT_COMMIT_OBSERVER`; its newest revision's paths and diff sample are matched at once (stamps nothing) |
| Nightly | at `OURO_FACT_SWEEP_HOUR_UTC` (04:00) plus a random minute in the hour after: every merged PR of an enabled GitHub repository since each anchor's `last_checked_at`, then every evaluated anchor stamped |

| Anchor | Fires when (`facts.anchors.ts`) |
| --- | --- |
| `path_glob` | a changed path matches — `path_glob_matches`' grammar, ported and held to V071's probes |
| `dependency` | a changed manifest (`west.yml`, `package.json`, `go.mod`, `Cargo.toml`, `requirements*.txt`, …) adds or removes a line naming it; or the manifest changed and its patch is not in the sample |
| `platform_version` | a changed marker (`west.yml`, `VERSION`, `.nvmrc`, `.tool-versions`, …) removes the anchored version (`zephyr-4.0` → `v4.0.x`) without re-adding it, and names the platform; or the marker changed and its patch is not in the sample |

A change counts for an anchor only if it merged after the fact's confirmation and the anchor's last
check, so a re-confirmed fact is not flagged again by the change that flagged it. A
repository-scoped fact matches only its own repository's PRs (a GitHub source's push target); a
workspace-wide fact matches every repository's.

**The needs-you feed is the `fact_review` contract** mockup 16's inbox (#461) consumes: one item per
proposal awaiting review and per stale fact, `severity: info`, oldest wait first, `factId` its
identity. `count` is the figure #90's needs-you pill joins; the dashboard's pill is not changed
here. `FactsService.propose` is the entry point [BF.3's proposers](#deterministic-fact-proposers)
(#412) call with their own `proposer` and no actor — a proposal is never confirmed automatically. BF.4's [import](#rule-file-import) writes
through `FactsRepository.insert` instead, inside its one apply transaction, with the person applying
as the actor.

## Deterministic fact proposers

**"Learned by the loop", without a model** (BF.3,
[#412](https://github.com/NobuData/ouroboros/issues/412), decision **K5**). The loop already writes
down what it learns — a person's correction note on a failing case, a waiver's reason, a steer
flagged *remember this* — and `fact-proposers/` promotes each into a `proposed` fact whose typed
provenance names the source itself.

```
source written ─▶ registry entry ─▶ skip {reason} | candidate ─▶ sealCandidate (no status, ever)
  ─▶ a fact already cites the source?          already_proposed   (idempotent)
  ─▶ normalized text matches a fact, any status suppressed + fact_suppressions row
  ─▶ FactsService.propose(actor null)          proposed           awaiting review
```

| Proposer (v1) | Source | Candidate | Provenance refs · line |
| --- | --- | --- | --- |
| `correction_note` | a **person's** classification carrying a note (#332) | the note's lead instruction · `convention` | `run`, `pull_request?`, `classification` · `from correction note (run #1847)` |
| `waiver` | a waiver's reason (#327, cases or a criterion) | the reason's lead · `environment` (rig, farm, network, toolchain…) or `limitation` | `run`, `pull_request?`, `gate*` (the PR's `test_suite`/`physical_hil` for a case waiver), `waiver` · `from waiver on PR #514 · environment` |
| `steer` | a steer with `remember: true` (#306's amendment); without it, nothing | the steer's lead · `instruction` | `run`, `run_stage?`, `person?`, `steer` · `from remembered steer (run #1847 · Implement)` |
| `import` | BF.4's bullets — the [import](#rule-file-import) runs it in its own apply | the bullet · `convention` | `import` · `imported from CLAUDE.md` |

**The text rule** (`proposers.text.ts`): the lead sentence — up to the first `.`, `!`, `?`, `;` or
line break outside a code span, not an abbreviation's dot — minus a list marker and conversational
filler (*please*, *note:*, *remember to*, *we should*…), whitespace collapsed in prose,
**inline-code spans copied byte for byte**, first letter capitalised, trailing punctuation dropped.
Nothing, one word or more than 200 characters is a `skip`. **Honest provenance**: never the mockup's
`from PR #498 review cycle` — that phrasing belongs to #423's extraction.

**When they run.** The triage service (classify with a note, waive), the criteria service (waive) and
the controls service (a remembered steer) report the row on `FACT_SOURCE_OBSERVER` once their own
write has succeeded; the observer never throws, so a proposer failure is logged and the
classification, waiver or steer stands. `POST /api/v1/fact-proposers/backfill {runId}`
(`owner`/`admin`) runs every proposer over one run's sources, oldest first — idempotent.

**Dedupe is observable.** A candidate whose normalized text (`facts/facts.text.ts`, the key BF.4's
import uses) matches a fact of its repository or the workspace in **any** status — a rejected fact
does not come back — is recorded in V074's append-only `fact_suppressions` (proposer, version, text,
matched fact, provenance, `source_key`), once per source and fact. `GET …/suppressions?limit=` reads
them newest first; `GET /api/v1/fact-proposers` serves the registry as data, `landsAs: proposed`.

**Nothing auto-confirms, asserted.** A candidate type has no status; `sealCandidate` refuses any key
a candidate does not have and freezes the rest; the only write is `FactsService.propose`, which
inserts `proposed` (and V071's trigger refuses anything else). A new proposer is a registry entry and
a loader — `FactProposersService.propose` is generic, and the lifecycle service does not change.

**`/v0/learn`** is the engine contract #423's LLM proposer answers — a source bundle in, candidates
with confidence and typed provenance out — mirrored in `engine/engine.contract.ts` and drift-checked
in `engine.contract.spec.ts`. The engine's installed extractor (`unavailable-v0`) answers no
candidates and says why; `proposers.learn.ts` maps an answer to sealed `llm` candidates, refusing
provenance its sources did not carry.

## Rule-file import

**`/api/v1/knowledge/import` is mockup 14's *Import CLAUDE.md / .cursorrules*** (BF.4,
[#413](https://github.com/NobuData/ouroboros/issues/413)): the agent rules files a team already
maintains become draft skills and proposed facts. Both routes are `owner`/`admin` — the gate on
`POST /api/v1/skills`.

```
POST /api/v1/knowledge/import/preview  { repo }               ─▶ { repo, fingerprint, files: [4], totals }   writes nothing
POST /api/v1/knowledge/import/apply    { repo, fingerprint }  ─▶ the same preview + created: { skills, facts } · audited
```

| Step | What happens (`knowledge-import/`) |
| --- | --- |
| Probe | `DetectionService.readFiles` reads `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.github/copilot-instructions.md` through the source that covers the repository — #384's machinery, one request each. None found is an empty preview (`filesFound: 0`), not an error |
| Parse | `rule-import.parse.ts`, deterministic: sections split at the shallowest heading level used more than once (deeper headings stay in the body) → one skill draft each, name from the heading, description from the lead paragraph; a file with no headings → one skill draft; every short (≤ 200 chars) bullet starting with an imperative word (`Use`, `Never`, `Don't`, … — `IMPERATIVE_WORDS`) and not ending in `:` → one fact candidate. Fenced code is never parsed |
| Dedupe | `rule-import.plan.ts`: a section whose `(file, section)` an earlier import of this repository created is **deduped** when its text matches any version, or becomes that skill's **draft version** when it changed; a fact candidate whose normalized text (case, markup, spacing, trailing punctuation) is already a fact of the repository or workspace — **any status**, so a rejected rule is not proposed again — or already planned is deduped. A removed section or bullet removes nothing |
| Preview | counts per file and kind, up to five samples each, and a sha256 `fingerprint` of every planned write |
| Apply | re-probes, then inside one transaction takes a per-repository advisory lock, re-reads, re-plans and refuses with `409 knowledge_import_preview_stale` unless the fingerprint is the preview's — so it writes **exactly the preview, or nothing**. Audited as `knowledge.imported` (subject `repository`) with the actor, counts and created slugs |

**Everything lands gated.** A created skill is `origin: imported`, `draft: true`, `scope: repo`, its
frontmatter carrying `provenance: {source, section}` — a draft is never injected (V069). An update
writes only a draft version — replacing any unpublished draft of that skill, which the preview
shows as an `update` first — leaving the published version in force. A fact is `proposed`,
`proposer: import`, with provenance `{line: "imported from CLAUDE.md", refs: [{kind: import, file,
section}]}` (V071). So an import fills the review queues and changes no run.

| Refusal | When |
| --- | --- |
| `409 detection_source_missing` | no connected source covers the repository |
| `409 knowledge_import_preview_stale` | a file, fact or slug changed since the preview |
| `422 knowledge_import_too_large` | more than 100 skill drafts or 500 fact candidates in one import |
| `429 knowledge_import_rate_limited` · `502 knowledge_import_source_failed` | the host refused a probe |

## Context assembly and manifests

**`ContextAssemblyService` is decision K8's one implementation** (BF.5,
[#414](https://github.com/NobuData/ouroboros/issues/414)): scoped knowledge in, the manifest every
consumer injects out — and the injection records that every usage number (`used 48×`,
`61% of runs`, the ladder's counts) is counted from.

```
assemble({repo?, workflow?}, consumer, {overrides?, budgetTokens?})
  ─▶ { skillVersions: [hil-safety(required) v3, zephyr-conventions v12, …], facts: [confirmed…],
       estTokens, budgetTokens, trimmed: [], excluded: [], refusedOverrides: [], manifestHash }
POST /api/v1/knowledge/context/preview     the same call, served — records nothing (every member)
POST /api/v1/knowledge/context/injections  what a consumer actually injected → context_injections (member+)
```

| Rule (`context-assembly.resolve.ts`) | |
| --- | --- |
| Scope | an `org` skill is always in scope; a `repo` skill in its repository's (case-insensitive); a `workflow` skill in its workflow's |
| Drafts | a draft skill, or one with no published version, never appears — not even as an exclusion |
| Closest wins | a conflict is two in-scope skills with the same **name** (case-insensitive; slugs are unique per workspace): `workflow` > `repo` > `org`, ties by slug; the losers are `excluded: shadowed`. A switched-off winner takes the name out (`disabled`) — how a workflow-level skill switches a farther one off |
| Required | always holds its name: a closer same-name skill cannot shadow it, a `disable` override is refused (`refusedOverrides: required`), the trim never drops it |
| Overrides | V072's `{enable, disable}` skill-id delta, applied last: `disable` → `override_disabled`; `enable` re-admits a switched-off winner; anything else is refused `shadowed` / `not_resolved` (includes another workspace's ids) |
| Facts | `confirmed` only — the workspace's always, a repository's in that repository's scope |

| Consumer | Injects | Budget | Fact cap |
| --- | --- | --- | --- |
| `estimator` | facts (all `POST /v0/estimate` carries) | 8 000 | 64 (the engine's `MAX_CONTEXT_FACTS`) |
| `run_stage` · `playbook` | skills and facts | 32 000 | — |

**Trim** — tokens are `ceil(chars / 4)`; a caller may ask for a lower `budgetTokens`, never a higher
one. Over a limit, entries drop `org` first, then `repo`, then `workflow` (skills before facts in a
tier, largest first, ties by slug or id); the fact cap first (`item_limit`), the budget second
(`over_budget`). **Every drop is in `trimmed`**, naming the skill *version*. `manifestHash` is
sha256 over the consumer, scope, budget, kept version ids, kept facts and trims.

**Consumers.**

* **Estimator — wired** (`estimation/estimation.knowledge.ts`, the INTAKE-L.1 #105 amendment). Each
  sizing assembles `estimator` for the issue's repository and sends the facts as
  `context.facts` (engine 0.7.6); after the estimate row is stored it records
  `{consumer: estimator, estimateId, factIds, manifestHash}`. A failed assembly sizes without facts
  and a failed record keeps the estimate — knowledge never blocks an estimate; a manifest with no
  facts records nothing.
* **Execution — the AR.1 (#315) contract.** One manifest **per stage**, assembled as the stage
  starts: scope `{repo: <run's repository>, workflow: <run's workflow slug>}`, consumer
  `run_stage`. The stage's `skill:` reference is an ordinary skill — in scope to be injected. A
  playbook launch passes the playbook's `skill_overrides` as `overrides` and records as
  `playbook` against the launched run. The stage injects `skillVersions[].body` (applying each
  entry's `load` / `triggers` to its own task text — assembly does not match triggers) and
  `facts[].text`, then records `{consumer: run_stage, runStageId, runId, skillVersionIds, factIds,
  manifestHash}` — `injectionOf(manifest)`, less any `on_trigger` skill it skipped.
* **Dry run (R.2 #144, #560)** — an ordinary consumer; a preview needs no record.

| Refusal | When |
| --- | --- |
| `404 context_workflow_not_found` | the scope names a workflow this workspace does not have |
| `422 context_overrides_overlap` | one skill id is both enabled and disabled |
| `422 context_injection_consumer_reference` | the references do not fit the consumer (V071's `context_injections_consumer_ref`) |
| `422 context_injection_unresolved` | V071's trigger refused an id: another workspace's, an unconfirmed fact, a draft skill's version |

## Playbooks and the repo-map generator

Two things that are **generated rather than maintained** (BF.6,
[#415](https://github.com/NobuData/ouroboros/issues/415), decisions **K6** and **K2**).

**Playbooks** (`src/modules/playbooks/`) — recipes learned from runs that went well, composed onto
the machinery that already exists. A playbook is V072's row: a workflow **pinned** at a published
version, `{enable, disable}` skill overrides relative to context assembly, a context preset (steer
notes, extra facts) and an optional issue filter.

```
GET    /api/v1/knowledge/playbooks                  the card; each with runCount (counted)
GET    /api/v1/knowledge/playbooks/counts           run 9× for every recipe, zero included
GET    /api/v1/knowledge/playbooks/from-run/{runId} what a recipe learned from the run would hold
POST   /api/v1/knowledge/playbooks/from-run         …named and stored, sourceRunId recorded (admin+)
POST · PATCH · DELETE /api/v1/knowledge/playbooks[/{id}]                               (admin+)
GET    /api/v1/knowledge/playbooks/{id}/issues      Run on issue… ▾ — open issues the filter admits
GET    /api/v1/knowledge/playbooks/{id}/context     the manifest + preset a launch attaches
POST   /api/v1/knowledge/playbooks/{id}/launch      queue the issue under the pin → receipt (member+)
```

| Rule | |
| --- | --- |
| Create-from-run | a **terminal** run only; copies its workflow pin, derives overrides by comparing the skills its injection records name with what assembly resolves for its scope today (`enable` what it carried that assembly would not, `disable` what it went without — never a required skill; no record derives none), and keeps its steers verbatim, oldest first, de-duplicated, ≤ 16 × 2 000 chars |
| Run-on-issue | the issue must pass the filter (V072's `playbook_issue_filter_admits` — the picker and the launch share it), then **M.3's queue write** (#112) runs with the playbook's workflow at its **pinned** version (reason `explicit`, no trigger consulted) and `playbook_id` on the row; every queue refusal applies unchanged |
| The launch | the run that opens (`POST /internal/runs`) for a queued issue **under that row's pin** inherits its `playbook_id` — that run is the launch |
| `run 9×` | `count(*)` of `runs.playbook_id` — **no counter column is written**; a queued item is not a launch until a run opens for it |
| Receipt | the queued item in `GET /api/v1/queue`'s shape, its position, the attached context (the `playbook` manifest with the overrides applied, the steer notes, the fact ids) and links |
| On the queue | a queue item names its recipe — `playbookId`, `null` for an issue queued any other way — since REST 0.37.39 ([#422](https://github.com/NobuData/ouroboros/issues/422)); `GET …/playbooks/{id}/context` is then the context its run will be given, before there is a run to ask |

**The repo-map generator** (`src/modules/repo-map/`) keeps `repo-map` honest nightly at
`OURO_REPO_MAP_HOUR_UTC` (05:00) plus a random minute in the hour after, for every enabled
repository, and on request:

```
POST /api/v1/knowledge/repo-map/regenerate {repo}   (admin+, debounced 60 s per repository)
  ─▶ one tree listing + the CODEOWNERS it holds (DetectionService.readTree, ≤ 2 host requests)
  ─▶ + the newest detection scan (#384) ─▶ deterministic markdown (repo-map.render.ts)
  ─▶ identical to the version in force? unchanged : publish v(n+1) of the generated skill
```

| Rule | |
| --- | --- |
| Bounded | one tree request (≤ 20 000 entries read), at most one file; modules two levels deep, ≤ 20 children each, ≤ 200 rows; ≤ 500 CODEOWNERS rules; a cut is said in the document |
| Ownership | GitHub's CODEOWNERS locations and rules — anchoring, `dir/`, `*`, `**`, `dir/*` direct files only; the last matching rule wins |
| Diff-aware | the body has no timestamp and sorts everything, so identical input renders identical bytes; identical → `unchanged`, nothing written — each version marks a real change |
| The skill | the repository's `generated`, repo-scoped skill — `repo-map`, or `repo-map-<name>` when that slug is taken — created enabled on first generation; `published_at` is the generation time, `published_by` the person (null nightly); a newer map overwrites an unpublished hand edit |
| Rate limits | a refusal skips the repository (`skipped`, nothing written); the nightly pass stops asking a workspace's host after its first `rate_limit` (#101) |
| Recorded | every run — published, unchanged or skipped — is audited as `knowledge.repo_map_generated` |

**Pending is not failed** (BG.6, [#422](https://github.com/NobuData/ouroboros/issues/422), since
REST 0.37.39). A repository whose map has never generated and one whose generation is refused every
night look the same in the skills registry — no `repo-map` row — so the page cannot tell them apart
from the skills list. The status read answers it from where it is written, that audit trail:

```
GET /api/v1/knowledge/repo-map      (any member; reads only — no host request)
  ─▶ { items: [{ repo, state, skill, version, lastReport }] }   one per enabled repository, by name
```

| `state` | |
| --- | --- |
| `generated` | a map skill has a version in force; a `skipped` `lastReport` says the last refresh did not happen |
| `pending` | no map, and no generation on the record — the nightly job has not come round to it |
| `failed` | no map, and the newest recorded generation was `skipped` — `lastReport.reason` says why |

`repo-map.status.ts` decides it, pure; `lastReport` is the generation's own report rebuilt from the
audit row (`generatedAt` is when it ran).

## Environment recipes

Mockup 14's Repo Profile card has one block that is **new truth** rather than a composition of
detection (#384) and protected paths (#380): the **Environment** block — the ordered setup commands
that bring the repository's environment up (BE.4's `env_recipes`, V073, decision **K7**). BG.4
([#420](https://github.com/NobuData/ouroboros/issues/420)) gives it a read and a save
(`src/modules/env-recipes/`):

```
GET  /api/v1/knowledge/env-recipe?repo=owner/name   the version in force (any member); 404 = none yet
PUT  /api/v1/knowledge/env-recipe {repo, commands}   the block, saved as the NEXT version (admin+) → 201
```

| Rule | |
| --- | --- |
| Versions | an edit is `max(version) + 1`, source `edited`, in the signed-in person's name; V073's trigger holds the number and a written row never changes — the recipe that was in force when a build broke stays readable |
| A race | two editors compute the same next number; the unique key lets one commit and the other gets `409 env_recipe_version_conflict` naming the version taken — re-read, edit again. Nothing here updates a row |
| The shape | 1–64 entries of `{command, comment?}`, each a non-blank single line (2 000 / 300 characters) — refused by the DTO before the database's `env_recipe_commands_typed` sees it; the check's own refusal still answers `422 env_recipe_commands_invalid` rather than a crash |
| Consumers | V073's contract, not this module's: farm container-pool setup, the prebuild tier (BD.4, #399) and execution workspace prep (AR.1) read `env_recipes_current` and run the commands in array order, stopping at the first non-zero exit; a `comment` is never executed |
| Not here | snapshot state, boot times, prebuild schedules — BD.4's, so the card says *prebuilds arrive with the build-farm tier* until #426 wires a measurement, and no `38s` is invented |
| Recorded | every save is audited as `knowledge.env_recipe_saved` (subject `repository`) with the version written and the one it followed |

## Pluggable ticket sources

**Ingestion is a plug-in decision** (roadmap decision **P5**), and
[`src/modules/ticket-sources/`](src/modules/ticket-sources) is the seam
([#139](https://github.com/NobuData/ouroboros/issues/139)). The core sync loop depends on
`TicketSourceProvider` and on nothing else; a provider lives under `providers/`, is registered
by one line in `ticket-sources.module.ts`, and is reached only through `TicketSourceRegistry`.
[`docs/TICKET_SOURCES.md`](../docs/TICKET_SOURCES.md) is the walkthrough for writing one.

```
scheduler ─▶ for each active source:
               registry.find(kind)      ─ nothing? skip, and leave the row alone
               open the credential      ─ sealed column → plaintext, one call long
               cursor === null          ─ fullSync(ctx)  :  incrementalSync(ctx, cursor)
               applySync(page)          ─ one transaction: rows, cursor, synced_at, status
               intake.accept(new)       ─ after the commit, never inside it
```

**`ticket-sources.service.ts` contains no `kind` at all**, and that is the point rather than a
happy accident: the issue's own framing is that pluggability *"decays the first time someone
adds `if (source.kind === 'github')` to the sync loop because it was quicker"*. Two rules in
[`.dependency-cruiser.cjs`](.dependency-cruiser.cjs) make the import that line needs a build
failure — `ticket-source-core-imports-the-spi-only` and
`no-tracker-sdk-outside-ticket-source-providers` — and `ticket-sources/boundary.spec.ts`
watches each of them fail on a tree built to break it, because a lint rule nobody has watched
fail is a lint rule that passes everything. `ticket-sources.service.spec.ts` adds the half a
cruise cannot see, reading the loop's own source for a comparison against a kind.

**The cursor is opaque and the loop never reads it.** A stored cursor means
`incrementalSync` and no stored cursor means `fullSync`; what those two ask a tracker is the
provider's business, and `ticket_sources.sync_cursor` is `text` for the reason V030 gives — a
loop that parsed GitHub's `since`, GitLab's `updated_after` and a JQL bound would be three
implementations of somebody else's format with their own opinions about time zones. Which is
why a page carries a third member: `hasMore` is how a provider asks for another cycle in a
second rather than a full interval, and it is the only way to answer that question without
interpreting the cursor.

**Four words, and the sentence each becomes.** `ticket-source.errors.ts` is the taxonomy the
issue asks for — `auth`, `rate_limit`, `not_found`, `upstream` — and it names no tracker below
its header, which its suite asserts over the file. All four coarsen to
`ticket_sources.status = 'error'`, because V030's three states have no word for *working, but
throttled* and the loop's own filter must not keep hammering a tracker that is refusing. What
separates them is V031's `status_reason`: `rate limited until 14:20 UTC`, `credentials
rejected (401)`, `project or repository not found`, `tracker unavailable (503)`. It is composed
from the **class** rather than from a provider's `detail`, which is what stops a tracker's error
body — request headers and all — from reaching a page. The `detail` still reaches the log,
where the audience is an operator.

**The credential is opened for one call.** The sealed column's value is read by exactly one
statement in `ticket-sources.repository.ts`; everything else selects `ticket_sources_public`,
which does not carry it, and the one management statement that names the table asks only
whether the column is null. `VaultService` opens it immediately before the provider call and
the reference is dropped in a `finally`. Nothing logs it, and the suite asserts that against a
captured transcript with a credential-shaped fixture rather than by reading the code.

**Three outcomes, and only two touch the row.** A source whose kind has no provider in this
build is *skipped* — reported, logged once at `debug`, row untouched, because a missing provider
is a release that has not happened rather than something a workspace configured. A source whose
provider threw is *failed*: `status` and `status_reason` are written and `synced_at` is not.
A source that synced has its rows, its cursor, its stamp and its status written in one
transaction, which is also what clears a previous failure.

**The listing carries two figures nothing else can compute** (AM.3,
[#285](https://github.com/NobuData/ouroboros/issues/285); both additive, 0.35.15):

- `TicketSource.openTicketCount` — how many **canonical `tickets`** of that source are `open`,
  counted per read in one grouped aggregate (`SourcesRepository.openTicketCounts`) rather than
  stored. A column would have to be written by every path that closes a ticket, and the first one
  that forgot would leave the planning page asserting a figure nothing could reproduce. `V030`'s
  `tickets_organization_source_state_idx` is `(organization_id, source_id, state)`, which is this
  grouping's exact prefix. **Not** the `github_issues` mirror mockup 03 counts — the two backlogs
  are different tables on purpose.
- `TicketSourcePage.pollIntervalSeconds` — `OURO_BACKLOG_SYNC_INTERVAL_SECONDS`, so a client can
  render the sync cadence instead of hard-coding one. It sits on the page envelope because one
  knob drives every source, and it is a **cadence, not a countdown**: each scheduler jitters its
  own sleep by ±25%, and a `paused` or `error` source is not polled at all.

### The GitHub provider

**`github` is the first registered kind** ([#140](https://github.com/NobuData/ouroboros/issues/140)),
and it is the proof that the SPI can carry a real integration: everything the backlog poller
does, behind four members the loop would call on a Jira provider just the same.

| member | what it does |
|---|---|
| `validateConfig` | one `GET /repos/{owner}/{repo}` per enabled repository — Q.4's **Test connection** as a real round-trip, answering `acme-robotics · 4 repositories`. It never rejects: a bad config, a refusal and a closed socket are all results, because a form's error state must not depend on somebody remembering a `try` |
| `fullSync` | `state=open`, no watermark. A backlog is what is *open*; a cold import that dragged in a decade of closed issues is a first sync nobody wants |
| `incrementalSync` | `state=all&since=<cursor>`. `all` rather than `open` is the whole of how a close reaches the mirror — an issue that stops being listed would sit there open forever |
| `mapTicket` | `#485` → `{ externalId: "485", externalKey: "#485", … }`, with the repository read out of the issue's own `html_url` so a recorded payload produces the whole row, `meta` included |

**Pull requests are dropped before a row exists.** The issues endpoint answers both, the only
discriminator is the presence of a `pull_request` key, and a PR in the backlog is a bug users
see immediately.

**Configuration is `{ login, repos[] }`** — the shape `R__dev_seed_sources.sql` already writes,
and the enabled-repo scoping the intake epic asks for. It is parsed by the provider and by
nothing else: `ticket_sources.config` is `unknown` in the core, deliberately, because a type
spelled there would be GitHub's grammar under a neutral name.

**One page, divided.** A sync answers at most 500 tickets, and the budget is *divided* across
the enabled repositories rather than spent first-come — so every repository is asked on every
cycle, which is what lets the cursor be the **weakest frontier** across them. A repository cut
short means the watermark stops at its last ticket rather than at the newest on the page;
advancing past it would leave tickets nobody has fetched behind a `since` that no longer finds
them.

**No `@octokit/*` import is added.** The provider takes `OCTOKIT_FACTORY`, the injectable seam
K.3 cut ([#101](https://github.com/NobuData/ouroboros/issues/101)), so
`src/modules/github/github.octokit.ts` is still the only file in the service that may name the
library — and `no-octokit-outside-the-seam` refuses it inside `providers/` too, which
`ticket-sources/boundary.spec.ts` asserts by adding the violation.

**Its rate guard is its own.** `GithubModule`'s single `GithubRateLimiter` watches the
workspace's *settings* token, which the backlog poller spends and which
`/api/v1/backlog/sync-status` reads to explain a pause. A source's credential is a different
token, so the provider gets a second instance: sharing them would let one source's exhausted
budget make the backlog page say `rate_limited` about a token that is fine. Exhaustion throws
`rate_limit` with a resume time, which V031's column renders as `rate limited until 14:20 UTC`.

**It runs beside `backlog-sync/` rather than in place of it.** That loop is GitHub-shaped and
fills `github_issues`; this one is source-agnostic and fills `tickets`. Retiring the first is
the **cut-over**, and it is not this release: re-pointing `issue_estimates` at `tickets.id` is a
migration in `ouroboros-db`, and until it happens the intake screens still read
`github_issues`.

The estimation handoff is a port, `TICKET_INTAKE`, bound to a placeholder that logs, for the
same reason. The pipeline is real but keyed on `github_issues.id`, so handing it a `tickets.id`
would be a log full of misses. `ticket.intake.ts` carries the argument.

The cadence is `OURO_BACKLOG_SYNC_INTERVAL_SECONDS`, shared with the backlog sync on purpose:
one knob for one question — *how often does Ouroboros ask a tracker what changed* — for the one
release in which there are two loops asking it.

### Managing sources

**`/api/v1/sources` is the settings surface's API** (Q.4,
[#141](https://github.com/NobuData/ouroboros/issues/141)), and it sits *beside* the loop the
way `backlog/` sits beside `backlog-sync/`: `sources.controller.ts`, `sources.service.ts` and
`sources.repository.ts` are a person's statements, every one scoped by the workspace first,
while `ticket-sources.repository.ts` stays a timer's. Members read; `owner` and `admin` write.

```
GET   /api/v1/sources                     the page — kind, settings, status, reason, mask, syncedAt
GET   /api/v1/sources/catalog             every registered kind: its form fields and capabilities
GET   /api/v1/sources/{id}
GET   /api/v1/sources/{id}/status         the row + the loop's memory: running, retryAfterSeconds, lastSync

POST  /api/v1/sources                     201  settings checked against the kind's schema; the secret to the vault
PATCH /api/v1/sources/{id}                     rename · new settings · status: active | paused
POST  /api/v1/sources/{id}/credentials    200  write-only — the answer is the resource, with the mask
POST  /api/v1/sources/{id}/test           200  validateConfig over the stored row; writes nothing
POST  /api/v1/sources/{id}/sync           202  the status at acceptance, running: true
  ─▶ 409  ticket_source_paused · ticket_source_sync_running · ticket_source_sync_too_soon (details.retryAfterSeconds)
  ─▶ 501  ticket_source_kind_unsupported   a row whose kind has no provider in this build
```

**The form is the provider's.** `GET /sources/catalog` renders each provider's `configSchema()`
into an ordered field list through `ticket-source.config.ts` — `provider.config.ts`'s dialect
for model providers, plus a `list` of strings for the repositories or projects a tracker source
is scoped to — and `sources.catalog.spec.ts` holds the catalog, the service and the controller
to zero `kind` literals. A `POST` or `PATCH` is checked against the same schema before anything
is written; a violation is `422 ticket_source_config_invalid` with a sentence per field under
`details.fields`, the envelope the provider forms already use, and the provider is not asked.

**A credential goes in and never comes out.** The field marked `x-ouroboros-secret` travels in
the `POST /sources` body beside the settings and is split off for the vault before the row is
written. Every read answers `credentialMask` — `••••` while one is stored — and the response to
storing one echoes the mask with the last four characters, computed from the plaintext at that
moment and nowhere later: the management repository's one statement against the table selects
`credentials_encrypted is not null` and nothing else. `sources.integration-spec.ts` searches
every response body for the token it stored, and `sources.service.spec.ts` the log transcript.

**A test writes nothing.** `provider-connections` writes a test's result to the connection's
status because that status *is* the routing signal; here `status` and V031's reason are the
loop's — written by a sync, cleared by the next one that succeeds — and a probe pressed while
the tracker was down must not stop the loop polling. `POST …/test` opens the stored credential
through the loop's own `sealedCredential`, hands it to `validateConfig`, and answers what came
back. A credential the vault cannot open is a *failed* result of class `auth`, not a `500`.

**A manual sync is the loop's cycle for one row.** `TicketSourcesService.syncSource` marks the
source in flight — a scheduled cycle that arrives meanwhile leaves it alone and says so in its
report as `in_flight` — and the `202` carries the status at acceptance. The three refusals are
the backlog button's, with the same 30-second `backlog/debounce.ts` behind the third.

**A change is a reason to try again.** New settings, a new credential and an explicit
`status: "active"` each move an `error` row back to `active` with its reason cleared, because
each is somebody acting on exactly the thing that failed. A `paused` row stays paused through a
settings edit; pausing was a choice too.

### The conformance kit

**`describeTicketSourceConformance` is what *pluggable* means here** (Q.5,
[#142](https://github.com/NobuData/ouroboros/issues/142)): one reusable suite every provider takes,
in `ticket-sources/conformance.fixture.ts`, given a provider and its recordings and nothing else.
It runs in `yarn test`, so `ci/rest` runs it on every change — against `GithubTicketSourceProvider`
over recorded payloads, and against both in-memory providers.

```
describeTicketSourceConformance(provider, recordings)
  ├─ config validation        accepted and rejected shapes
  ├─ full + incremental sync  cursor never regresses · re-sync writes nothing
  ├─ canonical mapping        every field populated or explicitly null
  ├─ error taxonomy           auth · rate_limit · not_found · upstream
  └─ webhook shape            when capabilities() declares it
```

**It has been watched failing.** Each rule is a function returning sentences, so
`conformance.fixture.spec.ts` runs every one against a provider broken on purpose — a key collapsed
onto the identity, a field dropped instead of nulled, a cursor that goes backwards, a `hasMore` that
never settles, a webhook that accepts forgeries. The same file reads `ticket-sources.module.ts` and
fails when a registered provider has no `providers/<name>.conformance.spec.ts`, so T.2–T.4 cannot
ship a provider that skipped it.

**Writes are counted with the loop's own predicate.** Pages replay into an in-memory mirror that
stores rows as `applySync` does and asks `ticket-sources.repository.ts`'s `differs` whether to write,
so *re-running an unchanged cursor writes nothing* is a number — and a cursor that moved backwards
shows up as a ticket older than the mirror's copy, without the kit ever reading a cursor.

**The core intake harness runs on the fake.** `providers/in-memory.provider.fixture.ts` is a tracker
— records, a clock, a token kept only as a digest, an access log — and a provider over it with a
four-word workflow, a `<updated>~<id>` cursor and signed webhooks. `ticket-sources.integration-spec.ts`
runs the loop against a migrated database on it alone, and GitHub end to end moved beside its
provider as `providers/github.provider.integration-spec.ts`. `ticket-source-core-tests-run-on-the-fake`
in `.dependency-cruiser.cjs` makes an Octokit, GitHub-fixture or GitHub-provider import from a core
suite, the kit or their fixtures a lint failure, and `ticket-sources/boundary.spec.ts` watches it
fail.

### Pushing a planning batch

**`PushService` (`src/modules/planning/`) turns a batch's drafts into real tickets** (AL.3,
[#279](https://github.com/NobuData/ouroboros/issues/279)) through the write SPI alone — it reaches
GitHub, or any writer, via `TicketSourceRegistry` and `supportsWrites`, never by import.

```
push(org, batch) / resume(org, batch)
  ├─ batch + target source, inside the asking workspace — else 404
  ├─ blockers-first order (push.order.ts) — a cycle is a 422 naming it
  ├─ ensureMilestone · ensureEpicContainer (epic_mirrors first)
  └─ each pending|failed draft: createTicket(<batch>:<draft>) → linkDependency → attachToEpic
       └─ recordPushed: ticket · draft pushed · dependency ends rewritten · epic_tickets — one transaction
```

A kill between the tracker's answer and that commit is recovered by the provider's idempotency
probe; a `rate_limit` stops the walk with the rest `pending` and a `retryAt`; any other refusal is a
structured `ticket_drafts.push_error`. The report's `links: { native, fallback }` tells the UI which
dependency mode ran. AL.4 (#280) mounts `push` and `resume` — see below.

- `push.service.spec.ts` — the acceptance criteria over the real GitHub provider, a recorded GitHub
  (`providers/github.write-recordings.fixture.ts`) and an in-memory store that keeps V034–V036's
  rules: six drafts → six issues, five native links, one parent epic, one milestone; kill-and-resume
  without duplicates; the throttle; the fallback; isolation.
- `push.integration-spec.ts` — the same push against PostgreSQL, including a sync adopting the
  pushed tickets rather than importing them twice.
- `providers/github.write-conformance.spec.ts` — the write kit, green for GitHub with and without
  the dependency API.

### The planning API

**`/api/v1/planning` is mockup 09's generator card and roadmap over HTTP** (AL.4,
[#280](https://github.com/NobuData/ouroboros/issues/280)). It composes rather than duplicates: the
planner is the engine's `/v0/plan` (AL.1), sizing is `EstimationOrchestrator.enqueueDraft` — the one
sizer (N3) — the push is `PushService`, and **Queue XS/S** is M.3's `BacklogQueueService` (N7).

| Route | Who |
|---|---|
| `POST /planning/batches` · `POST /:batch/regenerate` · `PATCH /:batch/drafts/:key` | owner, admin, member |
| `GET /planning/batches/:batch` · `GET /:batch/push-status` · `GET /planning/roadmap` · `GET /planning/health` · `GET /planning/epics[/:epic]` · `GET /planning/epics/:epic/tickets` · `GET /planning/tickets` · `GET /planning/sources/:source/milestones` | every member |
| `POST /:batch/push` · `POST /:batch/push/resume` · every epic mutation | **owner, admin** |

- **Every edge write is walked first** (`planning.graph.ts`, AL.3's push order): a cycle is a `422`
  that names it.
- **Regeneration** replaces unpushed drafts, keeps selections by `local_key`, and never touches a
  pushed draft. A title or body edit marks the draft `provenance: edited` (V037). **A batch another
  plane composed is not regenerable** (`409 batch_not_regenerable`, #519): no planner was asked for
  the Build Analyzer's `analyzer-v1` drafts, so re-planning would replace them with whatever the
  engine makes of the batch's filing line. `BatchesService.compose` stores a batch only under a
  composing plane's planner family (`COMPOSING_PLANNER_FAMILIES`), which is how regeneration tells.
- **The footer** (`planning.summary.ts`) sums real `est_minutes`, and carries `spend` only when
  `ouroboros.model_price()` prices something — never `$0` for *unknown*.
- **A pushed draft names its ticket.** The batch read and `push-status` carry `pushedTicket` —
  `{ externalId, externalKey, url }`, read through `tickets` — beside `pushedTicketId`, so the card's
  `pushed ✓ #612` link survives a reload rather than living only in a push's answer (AM.2,
  [#284](https://github.com/NobuData/ouroboros/issues/284); additive, 0.35.12).
- **The epic editor reads what a lane counts** (AM.4,
  [#286](https://github.com/NobuData/ouroboros/issues/286); additive, 0.35.13).
  `GET /planning/epics/:epic/tickets` answers the lane's linked tickets — key, title, synced state,
  url; open first — and AL.3's `epic_mirrors` with each source's name, so the list and the chip are
  read from the same links. `GET /planning/tickets?q=` is the link picker: the workspace's canonical
  tickets whose title or key contains `q` (escaped, so `%` and `_` match themselves), most recently
  updated first, at most 20. Linking and unlinking stay `owner|admin`.
- `batches.service.spec.ts`, `epics.service.spec.ts` and `queue-small.spec.ts` run over an
  in-memory store keeping V034–V037's rules (`planning.store.fixture.ts`);
  `planning.integration-spec.ts` runs generate → size → select → push → queue-small over HTTP against
  PostgreSQL, the engine stub and a recorded GitHub.

### Backlog health and nightly re-estimation

**`GET /api/v1/planning/health` is mockup 09's Backlog Health card, computed** (AL.5,
[#281](https://github.com/NobuData/ouroboros/issues/281), decision N9). One statement
(`health.repository.ts`) counts the workspace's **open canonical tickets** on every read, so a
synced state change moves the card on the next request:

| Meter | Counts | Drill-through `filter` |
|---|---|---|
| **Sized** `38/42` | `sizing_status = 'sized'`, out of every open ticket | `{ state: open, sizing: unsized }` |
| **Blocked** `4` | an unresolved blocker — an open ticket, or a draft in a batch not abandoned — over `planned` **and** `synced` edges, each ticket once | `{ state: open, blocked: true }` |
| **Stale** `6` | `source_updated_at` older than `OURO_BACKLOG_STALE_DAYS` (30) | `{ state: open, staleDays: 30 }` |

An empty workspace answers zeros. `reestimation` carries the job's schedule and its latest run, with
**this workspace's** `found · queued · inFlight` — the footnote's tooltip.

**The footnote is a real job.** `ReestimationScheduler` books `OURO_REESTIMATION_HOUR_UTC` (02:00),
jittered across `OURO_REESTIMATION_JITTER_MINUTES` after it, on every replica:

```
tick(night)
  ├─ startRun(night)   insert … on conflict (night) do nothing — a second replica stands down (V039)
  ├─ unsizedTickets(OURO_REESTIMATION_BATCH)   open + unsized, ranked per workspace, bounded
  ├─ EstimationOrchestrator.enqueueTicket(each) — INTAKE-L.3's one sizer (#107)
  └─ finishRun(succeeded | failed, per-workspace counts)  → book tomorrow
```

The orchestrator sizes a canonical ticket exactly as it sizes an issue — claim, engine with one
retry, floor, versioned write — storing the estimate under `issue_estimates.ticket_id` (V038), and
its recovery sweep re-queues tickets stranded in `estimating`. `planning.module.spec.ts` asserts the
job holds the exported orchestrator and no estimator of its own; `reestimation.job.spec.ts` that a
5,000-ticket backlog dispatches exactly the bound; `planning.integration-spec.ts` reproduces
`38/42 · 4 · 6`, recomputes after a synced close, sizes a seeded backlog through the engine stub
within its bound, and holds every count to the asking workspace.

**The planning guarantees are pinned across the service boundary**
([#282](https://github.com/NobuData/ouroboros/issues/282)).
`push.guarantees.integration-spec.ts` pushes over HTTP against a recorded GitHub that can refuse one
call or lack the dependency API: blockers are created first, the fallback mode is reported, a partial
failure's resume creates exactly the missing issues, an issue GitHub already holds is found rather
than filed twice, an epic keeps one parent issue, queue-small goes through INTAKE-M.3 with only sized
issues, and Blocked counts `synced` edges. `planning.access.integration-spec.ts` reads every planning
route off the controllers (`planning.routes.fixture.ts`) and fails when one has no case — the role
matrix on every mutating route, isolation on every route.

## The build farm's identity layer

> **Issue:** [#250](https://github.com/NobuData/ouroboros/issues/250) — *[AH.2] Enrollment API
> & runner CA* · epic [#240](https://github.com/NobuData/ouroboros/issues/240) · roadmap
> decision **B3** · schema `V040`/`V041` ·
> [`docs/SECURITY_MODEL.md` § 7](../docs/SECURITY_MODEL.md#7-the-build-farms-certificate-authority)

A build runner is a process on hardware this control plane does not administer. `src/modules/farm/`
is how one comes to have an identity it can prove, and how that identity is taken away again.

```
owner/admin  POST /farm/enrollment-tokens ──▶ orb_enroll_…  (returned ONCE; masked forever)
                                                   │  scoped to one pool · TTL · max_uses
agent        POST /farm/registrations  ────────────┘  token validated, spent, runner created
             { token, name, arch, CSR }        ──▶ certificate signed: CN = runner id, O = workspace
agent        POST /farm/registrations/renewal  ──▶ authenticated by the CERTIFICATE, not a token
owner/admin  DELETE /farm/runners/{id}/certificate ──▶ refused at the next handshake
any member   GET  /farm/authority              ──▶ the CA to pin — the public half, only
```

**The runner generates its own keypair.** The issue left that open and it is decided in
`x509/csr.ts`: the agent sends a PKCS#10 request and the private half never travels, so **no
runner private key has ever existed inside Ouroboros** — there is no backup, log or column
from which one could be recovered. The cost is that an unauthenticated endpoint reads a
structure a caller composed; `x509/reader.ts` is a bounds-checked, DER-strict, depth-limited
*structural walk* that decodes no values, and everything that is real parsing is delegated to
`crypto.createPublicKey` and `crypto.verify`.

**The CSR's own subject is discarded.** The certificate's subject is composed from the runner
row this service creates and the workspace the token was scoped to. A request claiming to be
another workspace's runner is signed with its *correct* name rather than refused, because the
claim was never read.

### The CA key, and the four things that keep it in

`farm.authority.ts` is the one file allowed to hold an unwrapped CA key. It unwraps through
`VaultModule` for **one signature** and zeroizes the plaintext in a `finally` — `VaultService`'s
own no-cache posture, one layer up, for the stronger of its reasons: a CA key living in a
process after its workspace was deleted is a window in which the crypto-shred has not happened.

| What holds it | Where |
|---|---|
| A row with a plaintext CA key cannot exist | `farm_authorities_key_sealed` (`V041`) — binds every writer, including a hand-run migration |
| Only one file may name key material | `ouroboros/no-ca-key-escape` in `eslint.config.mjs`; the rule is `src/modules/farm/no-ca-key-escape.mjs` |
| That file has no logger, no cache and no getter | `farm.secrecy.spec.ts` reads its source |
| No response carries one | the same suite greps a full lifecycle; `farm.integration-spec.ts` does it over a socket |

### Refusals say one thing

Six ways a token can fail — unknown, wrong secret, expired, spent, revoked, wrong pool — answer
one `401 farm_enrollment_refused` with no details. Which of the six it was goes to the AD.4
trail, where an operator can read it and a caller cannot. The same posture covers a presented
certificate: unknown, expired, superseded and revoked are one refusal, because the difference
tells somebody holding a stolen certificate whether the theft has been noticed.

The exceptions are the refusals that describe the *caller's own input* and reveal nothing about
the workspace: `422 farm_invalid_csr`, `403 farm_bearer_fallback_not_permitted`, and
`409 runner_name_taken` — each argued in `farm.errors.ts`.

### Revocation is the boundary

A certificate lasts ninety days and the response says when to renew; that window is a backstop.
**Revocation is the control**, checked at every handshake by `RunnerIdentityService` — which is
exported for AH.3's gateway ([#251](https://github.com/NobuData/ouroboros/issues/251)) so there
is one implementation of *is this certificate live?* rather than two.

Renewal is authenticated by the certificate being replaced, and the request has no token field,
so a revoked runner cannot renew its way back in. A renewal supersedes and issues in one
transaction; `runner_certificates_live_idx` makes two live certificates for one runner a row
PostgreSQL refuses.

### The deployment requirement that fails quietly

A reverse proxy terminating TLS has already consumed the client certificate. Unless it forwards
one, **the handshake still succeeds and the identity check has nothing to check** —
`OURO_FARM_CLIENT_CERT_HEADER` names the header it forwards in, and it is **unset by default**
because a certificate is public and a header trusted unconditionally is an impersonation of any
runner whose certificate anybody has seen.
[`docs/SECURITY_MODEL.md` § 7.6](../docs/SECURITY_MODEL.md#76-the-deployment-requirement-that-silently-breaks-mtls)
carries the nginx and Traefik directives, and the two rules that go with them.

### The bearer fallback is gated and visible

`workspace_settings.runner_bearer_fallback` defaults to **false**. A runner that takes the
fallback is recorded as `security_mode = 'bearer_fallback'` and rendered as a visibly degraded
connection by AI.2 ([#257](https://github.com/NobuData/ouroboros/issues/257)) — a security
downgrade nobody can see is the worst of both designs.

## The agent gateway

> **Issue:** [#251](https://github.com/NobuData/ouroboros/issues/251) — *[AH.3] Agent WebSocket
> gateway* · epic [#240](https://github.com/NobuData/ouroboros/issues/240) · decisions **B2**/**B3**/**B7** ·
> schema `V042` · [`docs/RUNNER_PROTOCOL.md`](../docs/RUNNER_PROTOCOL.md)

`wss://<control plane>/api/v1/farm/agent` — the server half of the runner protocol, and the
farm's nervous system. Every `ouroboros-runner` holds one outbound connection here, and
everything the farm page shows about a machine — the pill, `last seen`, the CPU meter, the
queue chip — arrives over it. `src/modules/farm/gateway/` is the gateway; `src/modules/farm/protocol/`
is the codec, held to `schemas/runner-protocol/fixtures/` together with the Go agent's.

```
agent ──upgrade + client cert──▶ transport.ts: RunnerIdentityService (revocation) or the fallback
          │ refused ─▶ 401 farm_identity_refused · 401 farm_client_certificate_required
          ▼
hello ──▶ version floors · security mode vs transport ─▶ refuse, or
          runners: hostname · arch · agent_version · capabilities · online ─▶ ack {session, limits,
          pool: {max_concurrency, env_allowlist}}   ← the pool's row, read at every hello (#246)
heartbeat ──▶ telemetry snapshot · uptime · pill · last_seen_at ← THIS beat · drain reconciled
job.finish ──▶ ledger + job in ONE transaction ─▶ receipt {duplicate}   (record, then answer)
bye ──▶ offline now          silence ──▶ presence sweep: offline after 32 s, last_seen_at kept
```

It is a Nest provider holding a `ws` server on the HTTP server's `upgrade` event rather than a
`@WebSocketGateway`: it has to refuse **before** upgrading, in this service's error envelope,
with the codes the agent already branches on; it has to handle the protocol's
`{v, type, id, payload}` frames one at a time and in order; and it should not need a
process-global adapter. `agent.gateway.ts` argues each.

### Exactly once, for the frame that matters

A `job.finish` is recorded in `runner_terminal_frames` (`V042`) by its envelope id — the
idempotency key the agent repeats verbatim on every re-send — in the same transaction that
applies it to its `build_jobs` row, and the `receipt` is written only after that commits. A
re-send finds the row and is answered `duplicate: true` without touching the job; two copies
racing each other lose to the table's primary key rather than to a check. The ledger knows no
sessions, so a reconnect that could not resume is deduplicated exactly as well as one that
could. A frame naming a job that is not this runner's is recorded, receipted and applied to
nothing — which is also the organization-isolation guarantee for terminal frames.

### Presence is honest in both directions

A runner that stops heartbeating is `offline` after **three missed intervals plus the jitter —
32 seconds** — applied by a sweep every 5 seconds, so the farm table is at most 37 seconds
behind a machine that died (`gateway.policy.ts`). The sweep **never writes `last_seen_at`**: it
stays at the last heartbeat that genuinely arrived. A runner that comes back is `online` the
moment it says hello, and an agent's `bye` makes it `offline` at once, deliberately.

### Telemetry is honest too

A heartbeat's `cpu_pct`, `memory_used_mb` and `memory_total_mb` are `null` when the agent's
machine cannot measure them ([#245](https://github.com/NobuData/ouroboros/issues/245)) — a
container that cannot see the host's CPU, the first beat before a CPU window has closed.
`telemetry.ts` then **leaves that key out** of `runners.telemetry`, which `farm_telemetry_valid`
accepts and V040 documents as the em-dash the runners table draws; it never writes a `0` in its
place. `queue_depth` is the agent's count of jobs **accepted and not yet started** — the running
job is not in it — which is the definition dispatch
([#252](https://github.com/NobuData/ouroboros/issues/252)) shares.

### Sessions, resume and ordered delivery

`AgentSessions` is connection ↔ runner. Every frame the gateway owes a session — a receipt until
it has been written, an offer until it is answered or expires, a drain — goes through its
outbox in order, and a session that loses its socket waits out a five-minute resume window; a
`hello.resume` naming it gets the ack with `resumed: true` and then everything still owed, in
the order it was first sent. Sessions live in this process: a reconnect to another replica gets
`resumed: false`, which the protocol is written to survive.

### What other tickets call

| Export | For | What it does |
|---|---|---|
| `AgentSessions.offer` · `.listen` · `.onTerminal` · `.isConnected` · `.cancel` · `.withdraw` | dispatch, AH.4 ([#252](https://github.com/NobuData/ouroboros/issues/252)) — [Build dispatch](#build-dispatch); log ingest, AH.5 ([#253](https://github.com/NobuData/ouroboros/issues/253)) | offer a job to a runner, or tell it to stop one (each payload is held to the contract before it is sent); withdraw an unanswered offer; hear `job.accept`/`job.decline`/`log.chunk` — a `job.finish` listener is also told what the ledger made of the frame; `onTerminal` sees a `job.finish` *before* it is recorded (build logs' tail, #253) |
| `RunnerControl.drain` · `.undrain` | lifecycle actions, AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)) | write `desired_state`, then push the frame; a runner connected elsewhere is told at its next heartbeat |
| `supportsExecutor` (`capabilities.ts`) | dispatch eligibility, AH.4 | whether a runner's stored capabilities say it can run a job under an executor |
| `GatewayMetrics.snapshot` | health history, AJ.4 ([#266](https://github.com/NobuData/ouroboros/issues/266)) | connections, refusals by reason, frames by type, terminal records and duplicates, presence flips |

### The version floor

The agent runs on customer machines and cannot be force-upgraded, so the gateway refuses an old
one from the first release. `OURO_FARM_MIN_AGENT_VERSION` is the build floor — a `hello` below it
is answered `refuse {version.below_minimum}` with a sentence naming it, and the agent exits
rather than reconnecting into the refusal. The protocol-*line* floor is the build's own, and a
`hello` written in a line this gateway does not speak is still read far enough to refuse it with
the minimum named, or to be answered in a line both ends do.

## Build dispatch

> **Issue:** [#252](https://github.com/NobuData/ouroboros/issues/252) — *[AH.4] Build job dispatch
> & queueing* · epic [#240](https://github.com/NobuData/ouroboros/issues/240) · decision **B6** ·
> schema `V043` · [`docs/RUNNER_PROTOCOL.md` § 4.3](../docs/RUNNER_PROTOCOL.md#jobcancel)

Which runner is offered which job, what happens to the answer, and what happens when a runner is
never heard from again. `src/modules/farm/dispatch/` is the module; it imports the gateway, hears
the agents' answers through `AgentSessions.listen`, and the gateway never imports it back.

```
POST /api/v1/farm/jobs ──▶ queued ──▶ kick ──▶ for the oldest waiting job:
   eligible runner? same workspace · the job's pool (or a pool window now) · desired_state active
                    · live · executor in its hello · under its pool's max_concurrency · socket HERE
   ──▶ place (runner row locked, cap re-counted) ──▶ job.offer ──accept──▶ q:N ──start──▶ running
                                                  └─decline / no answer──▶ back to the queue
job.finish: succeeded · failed (exit ≠ 0, timed_out) · canceled · errored ──▶ retried once, then failed
runner offline past the resume window: offered/accepted ──▶ queue · running ──▶ retried once, then failed
POST /api/v1/farm/jobs/:id/cancel ──▶ canceled now ──▶ job.cancel to the runner holding it
```

| Route | Role | What it does |
|---|---|---|
| `POST /api/v1/farm/jobs` | `member`+ | Queue a build: `pool`, `repository` (`owner/name`), `ref`, the exact `commit`, and `command` as **argv** — or the pool's `default_command` (`V043`). The pool's executor, image and the command are snapshotted onto the job. `201`, already `offered` if a runner was free. **Audited** as `runner.job_submitted` since [#260](https://github.com/NobuData/ouroboros/issues/260) |
| `POST /api/v1/farm/jobs/:id/cancel` | `member`+ | `canceled` at once; a runner holding it is sent `job.cancel` and its later `cancelled` finish changes nothing. A finished job is `409 farm_job_not_cancellable` |

**A submission is audited, and the command is not** ([#260](https://github.com/NobuData/ouroboros/issues/260)).
A build runs somebody's command on hardware the workspace owns, and the job row says what ran
without saying who asked — so `enqueue` writes `runner.job_submitted` (subject `build_job`) after
the row lands and **before dispatch is kicked**, awaited: a submission that cannot be recorded
fails, and nothing is offered to a runner on the strength of it. The event carries the job's
number, the pool, the repository, the ref and the **exact commit** — and has no parameter a
command could arrive in, because a token pasted onto a command line is the likeliest secret a
submission carries. The actor is the session's user; for `submitForRun` it is `null` and the event
names the run instead. A refusal threw before anything was written and records nothing. The name is
in the `runner` family with one dot because V022's `audit_events_action_grammar` refuses a second
and `action like 'runner.%'` should stay the one question that answers *what has happened to our
build farm*.

**The state machine** (`job.states.ts`) keeps V040's seven statuses and splits `queued` by
whether a runner holds it: *waiting* (no runner) and *accepted* (a runner has taken it and not
started it). A runner's **queue depth is its accepted jobs** — the agent's own definition of
`heartbeat.queue_depth`, so the server's `q:N` and the agent's never disagree — and its
**in-flight count** (offered + accepted + running) is what is compared with the pool's
`max_concurrency`. Every writer reads a row's phase under a lock and holds the move to the
transition table; an illegal move throws `InvalidJobTransitionError` instead of writing a row the
stat row would then miscount.

**Retry is for the farm's failures, not the build's.** An `errored` finish — the agent could not
run the job at all — and a runner lost while the job was running are infrastructure-classed:
the attempt becomes `retried` and a **new job** replaces it (`retry_of`, a new number, the same
snapshot), offered with `attempt: 2`. A second infrastructure failure is `failed` for good
(`AUTOMATIC_RETRIES = 1`). A non-zero exit, and a build that ran out of time, are `failed` and
never retried — a broken build must not read as retried. The retry of an `errored` finish is
created inside the gateway's terminal-ledger transaction (`job.lifecycle.ts`), so a receipted
retry always has its successor.

**A lost runner** is one `offline` (or removed) for longer than the five-minute resume window —
a runner that drops and resumes inside it carries on with its job. Its offered and accepted
jobs go back to the queue (nothing ran), its running job through the retry policy. An offer
nobody answers is taken back after `offer_ack_ms` plus a grace. A runner that declines a job is
passed over for it for 30 seconds, so the job goes to another runner rather than bouncing.

**Stale work is cancelled.** A runner that accepts, starts or reports (in a heartbeat) a job
that is no longer its own — cancelled, or re-dispatched after it was presumed lost — is sent
`job.cancel`, once per session.

**Concurrency.** Kicks coalesce into one drain at a time in a process; across replicas,
`DispatchRepository.place` decides capacity under the runner's row lock and takes the job with
`skip locked`, and job numbers are allocated under a per-workspace advisory lock. A replica
only offers to runners whose socket it holds.

**What other tickets call:**

| Export | For | What it does |
|---|---|---|
| `FarmJobsService.submitForRun` | AJ.3 ([#265](https://github.com/NobuData/ouroboros/issues/265)) — **defined, documented, not wired** | the internal submission surface for a workflow's build stage: the route's request plus the loop run, written to `build_jobs.run_id` (decision **B6**) |
| `FarmJobsService.queueDepth` | AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)) | a runner's accepted-not-started count — the runners table's `q:N` |
| `JobCompletions.subscribe` | BV.1 ([#510](https://github.com/NobuData/ouroboros/issues/510)) | every move into a terminal status, announced after it commits and off its path; a subscriber that fails never affects the job |
| `FARM_DISPATCH_GATE` | BR.5 ([#489](https://github.com/NobuData/ouroboros/issues/489)) | asked once per workspace per pass before anything is offered; bound to `LifecycleDispatchGate`, which admits only an `active` workspace ([workspace lifecycle](#workspace-lifecycle)) |

**Known limits.** Today's agent declines any offer that names a repository (source checkout is
not built yet), so a real runner answers every submitted build `unsupported_executor` and it
waits in the queue — dispatch is complete up to that point, and the fake-agent suite
(`dispatch.integration-spec.ts`) runs the whole path. An agent that restarts and silently
forgets a job while its runner never goes offline is not detected. Agents older than runner
0.6.0 end their session on a `job.cancel` or an offer's `attempt`; `OURO_FARM_MIN_AGENT_VERSION`
is the lever. In a development database the seeded fleet never connects, so a few minutes after
REST starts its seeded in-flight builds are taken back like any lost runner's.

## The workspace card

**Mockup 17's Workspace card, with the deployment's truth in place of the mockup's SaaS controls**
([#483](https://github.com/NobuData/ouroboros/issues/483), BQ.4, decision S6).
`src/modules/settings/workspace.*.ts`.

```
GET   /api/v1/settings/workspace   any member · name, domain, region, training data + affordances
PATCH /api/v1/settings/workspace   owner/admin · { name?, domain? } · audited workspace.updated
```

**The affordance follows the payload.** Every control says whether it works (`editable`,
`selectable`, `changeable`) and, when it does not, why — `reason` is `deployment`, `plan` or
`role`. Name and domain are editable for `owner`/`admin` and `reason: role` for everyone else.

| Control | Source | On a self-hosted deployment |
|---|---|---|
| Name | BetterAuth `organization.name`, written through the plugin's adapter | editable; 1–100 characters, no edge whitespace or control characters |
| Domain | the primary `tenant_domains` row | editable; a save **replaces** the primary (the old primary row is removed, others untouched); `tags` holds `sso_enforced` only when SSO is enforced — always empty until #722 |
| Region | `OURO_DATA_REGION`, else `self-hosted` | `selectable: false`, `reason: deployment`, `source: configured \| default`, `docsUrl` → `SECURITY_MODEL.md` §6.7 |
| Training data | `workspace.truth.ts` | `{enabled: false, changeable: false, reason: deployment}` — never the plan lock |

A save writes the domain first (one transaction), then the name, so `409 domain_taken`
(`details.fields.domain`) leaves the name unchanged too. Validation failures are
`422 validation_failed` keyed by field. A save that changes nothing writes and audits nothing.
The plan-locked and changeable training variants are in the schema for BT.4 (#500) and are never
produced here.

## Members, capabilities & service accounts

**Mockup 17's Members & Roles card, every column enforceable**
([#485](https://github.com/NobuData/ouroboros/issues/485), BR.1, decision S3).
`src/modules/members/`, `src/modules/service-accounts/`, `src/modules/tenancy/capabilities.ts`,
`src/modules/auth/service.*.ts`, `src/auth/session-or-service.guard.ts`; tables in V091.

```
GET    /api/v1/settings/members                       any member (people only) · the card
POST   /api/v1/settings/members/invitations           owner/admin · { email, role } → plugin createInvitation
POST   /api/v1/settings/members/invitations/{id}/resend   owner/admin · refreshes expiry; invitedAt stays
DELETE /api/v1/settings/members/invitations/{id}      owner/admin · plugin cancelInvitation
PATCH  /api/v1/settings/members/{memberId}            owner/admin · { role?, canApproveLoops? }
DELETE /api/v1/settings/members/{memberId}            owner/admin · plugin removeMember
GET    /api/v1/settings/service-accounts              owner/admin · masked tokens + scope allow-list
POST   /api/v1/settings/service-accounts              owner/admin · { name, scopes } → token shown once
POST   /api/v1/settings/service-accounts/{id}/rotate  owner/admin · old token dead at once; new shown once
POST   /api/v1/settings/service-accounts/{id}/revoke  owner/admin · token dead, account disabled
```

**Roles stay the plugin's.** `roles` are `member.role`; `displayRole` maps them (`owner → Owner`,
`admin → Maintainer`, `member`/`viewer → Viewer`) and the footer line is rendered from the same
table (`members.roles.ts`). Every write calls the plugin's API **with the caller's cookies**
(`members.auth.ts`), so its permission checks still decide; plugin refusals come back as
`member_directory_refused` with its code in `details.reason`. No invitation email is sent until
#724. `footer.directorySync` is `null` until SCIM (BT.1) exists.

**`can_approve_loops`** (`tenancy/capabilities.ts`) is a global guard after `RolesGuard`, read by
`@RequiresCapability("can_approve_loops")` on `POST …/approvals`, `…/criteria/{id}/waive`,
`…/merge-plan/arm` and `…/merge-plan/merge` — `403 capability_required` when the member lacks it.
Defaults: owner and admin yes, member and viewer no. An explicit setting (`member_capabilities`)
survives role changes. The inbox's action executor (#462) checks the same capability for actions
declared `approver` — in the service, against the declaration, rather than by decorator.

**Service accounts** authenticate with `Authorization: Bearer orb_svc_…`.
`ServiceTokenMiddleware` looks the token's SHA-256 up before any guard; `SessionOrServiceGuard`
lets a principal past the session check (and answers a dead token `401 service_token_invalid`);
`TenantContextGuard` checks its scope and sets its workspace and audit actor (`service:<name>`).

| Route kind | Scope needed |
|---|---|
| `@ServiceScope(x)` (today: `POST /farm/jobs`, `…/{id}/cancel` → `farm.submit`) | `x` |
| any other `GET`/`HEAD` a viewer may read | `api.read` |
| `@HumanOnly()` (members card, workspace card, digest), owner/admin-only routes, other writes, `@TenantOptional()` | refused — `403 service_principal_refused` |

A token without the needed scope is `403 service_scope_missing` with `details.scope`. Tokens are
stored hash-only with a vault-sealed hint; see `docs/SECURITY_MODEL.md` §6.8. A new scope needs
V091's CHECK, `SERVICE_SCOPES` and a route that declares it — `service.scopes.spec.ts` keeps the
first two in step.

## Data retention

**One policy service, per-class tiers, every sweep reading it**
([#482](https://github.com/NobuData/ouroboros/issues/482), BQ.3). `src/modules/retention/`.

```
GET   /api/v1/settings/retention   any member · tiers, bounds, next sweep, last tombstone count
PATCH /api/v1/settings/retention   owner/admin · { loopDays } or { classes } · audited workspace.retention_changed
```

| Class | Default | Bounds | Swept by |
|---|---|---|---|
| `transcripts` | 30 d | 7–365 | `runs/transcript.retention.ts` — a finished run's whole transcript, via V101's `run_events_sweep()`; the run keeps `events_swept_at` |
| `build_logs` | 30 d | 7–365 | `farm/logs/log.retention.ts` — a finished job's whole log ([build logs](#build-logs)) |
| `artifacts` | `OURO_ARTIFACT_RETENTION_DAYS` (30) | 7–365 | `test-results-read/artifact.retention.ts` — bytes deleted, row tombstoned |
| `audit` | 400 d | 90–3650 | `audit-plane/audit-purge.sweeper.ts` — [the audit purge](#the-audit-log) ([#486](https://github.com/NobuData/ouroboros/issues/486)), via V102's `audit_events_purge()`; referenced events held and counted, `audit.purged` per workspace |
| `custom:<slug>` | 30 d | 7–3650 | whichever plane adds the class; stored without a schema change |

- **The defaults reproduce the old sweeps**, so a workspace with no stored tier is swept exactly as
  before, and data inside the old thirty-day boundary survives the first sweep after upgrade.
- **The cutoff is computed once, centrally**: `RetentionPolicyService.cutoffs(class, now)` answers
  `now − days` per workspace (a `case` over the workspace column via `cutoffSql`), and a sweep only
  compares a stored time with it. `retention.sweeps.spec.ts` greps the sweeps for the constants and
  date arithmetic they used to carry.
- **The simple select** (`loopDays`) sets the three loop classes and leaves `audit` alone; **the
  advanced editor** (`classes`) sets classes individually. Bounds are checked before anything is
  stored; a refusal is `422 retention_out_of_bounds` with `details.refusals[].reason`
  (`below_floor | above_ceiling | not_whole_days`) and `details.fields`. V094/V101 enforce the same
  bounds as CHECKs.
- **Saving deletes nothing.** The change moves the class's *next* sweep; each sweeper reports its
  next booked time and each run's tombstone count to `RetentionSchedule`, which the `GET` shows as
  `nextSweepAt` and `lastSweep` (this process's view).
- Every changed class writes one `workspace.retention_changed` audit event (`dataClass`,
  `previousDays`, `previousSource`, `days`, actor) — webhook registry version 4.

## The audit log

**The log every plane writes, made readable** ([#486](https://github.com/NobuData/ouroboros/issues/486),
BR.2 — the surface [#26](https://github.com/NobuData/ouroboros/issues/26) deferred).
`src/modules/audit-plane/`; the trail's writer stays `src/modules/audit/`.

```
GET /api/v1/settings/audit             owner/admin · filters · ?cursor= keyset pages · limit ≤ 200
GET /api/v1/settings/audit/today       owner/admin · ?tz= · the card's lines + retainedDays
GET /api/v1/settings/audit/export.csv  owner/admin · from & to required (≤ 366 d) · streamed · audited
```

- **Filters hit indexed columns, never rendered text.** `from`/`to`, `actorKind`
  (`human | bot | service | system`), `actorId`, `actorService`, `action` (`policy.*` or
  `policy.published`) and `ref` (`pr:509`, `run:<id>`, `repo:<ref>`, `key:<id>`, `subject:<id>`).
  Each has a V102 index that leads with the workspace and ends in the page order, and
  `audit-plane.integration-spec.ts` asserts the plans with `EXPLAIN` over a 20,000-row-per-workspace
  history.
- **Keyset, not offset.** `nextCursor` is the last row's `(occurred_at, id)` with
  `occurred_at` as PostgreSQL's microsecond text, so events that arrive mid-scroll neither duplicate
  nor skip a row.
- **Typed events, composed sentences.** `actor_kind` is stored on every row (an erased person stays
  `human`); `audit-plane.sentences.ts` composes `rotated Anthropic API key` from
  `provider.rotated {kind}`, and any action without a template reads from its name. No writer
  stores a line — `policy.published` records `changes: "auto_merge:enabled"`, not a sentence.
- **The export is audited before its first byte** — `audit.exported` with the range (its end clamped
  to the request), the filters, the row count and the actor — then streams one keyset batch at a
  time (`AUDIT_EXPORT_BATCH`, 500) with backpressure. A failure to record refuses the export. The
  CSV's columns are append-only and its cells are formula-neutralised; content equals the list's.
- **The purge** runs hourly (jittered): `RetentionPolicyService.cutoffs("audit")` per workspace,
  refused below the 90-day floor here and again in the database, batches of 1,000 (at most 20 per
  workspace a tick), and an `audit.purged` row per workspace with `cutoff`, `days`, `removed` and
  `held` — events `analysis_suggestions`/`analysis_suggestion_applications` still reference are
  kept and counted, never silently.
- **Fan-out is BR.3's.** Every row — `audit.exported` and `audit.purged` included — is published as
  `audit.<action>` in its own insert's transaction (webhook registry version 6), so *Stream to SIEM*
  is an `audit.*` endpoint.

## Workspace lifecycle

**Mockup 17's Danger zone as mechanism — pause, disconnect, delete**
([#489](https://github.com/NobuData/ouroboros/issues/489), BR.5). `src/modules/lifecycle/` owns
`ouroboros.workspace_lifecycle` (V090): `active | paused | pending_delete`, where no row means
`active`.

```
GET  /api/v1/settings/lifecycle                     any member · the app-wide banner payload
POST /api/v1/settings/lifecycle/pause               owner/admin · { confirm: true }
POST /api/v1/settings/lifecycle/resume              owner/admin
GET  /api/v1/settings/lifecycle/disconnect-preview  owner/admin · counts from live state
POST /api/v1/settings/lifecycle/disconnect          owner/admin · pause + clear token + pause sources
POST /api/v1/settings/lifecycle/delete              owner · typed name · step-up → 30 days
POST /api/v1/settings/lifecycle/restore             owner · reachable while frozen
```

**A pause is a graceful hold, not a kill switch.** Work in flight finishes its stage; every point
that would start something new declines:

| Dispatch point | Where | While not `active` | Takes effect |
|---|---|---|---|
| Queue pull | `POST /internal/runs` | `409 workspace_paused` / `workspace_pending_delete`; a replay still answers | the engine's next request |
| Stage advancement | a transition *into* `active` | the same `409`; `succeeded`, `failed` and `skipped` always land | the engine's next request |
| Build dispatch | `FARM_DISPATCH_GATE` → `LifecycleDispatchGate` | nothing new is offered; offered and running builds are untouched | the next pass, ≤ `DISPATCH_INTERVAL_MS` (2 s, jittered) |

The state is read per request and never cached, so those intervals are the whole delay.
`LifecycleStateModule` is the read-only half that ingest, dispatch and tenancy import.

**Delete** needs the owner role, the workspace's name typed exactly, and AD.2's step-up (a session
created within five minutes, or `password`; `StepUpModule` is shared with provider reveal).
`pending_delete` revokes every non-owner session whose `activeOrganizationId` is the workspace,
through BetterAuth's adapter. A third global guard (`WorkspaceFreezeGuard`, after the tenant and
roles guards) answers `403 workspace_pending_delete` everywhere, which also covers sessions acting
by `X-Ouro-Tenant` and the five-minute cookie cache. An owner may still reach the read and restore
routes (`@LifecycleExempt()`).

**The purge** runs every `OURO_LIFECYCLE_PURGE_SWEEP_SECONDS` (`LifecyclePurgeScheduler`). It
begins by writing its `workspace_tombstones` row (`purged_at` null, the DEK versions counted),
then destroys the DEK (`VaultService.destroy`), the artifact objects and the organization
(through the library; every tenant table cascades). It counts every table naming the workspace
(asserted zero), then stamps `purged_at` and queues `audit.workspace.purged` (actor `system`) in
one transaction. See `docs/SECURITY_MODEL.md` §2.6 for exactly what the shred does and does not
reach in a backup.

**The purge resumes** (V104, [#490](https://github.com/NobuData/ouroboros/issues/490)). The sweep
picks up every tombstone whose `purged_at` is null, even after the organization row (and with it
the lifecycle row) is gone. Every step is safe to repeat, the DEK count comes from the tombstone,
and the event is queued once. A restore is refused (`409 workspace_state_conflict`,
`details.purge: "started"`) once the tombstone exists, so no failure leaves a half-shredded
workspace that can come back. Until then an owner may restore, even after `purge_after` has
passed.

**Every transition is audited and queued for webhooks.** `workspace.paused | resumed |
disconnected | delete_requested | restored` are written to `audit_events` (subject `workspace`),
and — like every audit row since BR.3 ([#487](https://github.com/NobuData/ouroboros/issues/487)) —
published to `webhook_outbox` as `audit.workspace.*` in the audit row's own transaction. The
purge's own audit row would cascade away with the workspace, so the tombstone and the outbox
event it writes directly are its record.

**The rehearsal.** `lifecycle.integration-spec.ts` runs pause → stage finishes → holds → resume,
disconnect, delete → restore, and delete → day 30 → purge on a fixture tenant in `ci/rest`. It
asserts that a value sealed before the purge no longer decrypts after it. BR.6's
`settings/governance/lifecycle.governance.integration-spec.ts` injects a failure at each purge step
and asserts that the next sweep completes it.

## Needs-You reads, snooze and the policy card

BN.4 ([#464](https://github.com/NobuData/ouroboros/issues/464)) — everything mockup 16 reads, beside
the feed (`decisions/inbox.queue.ts`, `decisions/inbox.compose.ts`, `inbox-policies/`):

```
GET  /api/v1/inbox              open items newest first: question/why/tags rendered at the pinned
                                version, facts, refs, age, actions resolved per viewer (disabled with
                                role_required | capability_required); snoozed items apart; the head
GET  /api/v1/inbox/resolved     one UTC day (?day=YYYY-MM-DD): resolver class, policy ref, channel,
                                the composed line ("Split #490 into 6 tickets — approved"), paging
GET  /api/v1/inbox/stats        this UTC week's decision_metrics_weekly — null / "—" when cold
GET  /api/v1/inbox/policies     What Needs A Human, each row from the config that enforces it
POST /api/v1/inbox/items/:id/snooze · /snooze-all · /items/:id/unsnooze · /unsnooze-all   (contributors)
```

**The head is computed** (X8): Σ over the queue of each kind's median answer time this week, a kind
unanswered this week costing the week's median; no answers this week → no estimate. **Snooze is
honest** (X6): out of the queue and the pill, never out of the metrics, `created_at` untouched; Snooze
all is one V095 scope-all event; every snooze write is audited. **The policy card derives** (X7):
`human_review` rows from the published org policy through `OrgPolicyGateResolver.document` (the gate
engine's reader, widened rather than duplicated), protected paths from BA.1's
`protected_path_policies`, the claim-waiver row from AX.3, the caption from BA.3's dry-run. The spend
row is absent while `spend_approval` is dormant, and *effort XL+ → plan sign-off* is absent because
no workflow human gate enforces it.

**Every link is resolved here** (BO.2 [#467](https://github.com/NobuData/ouroboros/issues/467),
`decisions/inbox.links.ts`), so the card holds no route and no kind. Each ref carries the `href`
its tag opens — a run the run console, a PR its verification page, a ticket intake searched for its
key, a path the diff on the item's run — and each link action (`navigates: true`) the `href` its
`navigate.<target>` binding leads to, resolved from the item's refs and source ref. They are
origin-relative UI paths, restated from `ouroboros-ui/app/paths.ts` in `UI_ROUTES`; a target the
table does not know, or one whose ref the item lacks, is `null`, and the card shows the link as
unavailable. `inbox.links.spec.ts` fails when a shipped kind declares a target with no destination.

**A resolved row comes in halves** (BO.3 [#468](https://github.com/NobuData/ouroboros/issues/468)):
beside `summary`, `GET /api/v1/inbox/resolved` serves the `subject` (*Split #490 into 6 tickets*)
and the `verdict` (*approved*, *auto-accepted by policy*) it is made of, so the page can set a
policy's answer apart without parsing a sentence, and `policyHref` — where the rule that answered
is configured (`/settings#policies`), `null` for a person's answer and for `source_resolved`,
which is not a rule anybody configured.

## Needs-You action executor

`POST /api/v1/inbox/items/{id}/actions/{actionId}` (`src/modules/inbox-actions/`, BN.2
[#462](https://github.com/NobuData/ouroboros/issues/462), decision **X3**) answers a decision by
calling the plane that owns the operation — **the inbox executes nothing itself**:

```
approve_merge            AX.5 decide(approve) → AX.4 arm the PR's existing plan → run it once
waive_annotate           AX.3 waive (note = reason) → public host annotation
allow_once               grant (V096) → AP.3 reevaluatePaths (spends it) → AP.4 resume
deny                     AP.4 correction round carrying the reason
return_to_loop / retry   AP.4 correction round with the note
cancel_run / stop_loop   AP.4 abort, confirmed with the loop's number
approve_split            AL.3 push        require_bench_upgrade   AL.4 compose (planner bench-v1)
confirm / retire         facts confirm|reconfirm / reject|expire
```

`sign_off`, `discard`, `accept_resize`, `keep_size` and `approve_spend` answer
`501 decision_action_unbound`: their planes have no operation yet. The flow
(`inbox-actions.service.ts`): the action must answer the item (a link is `422`); its declared
`required_role` is checked server-side (`approver` = `can_approve_loops`); a note exactly when it
`takes_note`; then a **claim** under the item's row lock — a repeated `idempotencyKey` replays the
first attempt, a resolved item answers `409 decision_already_answered` naming who, when and how, and
a running attempt `409 decision_action_in_progress` (V099 allows one per item; one older than ten
minutes is taken over as abandoned). A handler that throws leaves the item **open**, its attempt
`failed` with the plane's error (re-thrown unchanged) and audited `decision.answer_failed`; success
writes V095's resolution and finishes the attempt in one transaction, audits `decision.answered`
with the receipt as `outcome_*` keys, and tells `DecisionLifecycle` (BN.3's channel echo; V096's
trigger revokes outstanding action tokens). A service account cannot answer.

**The answer carries its receipt** (BO.2 [#467](https://github.com/NobuData/ouroboros/issues/467),
`inbox-actions.receipt.ts`): `receipt.effects` — what executed, in words — and `receipt.links`,
composed from the plane's outcome and keyed by `handler_binding`, never by kind. It says what
happened rather than what was hoped: *exception granted · resume sent to loop #1844* until the loop
acknowledges the control (then *loop #1844 resumed*), *merge armed — it lands once its checks are
green* until AX.4 merges, and a failed host annotation says so. A binding with no entry reads as the
action in the past tense, linked to the item's run and PR; `inbox-actions.receipt.spec.ts` fails
when a bound operation falls back to that line.

**Allow once** is the one new mechanism: AP.3 gained `GuardrailService.reevaluatePaths`, which
re-judges `allowed_paths` alone over the run's recorded change-set (the hunks the secrets scan needs
were never stored, so `secrets` is left as last judged) and spends the grant. If AP.3 still says no,
the grant rolls back with the transaction.

## Decision channels — GitHub mirror & email tokens

`src/modules/inbox-channels/` (BN.3 [#463](https://github.com/NobuData/ouroboros/issues/463),
decision **X5**, schema `V100`) makes two channels real and says honestly that the other two are not.

```
lifecycle filed|refreshed|resolved ─▶ mirror: ONE PR comment per item (SPI commentPR, key decision-<id>),
                                      edited on refresh/resolution · failures recorded, retried each minute
lifecycle filed|refreshed (err)    ─▶ instant mail to members who may answer · one token per action
minute tick                        ─▶ mirror retries · failed instants retried · due daily digests
GET  /api/v1/inbox/answer/:token   public · the decision card + one button · nothing executes on open
POST /api/v1/inbox/answer/:token   spend (once) ─▶ InboxActionsService.execute(…, "email") ─▶ receipt
GET  /api/v1/inbox/channels        github|email connected when real · slack/push unavailable-until
GET|PATCH /api/v1/inbox/notifications   the caller's digest on/time (UTC), instant err|off, mutes
```

- **Mirror target**: the item's `pr` ref, else the PR its run opened; otherwise `skip_reason no_pr`
  (a source without PRs: `no_comment_surface`). The stored comment ref and the SPI marker both key
  by item, so a retry or redeploy edits rather than reposts.
- **Tokens** (`tokens/`): `ouro_act_<key id>_<256-bit secret>`; V096 stores only
  HMAC-SHA256 under a per-workspace key the vault seals (V100 `action_token_keys`). One live token
  per (item, action, person) — a newer mail supersedes; resolution through any channel revokes.
- **Confirm page** (`answer/`): linked on the **UI origin**, which `ouroboros-ui`'s `proxy.ts`
  forwards here, so the session cookie arrives. A merge-class (`requires_confirm`) action demands
  the token's own signed-in person; anyone else's session refuses the link. Expired, used,
  answered, superseded, withdrawn and unknown links each render their own page.
- **Defaults** (no stored preferences): digest off (09:00 UTC once on), instant `err` mails on.
- **The channel rows are the card's text** (`channels.truth.ts`): the *Answer From Anywhere* card
  (BO.4 [#469](https://github.com/NobuData/ouroboros/issues/469)) prints each row's `label`,
  `summary` and `reason` verbatim and draws a ✓ for `connected` alone, so a sentence changed here
  is a sentence changed on the page. GitHub's summary states the comment's whole life — posted
  when a decision is asked, edited when it is answered.
  Org-level notification routes are #488's (BR.4).

**The inbox suites** (BN.5 [#465](https://github.com/NobuData/ouroboros/issues/465)) — integration
specs on Testcontainers Postgres, the AP.5 driver and the PR sandbox: `decisions/` (registry
generality, emitters, out-of-band closure, reads and the weekly oracle), `inbox-actions/` (every
handler chain observed downstream, races, `allow-once.integration-spec.ts` for grant scope, TTL,
single use, revocation and the audit chain, `inbox.isolation.integration-spec.ts` for every
`/api/v1/inbox` route) and `inbox-channels/` (mirror, tokens, preferences, and mailpit content).
Each safeguard — the confirm gate, single-use spend, idempotency replay, the role check — has a
test that turns red when it is removed.

## Outbound webhooks

> **Issue:** [#487](https://github.com/NobuData/ouroboros/issues/487) — *[BR.3] Outbound webhooks &
> SIEM streaming* · epic [#477](https://github.com/NobuData/ouroboros/issues/477) · decision **S8** ·
> schema `V090`, `V094`, `V098` · receiver contract [`docs/WEBHOOKS.md`](../docs/WEBHOOKS.md)

Org-configured endpoints subscribed to typed event families, HMAC-signed at-least-once delivery
with retries, a visible dead-letter queue and a delivery log. *Stream to SIEM* is simply the
endpoint flagged `siem`, subscribed to `audit.*`. `src/modules/webhooks/` is the module.

```
change + event      one transaction   audit row → audit.<action> (+ decision.* / pr.*) · run → run.*
webhook_outbox      dispatcher tick   one pending attempt per subscribed active endpoint
attempt             lease · sign · POST (SSRF-guarded lookup) · settle
settle              2xx succeeded · else failed + backoff retry · dead_lettered after N
```

```
GET    /api/v1/settings/webhooks                                     owner/admin · items · activeCount · siem · registry
POST   /api/v1/settings/webhooks                                     owner/admin · answers with the secret, once
GET    /api/v1/settings/webhooks/:id                                 owner/admin
PATCH  /api/v1/settings/webhooks/:id                                 owner/admin · edit, enable, disable, registry version
DELETE /api/v1/settings/webhooks/:id                                 owner/admin · the log cascades
POST   /api/v1/settings/webhooks/:id/rotate-secret                   owner/admin · the new secret, once
POST   /api/v1/settings/webhooks/:id/ping                            owner/admin · a real attempt, logged
GET    /api/v1/settings/webhooks/:id/deliveries?status=              owner/admin · the log; dead_lettered = the DLQ
POST   /api/v1/settings/webhooks/:id/deliveries/:deliveryId/redeliver owner/admin · same key, one try
```

**One emitter: the outbox.** `enqueueWebhookEvents(executor, …)` (`webhook.outbox.ts`) inserts on
the caller's own transaction. `AuditRepository.append` writes the audit row and its outbox rows
together, so every audited action is published and nothing is published unaudited; the ingestion
contract (`run.opened`), the console's abort (`run.canceled`) and the merge executor (`run.merged`
+ `pr.merged`) write theirs in the transaction that moves the run (`webhook.run-events.ts`).

**The registry is versioned** (`webhook.registry.ts`). Version 1 is a literal list; a release that
adds a type appends a version, and an endpoint receives only the types of the version it
subscribed under until it is moved. The spec fails if an audit action is registered nowhere.
Version 2 (#462) adds `decision.answered` and `decision.answer_failed`, as audit and decision types;
version 3 (#464) adds `decision.snoozed`, `decision.snoozed_all` and `decision.unsnoozed`.
Matching is exact: a family wildcard covers its own family only.

**The dispatcher** (`WebhookDispatcher`, every `OURO_WEBHOOK_DISPATCH_SECONDS`) claims outbox rows
and due attempts with `for update skip locked`, so several instances share the work. A claimed
attempt is *leased* (its `next_attempt_at` pushed two minutes on), not removed: a crash mid-send
re-sends it with the same `X-Ouro-Delivery`. Failures retry after 30 s, 1 m, 2 m … (capped at an
hour) until `OURO_WEBHOOK_MAX_ATTEMPTS`, then dead-letter. A redelivery gets one try. A ping is
sent in the request and never retried. Attempts for a disabled endpoint wait.

**SSRF policy** (`webhook.ssrf.ts`): https only; loopback, link-local (metadata), RFC1918, CGNAT,
unique-local and reserved ranges refused at save and at delivery — the transport's Node `lookup`
*is* the guard, so the socket connects to the address that was approved (no DNS-rebinding gap).
`OURO_WEBHOOK_INTERNAL_ALLOWLIST` is the operator override; it never relaxes https.

**Secrets** are minted here (`whsec_` + 32 bytes), sealed under the workspace DEK with the endpoint
id as the record, and returned only by create and rotate. Endpoint readers never select the
envelope; `webhooks.secrecy.spec.ts` greps the module so a change that starts returning or logging
it fails. The delivery log keeps at most 1 024 characters of a response, credentials redacted
(`webhook.capture.ts`).

**Derived, never stored.** `activeCount` counts active rows. Each endpoint's `health`
(`idle | healthy | retrying | dead_lettered`) is counted from its log, pings excluded; the `siem`
row is `streaming` (the ✓) when the SIEM endpoint is active and healthy, and `warning` when events
are dead-lettered.

**Every mutation is audited** — `webhook.created | updated | enabled | disabled | secret_rotated |
deleted | redelivered`, subject `webhook_endpoint`, naming the host but never the URL's path or the
secret.

## Integrations & notification routes

> **Issue:** [#488](https://github.com/NobuData/ouroboros/issues/488) — *[BR.4] Integrations status
> hub & org notification routes* · epic [#477](https://github.com/NobuData/ouroboros/issues/477) ·
> schema `V094`, `V103`

Two Settings cards. `src/modules/integrations/` is the grid; `src/modules/notification-routes/` is
the routes, their API and their sender.

```
GET   /api/v1/settings/integrations           any member · tiles composed from the owning planes · connectedCount
GET   /api/v1/settings/notifications          any member · the four core routes (stored or default) · custom · channels
GET   /api/v1/settings/notifications/{kind}   any member · one route
PATCH /api/v1/settings/notifications/{kind}   owner/admin · { channel?, config?, enabled? } · audited notification_route.updated
```

**The grid is a status hub, never a second store.** Each tile is read from the plane that owns the
connection, on every request, and nothing is written: GitHub from `github_credentials` (token),
`github_orgs.installed_at` (App) and its ticket sources; Jira and Linear from their ticket sources
(unpaused, credential stored); webhooks from active `webhook_endpoints`; the build farm from
`runners` by the farm's own online rule. `availability` is
`connected | disconnected | unavailable_v2 | unavailable_unbuilt`: Slack is `unavailable_unbuilt`
until Chat Ops (mockup 19) exists, and Teams, Datadog and PagerDuty are `unavailable_v2` (BT.3).
Every `deepLink` is the owning surface (`/settings/sources`, `/build-farm`,
`/settings#integrations` for the webhook sheet); there is no connection form here.

**Org routes sit above BN.3's per-person preferences** and never read or write them. One route per
(workspace, kind) — `needs_you_dm | daily_digest | loop_failures | weekly_insights | custom:<slug>`
— bound to `email | slack | pagerduty`, with `config` `{ time (HH:MM UTC), weekday, recipients }`.

- **The locked-row rule is server-side.** A channel with no connection in this build (Slack,
  PagerDuty) locks its route with the card's reason (`connect PagerDuty first`). A save that would
  leave a locked route *enabled* is `409 notification_route_locked` with `details.reason`; a locked
  route may still be stored disabled. The sender reads only `delivering` routes, so a lock holds
  even against a row written behind the API.
- **Routes drive real sends.** `OrgRouteSender` (a one-minute jittered tick, booked only when SMTP
  is configured) mails the **daily digest** at the route's `time` — the workspace's open Needs-You
  decisions, read-only (`DecisionMailService.orgDigestMail`: no action tokens, no person's mutes) —
  and the **weekly insights** report at its `weekday`/`time` (#440's digest via
  `DigestRouteComposer`, no unsubscribe link). Recipients are `config.recipients`, else the
  workspace's owners and admins. A slot is due through a grace (6 h daily, 24 h weekly) and not
  again within a gap (20 h, 6 d), so moving the time does not send twice.
- **Separate send log.** Every attempt is claimed in V103's `notification_route_sends` by
  (workspace, kind, slot, recipient, attempt) before it leaves, settled once, retried up to 3 times;
  a claim older than five minutes is failed and retried. A member who also has a personal digest
  gets both — one is theirs, the other the workspace's.
- **`loop_failures`** is registered and locked on PagerDuty until BT.3; nothing produces a loop
  failure event yet.
- Every change writes one `notification_route.updated` audit event — `kind`, `fields`,
  `previousSource`, and `previousChannel`/`channel`, `previousEnabled`/`enabled`,
  `previousConfig`/`config` — webhook registry version 7. A save that changes nothing writes none.

### Settings governance suites & adversarial checks

BR.6 ([#490](https://github.com/NobuData/ouroboros/issues/490)) certifies the governance core:
what the product may do without asking a person, and the record of what it did. These controls
fail silently. A capability check that stops being called permits, it does not throw. So each
suite asserts through the **real consumer**, written so that removing the control turns it red.
They live in `src/modules/settings/governance/`, beside BR.1–BR.5's own suites, and add about 40s
to `yarn test:integration`:

| Suite | Holds |
| ----- | ----- |
| `policy.governance.integration-spec.ts` | every publish through `POST /policies`: version ↔ one `policy.published` row, `409` stale base, `422` no-op, loosening held to the owner (preview agrees); one edit → publish → enforce round-trip per rule — auto_merge (arm), dry_run_new_repos (arm), human_review (gate source), protected_paths (guardrail verdict), spend_guard (routing cap) — the last two through the 30 s policy cache |
| `access.governance.integration-spec.ts` | `can_approve_loops`: role × default/ticked/unticked, set through the members route, at the PR approval route **and** inbox presses and their `allowed` flags (a ticked viewer: inbox yes, PR route no); service tokens: create → act (audited `service`) → scope denied → rotate → revoke, hash-only storage |
| `webhooks.governance.integration-spec.ts` | the fixture receiver refuses a tampered body, a re-stamped timestamp, a wrong or rotated-out secret, a replay outside ±300 s and a duplicate; SSRF at save (seven internal targets, PATCH) and at delivery through the real guarded transport (DNS rebinding to `169.254.169.254`); exact family filtering; retry backoff → DLQ → one-try redeliver; a commit-time failure leaves neither audit nor outbox row; no `whsec_` anywhere but create/rotate |
| `routes.governance.integration-spec.ts` | locked routes `409` with nothing stored, a locked route enabled by SQL never sends; the daily digest route sends at its time, once, to owners and admins; org routes and personal preferences each send without suppressing the other |
| `audit.governance.integration-spec.ts` | filters (`ref=repo:`/`key:`, combinations, `from`/`to` bounds), keyset paging across tied instants under concurrent writes, CSV equal to the view across 1,200 rows with formula cells neutralised and a self-audit count, the purge's `held` count, floor refusals in the sweeper and the database; retention tiers moving only their own sweep, defaults deleting nothing, tombstone counts on the card |
| `lifecycle.governance.integration-spec.ts` | `org_state` at every dispatch point (run open, stage → active, a real farm `DispatchService` tick) in `paused` and `pending_delete`, the stage in flight finishing, release exactly once; delete's owner + typed name + step-up; restore at day 29 and after the window but before the sweep; DEK destruction by failed decrypt with another tenant untouched; a failure injected at each purge step, then resumed to one tombstone and one `audit.workspace.purged` |
| `settings.isolation.integration-spec.ts` | every route under `/settings/` and `/policies`, enumerated from the route table: another workspace's ids `404`, their slug in `X-Ouro-Tenant` `404`s, and every row naming their workspace is unchanged |

**Adversarial checks.** Each control below was removed during development and the named suite
went red:

| Control removed | Red |
| --------------- | --- |
| `tenancy/capabilities.ts` — `CapabilityGuard`'s check | access (the matrix) |
| `inbox-actions/inbox-actions.service.ts` — `assertMayPress` | access (matrix, unticked admin) |
| `tenancy/tenant.guard.ts` — the service-scope refusal | access (token chain) |
| `service-accounts/service-accounts.repository.ts` — the revoked/disabled filter | access (token chain) |
| `webhooks/webhook.signing.ts` — the MAC over the timestamp | webhooks (signatures, replay) |
| `webhooks/webhook.ssrf.ts` — `guardedAddresses`' per-address check | webhooks (save, rebinding) |
| `webhooks/webhook.transport.ts` — the guarded `lookup` | webhooks (rebinding) |
| `webhooks/webhooks.service.ts` — the save-time `checkWebhookTarget` | webhooks (eight save cases) |
| `audit/audit.repository.ts` — the outbox inside the audit transaction | webhooks (outbox) |
| `ingest/ingest.service.ts` — `admitNewWork` on run open, and on stage → active | lifecycle (dispatch points) |
| `farm/dispatch/dispatcher.ts` — the `FARM_DISPATCH_GATE` check | lifecycle (farm hold) |
| `lifecycle/lifecycle.repository.ts` — `due()`'s unfinished tombstones | lifecycle (purge resume) |
| `lifecycle/lifecycle.service.ts` — restore's `purgeStarted` refusal | lifecycle (purge resume) |
| `policies/policy-publish.service.ts` — owner-only loosening, cache invalidation | policy |
| `notification-routes/routes.service.ts` — the lock check | routes |
| `members/members.repository.ts` — the member query's workspace filter | isolation |
| `audit-plane/audit-purge.sweeper.ts` — the floor refusal | audit |

## Build logs

> **Issue:** [#253](https://github.com/NobuData/ouroboros/issues/253) — *[AH.5] Log ingest &
> retrieval* · epic [#240](https://github.com/NobuData/ouroboros/issues/240) · decision **B8** ·
> schema `V044` · [`docs/RUNNER_PROTOCOL.md` § 4.5](../docs/RUNNER_PROTOCOL.md#logchunk)

The pipe between an agent's output and the live log card (AI.6, #261): `log.chunk` frames in,
stored in PostgreSQL within caps, and read back by offset. `src/modules/farm/logs/` is the
module; like dispatch, it hears frames through `AgentSessions.listen` and the gateway never
imports it. Keeping logs in PostgreSQL is decision **B8** — no new infrastructure at MVP scale,
with object storage as the documented v2 path — and it is also why the caps and the retention
sweep are not optional.

```
log.chunk ──▶ this runner's job? ──▶ reassembly (seq order; a gap held ≤ 10 s / 64 chunks)
          ──▶ per-workspace rate guard (2 MiB/s, 8 MiB burst) ──refused──▶ elided, marked on the next chunk
          ──▶ insert: V040's cap trigger assigns byte_start, clamps at the per-job cap, counts the rest
job.finish ──▶ (a terminal hook, BEFORE the ledger marks the job finished) gaps given up ──▶ the tail
GET /api/v1/farm/jobs/:id/log?after= ──▶ {bytes, nextOffset, end, live, elisions, tail, retained, pollAfter}
sweep (every 10 min, ≤ 200 jobs per rule) ──▶ finished logs past 30 days, then each workspace over its budget
```

| Route | Role | What it answers |
|---|---|---|
| `GET /api/v1/farm/jobs/:id/log?after=` | every member | One page (≤ 256 KiB) from `after`, the `nextOffset` the reader last reached. Pages concatenate to exactly the stored log, and each ends on a UTF-8 character boundary; bytes that are not UTF-8 read as U+FFFD. `Cache-Control: private, no-cache` and `X-Ouro-Poll-After` (2 s while live, 15 s after) per the polling contract. `farm_job_not_found` for another workspace's job, `farm_log_offset_out_of_range` past the end |

**`live` is the job's state, never chunk recency — and a finished job's log is final.** A finished
job answers `live: false` at once, even if its last chunk landed a second ago, because the card's
blinking cursor is bound to it and the card stops polling on it. So nothing may change after:
the agent's `job.finish` is accounted on `AgentSessions.onTerminal`, a hook the gateway awaits
*before* its ledger transaction marks the job finished, and chunks are written only while the job
is offered, accepted or running — a cancelled build's later output is not written.

**Chunks are stored in `seq` order.** V040's cap trigger assigns each chunk's `byte_start` from the
job's running total when it is inserted, and offsets a reader has already been given must never
move. So a chunk that overtook a gap across a reconnect is held until the gap fills. A gap that
never fills is recorded as lost chunks at that position, after 10 s, after 64 chunks are held, or
when the job finishes. Inserts never use `on conflict`, because the BEFORE trigger would still
advance the running total; a re-sent `seq` is caught as a unique violation instead, which rolls
the trigger's update back with it.

**One honest marker.** Elision is data, never text in the stream. A hole before a chunk is
returned in `elisions` as `{offset, bytes, missingChunks}`: the agent's throttle drops, the rate
guard's refusals, and frames that never arrived, summed at that position. Everything after the
last stored byte is `tail`: the per-job cap's refusals, what arrived past the cap, and the
agent's own tail drops, which is its `job.finish.log.dropped_bytes` less what it had already
placed. That is one figure, so the console draws one marker where two caps meet. Until the agent
ships logs (AG.5, #247), every finished job's log is empty and its tail is all of its output,
which is the truth.

**Retention.** A finished job's log is removed once every chunk was stored (`received_at`) before
the workspace's `build_logs` cutoff — the [retention tier](#data-retention), thirty days by default
— which the sweep asks `RetentionPolicyService` for at each run, so a changed tier moves the next
sweep. Each chunk still records its `retain_until` at ingest, from the tier at that moment. Each
workspace also keeps at most `OURO_FARM_LOG_BUDGET_BYTES` (2 GiB) of finished builds' logs, with
the oldest removed first. Logs are removed whole, never in part, and only a finished job's; the
job keeps `log_swept_at`, so a read answers `retained: false` rather than an empty log. The sweep
is bounded to 200 jobs per rule per run, and logs and reports its tombstone counts.

**Known limits.** The reorder buffer and the rate guard live in one process, so after a restart
or a reconnect to another replica, a gap in flight is recorded as lost chunks rather than waited
for.

## Build artifacts

> **Issue:** [#330](https://github.com/NobuData/ouroboros/issues/330) — *[AT.2] Job artifact &
> result upload* · epic [#321](https://github.com/NobuData/ouroboros/issues/321) · decision **T4**,
> option **3-A** · schema `V060` ·
> [`docs/RUNNER_PROTOCOL.md` § 4.3](../docs/RUNNER_PROTOCOL.md#the-artifact-upload) ·
> [`docs/TEST_RESULTS_INGEST.md` § 9](../docs/TEST_RESULTS_INGEST.md#9-the-upload-that-feeds-it-330)

How a build's results get off its runner — `src/modules/farm/artifacts/`. **Not the control
WebSocket**: a large rig capture on the socket that carries heartbeats degrades exactly the channel
that decides whether a runner looks alive. So dispatch mints a single-use token with every offer of
a run's build (`job.offer.upload`), and the agent uploads over HTTPS before it reports the finish.

```
dispatch ─▶ forOffer(job)   no run? no upload · mint ouro_upl_… ─▶ SHA-256 into the ledger (V060)
agent    ─▶ POST /api/v1/farm/jobs/:id/artifacts   Bearer token · multipart: manifest, then files
  token ✓ ─▶ manifest ✓ ─▶ caps ✓ ─▶ quota plan ─▶ stream each file: sha256 · size · head ─▶ store
  ─▶ checksum ✓ ─▶ the attempt (test_runs) ─▶ parse the result files (AT.1)
  ─▶ one transaction: test_artifacts rows · receipt (manifest + warnings) · attempt complete · token closed
```

| Route | Role | What it answers |
|---|---|---|
| `POST /api/v1/farm/jobs/:id/artifacts` | the runner, by the job's upload token — no session | `201` the receipt: every file `stored`, `truncated` or `skipped` with its reason, the job warnings, and the parsed attempt's counts. `401 farm_artifact_upload_refused` for every token failure (one answer, no detail); `409 farm_artifact_upload_closed` for the right token after its upload closed; `422 farm_artifact_checksum_mismatch` or `farm_artifact_manifest_invalid`; `413 farm_artifact_too_large` past a cap |

**`/api/v1/farm/*`, not `/internal/*`.** The issue drew the route under `/internal`, but that is
the engine's surface — behind the shared secret, and one a farm host must never expose
(`HOSTING.md`). A runner is outside the network and already reaches `/api/v1/farm/`; the route is
`@AllowAnonymous()` in `registration.controller.ts`'s sense — no session, and a credential named in
the handler.

**The `ArtifactStore` is an interface from day one.** `local.store.ts` is a directory (writes land
in a temporary file and are renamed into place); `s3.store.ts` is S3 or MinIO, path-style, signed
with a hand-written SigV4 (`sigv4.ts`, held to AWS's published example) rather than the AWS SDK.
`OURO_ARTIFACT_STORE` picks one, and each row records `{driver, key}`. Four operations —
`put`, `get`, `delete`, and `open` for a streamed read (#333's downloads). A local volume does not
scale horizontally — two replicas do not share a disk — which is why the swap exists; migration
tooling is AV.5 ([#347](https://github.com/NobuData/ouroboros/issues/347)).
`artifact.store.contract.fixture.ts` is the one suite both drivers pass unchanged: in the unit
suite against a temporary directory and an in-process S3 stand-in, and in the integration suite
against the store the artifact store variables configure — the local volume, then a real MinIO
(`minio.fixture.ts`, Testcontainers).

**Nothing is dropped silently.** A file the agent cut to the per-file cap is stored with
`truncated` and its note; a file it left behind, and a file the workspace's quota had no room for,
are in the receipt as skipped, with the reason — and each is a job warning
(`artifact_truncated`, `artifact_skipped`, `artifact_quota_exceeded`). **A quota breach never fails
the build.** The receipt is `build_job_artifact_uploads`, `build_jobs`' result linkage, for the page
to render (AT.5, [#333](https://github.com/NobuData/ouroboros/issues/333)).

**A corrupted upload keeps nothing.** Every file is hashed as it streams to the store, and a
mismatch, a malformed manifest or a store failure removes every object the request wrote and
leaves the token open for the agent's retry. Objects are keyed `<org>/<job>/<request>/<name>`, so
two requests racing with one token never write the same object; the closing transaction locks the
ledger, and the loser is answered as a replay.

**What a submission and a pool add.** `POST /api/v1/farm/jobs` takes `artifacts` — extra globs,
such as `logs/serial-console.log` — and a pool's `artifactGlobs` (`captures/*.csv`) apply to all
its builds; the job snapshots both at submit time. The offer adds the built-in result set first
(`**/junit*.xml`, `**/ouro-hil-results*.json`, `**/lcov*.info`, `**/coverage*.xml`,
`**/cobertura*.xml`), so the agent collects results before captures when the caps bite.

**Known limits.** The quota is checked when an upload starts, so two uploads of one workspace in
the same instant can together pass it by one upload. An upload is one request: a retry resends
the whole collection, because the service keeps nothing from an attempt it did not accept.

## The farm page

> **Issue:** [#254](https://github.com/NobuData/ouroboros/issues/254) — *[AH.6] Farm read APIs &
> stats* · epic [#240](https://github.com/NobuData/ouroboros/issues/240) · decisions **B5**,
> **B9** · [`docs/mockups/08-build-farm.html`](../docs/mockups/08-build-farm.html)

Mockup 08's read surfaces and the lifecycle actions behind its `⋯` menu.
`src/modules/farm/fleet/` is the module; AI.1–AI.5 (#256–#260) are its clients.

```
GET /api/v1/farm ─▶ { stats:   { runnersOnline 4/5 · "forge-03 offline · 2h"
                                 buildsToday   23 = 19 clean · 3 retried · 1 failed
                                 avgBuildTime  252 s · Δ −38 s vs last week
                                 cacheHitRate  78% · "ccache · per-runner" },
                      runners: [ …telemetry, security_mode, q:N, current job… ],
                      pools:   [ …executor, image, counts, autoscale_pref (inert)… ],
                      live:    { #479 on forge-01 } }

EMPTY ORG  ─▶ runnersOnline 0/0 · buildsToday 0     ← genuine zeros
              avgBuildTime null · cacheHitRate null ← nothing to average (NOT 0m00s / 0%)
              deltaVsLastWeek absent                ← no prior window (NOT ▼0s)
```

| Route | Role | What it does |
|---|---|---|
| `GET /api/v1/farm` | every member | The whole page, from four statements over one set of window boundaries. `Cache-Control: no-store` and `X-Ouro-Poll-After: 10` — the fleet's own heartbeat cadence. Each runner carries its live `certificate` — serial, `notAfter`, `renewAfter` — or `null` ([#260](https://github.com/NobuData/ouroboros/issues/260)) |
| `GET /api/v1/farm/pools` | every member | The pools with their runner counts, for a configuration sheet that reloads after an edit |
| `POST /api/v1/farm/pools` | `admin`+ | Create a pool. A container pool pins an image and a shell pool does not — both directions |
| `PATCH /api/v1/farm/pools/{id}` | `admin`+ | Change one, including the card's enabled switch. A field the body does not name is left alone |
| `DELETE /api/v1/farm/pools/{id}` | `admin`+ | Delete one nothing points at. `farm_pool_in_use` names the counts and offers disabling instead |
| `POST /api/v1/farm/runners/{id}/drain` · `/undrain` | `admin`+ | Write the intent and push the frame through AH.3's `RunnerControl`. `pushed: false` is not a failure |
| `DELETE /api/v1/farm/runners/{id}` | `admin`+ | Retire a machine — **offline or drained only** — and revoke its certificate |
| `GET /api/v1/farm/enroll-command?pool=` | `admin`+ | The enroll card's one-liner, with a freshly minted token. On `enrollment.controller.ts`, beside `mint` |

**Each runner names the certificate it presents** ([#260](https://github.com/NobuData/ouroboros/issues/260),
for the UI's runner details sheet). `certificate` is the **live** one — not revoked, not
superseded, `FarmRepository.liveCertificate`'s predicate as one set statement for the fleet — as a
serial and two dates, with `renewAfter` derived by the rule the agent itself was handed
(`notAfter` less `RENEWAL_LEAD_MS`) rather than stored. It is `null` for a machine on the bearer
fallback, which holds none by construction (decision B3), and on a removal's answer, which has just
revoked it. **Live is not valid**: a machine switched off for a quarter still holds a certificate
whose `notAfter` has passed, and the payload says so rather than hiding it. None of the three is a
secret — a serial travels in every handshake and `runner.enrolled` has always recorded it — and the
fingerprint and the rest stay on the `RunnerCertificate` a revocation answers to an administrator.

**Every stat is a window, and the windows have edges.** They are computed once per request in
`fleet.policy.ts` and handed to every statement, so one payload's figures are consistent with
each other. *Today* is a **calendar** day in **UTC** — the same zone `dashboard/windows.ts`
takes, through the same `startOfDay`, so a workspace reading *builds today* on two pages is
told about one day — and the payload publishes the `since` instant and the `timeZone` rather
than leaving *today* a word. *Last week* is the **seven whole days before today**, stepped back
from the day boundary rather than from `now`: a rolling `now − 7d` would overlap today by
however far into it the request landed, and the delta would shrink towards zero as the day went
on.

**`null` is not `0`, and `fleet.stats.ts` is where the difference is decided.** A count of
nothing is zero — an empty workspace has zero runners online out of zero. An *average* of
nothing is `null`: `0m 00s` is not a fast farm and `0%` is not a cache that missed. A delta
needs both windows, so `deltaVsLastWeek` is absent when either is empty rather than claiming a
comparison nobody made. AI.1 renders each of them as the mockup's em-dash. This is also why
`fleet.repository.ts` returns **sums and counts separately** and never
`coalesce(avg(…), 0)` — the zero the database would helpfully supply is the exact value the
issue refuses.

**The cache label says what is true.** The mockup reads `ccache · shared per pool`; decision
**B5** scopes the MVP's caches to one per runner, so this service emits `ccache · per-runner`
until AJ.2 ([#264](https://github.com/NobuData/ouroboros/issues/264)) makes sharing real. The
number is honest either way — a weighted Σ hits ÷ Σ objects is the same arithmetic whoever the
cache belonged to — so the label is the only part that could lie, and it is **composed** from
`CACHE_SHARING` rather than written out. `grep CACHE_SHARING` is the whole of AJ.2's edit.

**Observation and intent stay two columns.** Drain writes `desired_state` and pushes a frame;
the **pill** is `status`, and only the agent's own heartbeat writes it. So a drained machine and
a dead one are distinguishable, and *who drained bigiron?* is answered by
`runner.drained` in the trail. Removal is the one action that writes both, because
`runners_removed_is_intended` requires it — and it is **guarded**: a runner may be retired when
it is `offline` or `draining` and not otherwise, because removing one mid-build strands that
build. The guard is checked for a readable error **and applied again in the `update`'s `where`**,
since a machine can heartbeat its way back to `online` in between.

**`autoscale_pref` is stored, inert and returned unchanged** (decision **B9**). It is validated
against V040's closed shape so AJ.1 ([#263](https://github.com/NobuData/ouroboros/issues/263))
can activate it without first discovering what accumulated in the column, and nothing between
the request and the response looks inside it.

**The enroll command is real.** It renders this deployment's **own** origin — the mockup's
`get.ouroboros.dev` is design shorthand, and a self-hosted tenant installs from itself — a
**pinned** release (`?version=`, so two machines enrolled a month apart are one build), and a
**freshly minted token**, because a masked one enrols nothing. Every value is single-quoted:
the destination is a shell, and `?` is a glob character. It is a `GET` that mints, which the
issue specifies and `GET /api/v1/farm/authority` already precedents — opening the card *is* the
request — and it answers `no-store` behind a session and `ADMINISTRATORS`.

**Known limits.** The runners list is ordered by name, not by the mockup's status grouping:
the grouping is a presentation choice AI.2 makes from the `status` it is given, and an API that
sorted by it would change row order as machines came and went. `buildsToday` carries a
`canceled` count the mockup does not show, so the four terminal states partition the day
exactly; the seeded day has none, so the card still reads `19 clean · 3 retried · 1 failed`.

## The runner installer

> **Issue:** [#248](https://github.com/NobuData/ouroboros/issues/248) — *[AG.6] Packaging, install
> script & daemonization* · epic [#239](https://github.com/NobuData/ouroboros/issues/239) ·
> [`ouroboros-runner` § Install](../ouroboros-runner/README.md#install)

The build farm's one-liner installs the agent **from this deployment**, not from a public host:

```bash
curl -fsSL 'https://<this deployment>/install.sh?version=0.5.0' | sh -s -- \
  --tenant acme-robotics --pool pool-a --token orb_enroll_…
```

Mockup 08 shows `get.ouroboros.dev`, which is design shorthand. A self-hosted deployment behind a
firewall may have no route to a public host, and no reason to trust one for a binary that runs on
its build machines — so `src/modules/farm/installer/` serves both halves itself, at the origin root
and without a session (`curl` holds none):

| Route | Answers |
|---|---|
| `GET /install.sh[?version=X]` | The release's `install.sh` with **one line changed**: `DEFAULT_SERVER` is filled in with `OURO_FARM_PUBLIC_URL` (or `OURO_REST_URL` when that is https). So the command needs no `--server` — the script downloads from this deployment and enrols into it. `?version=` pins the release; without it, the newest stable one present. `X-Ouro-Runner-Version` names it |
| `GET /runner/<version>/<file>` | One file of a release, **unchanged** — the three binaries, `install.sh` and `SHA256SUMS` — so each is the file the checksums name. The installer downloads its binary and `SHA256SUMS` from here and verifies one against the other before running anything |

```
OURO_FARM_RELEASES_DIR/            one directory per version, exactly as make release writes it
├── 0.5.0/                         and the GitHub release ouroboros-runner-v0.5.0 carries it
│   ├── ouroboros-runner-linux-amd64
│   ├── ouroboros-runner-linux-arm64
│   ├── ouroboros-runner-darwin-arm64
│   ├── install.sh                 DEFAULT_VERSION='0.5.0' — a release's installer installs that release
│   └── SHA256SUMS
└── 0.6.0-rc.1/                    served when asked for by version; never the default beside a stable one
```

**Nothing a request sends becomes a path.** A version is used only once it parses as SemVer,
which has no `/`; a file only once it is one of the five names a release holds. Anything else is
`404 farm_release_not_found`. A deployment not set up to serve the installer — no directory, no
release in it, no https origin to write in — answers `404 farm_installer_unavailable` with a
sentence naming the variable to set, and never the directory's path. Both are JSON envelopes, so
`curl -f` prints the status and pipes nothing into `sh`.

**The directory is read on every request.** Copying a release in serves it at once; there is
nothing to restart and nothing cached, because `/install.sh` is called once per machine.

**To serve a release**, copy the GitHub release's files into a directory named for its version and
check them with the file that came with them:

```bash
gh release download ouroboros-runner-v0.5.0 --repo NobuData/ouroboros \
  --dir "$OURO_FARM_RELEASES_DIR/0.5.0"
(cd "$OURO_FARM_RELEASES_DIR/0.5.0" && sha256sum -c SHA256SUMS)
```

In development `OURO_FARM_RELEASES_DIR` is `../ouroboros-runner/dist`, which is where
`make release` writes — so one `make release` in `ouroboros-runner/` is a release this service
serves.

## Research estimates

`POST /api/v1/research/estimates` is mockup 22's composer line — `est. 40–60 sources · ~$6`
— and its `researcher:` pill, answered together
([#622](https://github.com/NobuData/ouroboros/issues/622), decision **V5**). The composer calls
it on every kind, depth or tool change; nothing is stored.

```
POST /api/v1/research/estimates  {kind: gap_analysis, depth: deep_dive,
                                  tools: [web, competitor, code, tickets, telemetry]}
  ─▶ resolve("research")        ─▶ researcher-long-ctx (first kept hop)      ─▶ the pill
  ─▶ price(claude-sonnet-4-6)   ─▶ $3 · $15 per 1M (bundled catalog)
  ─▶ 40 operations ─▶ 40–60 sources ─▶ 44–64 calls ─▶ 522–687¢ ─▶ "est. 40–60 sources · ~$6"
```

**Computed, never invented.** `src/modules/research/estimate.calibration.ts` holds every
constant — depth rounds and synthesis passes, operations per tool per round, sources per
operation, the token shape of a digest call and a synthesis pass — under a
`CALIBRATION_VERSION`. `estimate.ts` is the pure function over them, in exact `bigint`
arithmetic over the `numeric(14, 4)` rates (the low end floors, the high end ceils). Change a
constant, bump the version.

**No price, no dollars.** A researcher with no per-token price — no catalog row, a `seat` or
`usage` price, no `research` route, or no kept hop — gives `costCents: null`, null hosted
costs and a label with no `$`. A `free` model is priced at a real zero and reads `$0`.

**Hosted tool costs** come from `ResearchToolPricing`, an injectable whose default answers
*no hosted provider is configured*; CL.2 ([#615](https://github.com/NobuData/ouroboros/issues/615))
overrides it with its provider configs' per-operation prices.

**Storage and reconciliation** are service methods, exported for CM.6 (#625) and CM.1 (#620):
`ResearchEstimateService.storeEstimate(org, investigation)` writes the estimate and its
`estimate_calibration_version` onto a **queued** investigation (`409
investigation_not_queued` after that), and `reconcile(org, investigation)` writes estimate and
actuals side by side through V109's `record_investigation_estimate_outcome()` — idempotent, with
generated `sources_within_estimate` / `cost_within_estimate` — which is what recalibration reads.

## Research telemetry

`telemetry` is the fifth research tool — mockup 22's `∿ Build & test telemetry` row
([#619](https://github.com/NobuData/ouroboros/issues/619)): read-only windows over what the
product already measures, cited so that every quoted number re-runs. Its contract — operations,
windows, the no-data record, locators — is [`docs/RESEARCH_TOOLS.md`](../docs/RESEARCH_TOOLS.md)
§ `telemetry`; this is where the code is.

```
metric_window(merge_rate, 30d)            ─▶ {91.84 %, n = 98 opened, 2026-09-11..2026-10-10}
compare(hover_drift_cm, baseline:v2.0.4, 7d)
   ─▶ {+14% (+4.34 cm), n_a = 48, n_b = 12}
   ─▶ telemetry://case/<key>/hover_drift_cm/baseline:v2.0.4-vs-2026-10-03T…Z..2026-10-10T…Z
empty window ─▶ {status: no_data, window searched}        (never 0)
```

| File | What it holds |
| --- | --- |
| `research/telemetry/telemetry.window.ts` | Parsing a window and resolving a relative one to the absolute range it is cited as |
| `research/telemetry/telemetry.locator.ts` | `locatorOf()` and `queryOf()` — a citation and its query, inverses |
| `research/telemetry/telemetry.readings.ts` | A reading (`ok` or `no_data`) from each plane, and `compareReadings()` |
| `research/telemetry/telemetry.stats.ts` | Median, interquartile range, the signed delta |
| `research/telemetry/telemetry.repository.ts` | The selects over measurements, case history, flake scores, runs, token usage and baselines |
| `research/telemetry/telemetry.sources.ts` | A result as a `telemetry` source record, its hash the result's digest |
| `research/tools/adapters/telemetry/telemetry.tool.ts` | The adapter: the four `query` operations and `fetch` |
| `insights/metrics/metrics.service.ts` § `span()` | The insights plane over explicit days — added for this tool, the same composition `window()` uses |

Three things are held structurally rather than by convention: the repository issues **only
selects** (`telemetry.repository.spec.ts` enumerates every statement, and the integration spec
digests every plane before and after running every operation); a `no_data` reading **has no
numeric field**; and a locator the tool writes is always one `source_locator_valid()` (V122)
accepts and `queryOf()` reads back to the same query. CM.4's watch (#623) makes its nightly
comparison through the same `compare`.

## Research briefs

A brief, read — mockup 22's featured card ([#621](https://github.com/NobuData/ouroboros/issues/621)):
the read model, the sources ledger, the capability matrix builder, the proposed-from-gaps summary
and the Markdown export. Everything is composed once (`BriefsService.document`) from the stored
rows, and every route and the export read that composition — so a citation has one label on
every surface, and it is the ledger's own stored number.

```
GET /api/v1/research/investigations/:id/brief         ─▶ paragraphs · panel · matrix · proposed
GET /api/v1/research/investigations/:id/sources       ─▶ the whole ledger, excerpts + retrievedAt
GET /api/v1/research/investigations/:id/brief/export  ─▶ RS-127-brief.md (text/markdown)

matrix input ─ parse ─▶ complete rows, cited cells ─ deriveSeverity ─▶ rows + cells + links
   uncited non-unknown cell ─▶ 422 matrix_cell_uncited        (nothing stored)
   us partial · best rival shipping · proposed high ─▶ HIGH, derivation stored beside it
```

| File | What it holds |
| --- | --- |
| `research/briefs/brief.citations.ts` | `citeLabel()` — the one function that names a citation — and how a locator is printed and linked |
| `research/briefs/brief.read-model.ts` | A stored body → paragraphs of spans with claim types, cites and code-reference segments |
| `research/briefs/matrix.input.ts` | The gap-analysis deliverable input, parsed and held to decision V7 |
| `research/briefs/matrix.severity.ts` | The severity rule and the derivation stored with each severity |
| `research/briefs/matrix-builder.service.ts` | `MatrixBuilderService.build()` — idempotent; called by the loop when a matrix input is delivered |
| `research/briefs/gap-proposals.ts` | `proposeFromGaps()` and the effort roll-up — what the chip row shows and #624 drafts |
| `research/briefs/brief.export.ts` | `exportBrief()` and `readBriefExport()`, its inverse for citations |
| `research/briefs/briefs.service.ts` | The composition; `proposed()` and `export()` are the contracts #624 builds on |
| `research/briefs/briefs.repository.ts` | The reads, and the matrix written in one transaction under V112's deferred triggers |
| `research/briefs/rs127.fixture.ts` | RS-127 as the seed writes it, and an in-memory store |

**The severity rule.** Standing is `none` 0 · `partial`/`wip` 1 · `shipping` 2; a rival whose cell
is `unknown` is left out. Ours `wip` → `wip`. Ours unknown, or no rival known → `low`. Otherwise
distance = best known rival − ours: below 0 `lead`, 0 `low`, 1 `med` (or `high` when the
investigation proposed `high`), 2 `high`. A proposed gap the cells do not support is clamped, and
the stored derivation says so.

**Building is best-effort at delivery.** The brief is written first and stands on its own; a
matrix the builder refuses is logged with its reason and not stored in part. An investigation has
one matrix, so a second build answers `exists`.

## Investigation lifecycle

Start, watch, cancel, list — the surface behind mockup 22's composer, its investigations card,
**History** and the head's **Research library** button
([#625](https://github.com/NobuData/ouroboros/issues/625)). The module composes what the earlier
research tickets export — the estimate (`ResearchEstimateService`, #622) and dispatch and cancel
(`InvestigationDispatchService`, #620) — and adds the reads.

```
POST  /api/v1/research/investigations               ─▶ 201 {investigation: RS-128 queued, estimate}
GET   /api/v1/research/investigations?kind=&status=&quarter=
                                                    ─▶ {items, total, counts: {active, thisQuarter}, quarter}
GET   /api/v1/research/investigations/:id           ─▶ row + estimate · actuals · progress · brief ref
                                                       · deliverables · ledger by tool · links
POST  /api/v1/research/investigations/:id/cancel    ─▶ cancelled | cancelling · ledger kept
GET   /api/v1/research/investigations/:id/progress  ─▶ SSE: progress … done
GET   /api/v1/research/settings                     ─▶ {startRole: member | admin}
PATCH /api/v1/research/settings                     ─▶ owners and admins

start:  role gate ─▶ estimate (kind, tools, researcher) ─▶ insert queued ─▶ dispatch
          no researcher ─▶ 409, nothing created
          dispatch refused (engine down, no adapter) ─▶ the new row is cancelled, the refusal answered
```

| File | What it holds |
| --- | --- |
| `research/lifecycle/lifecycle.service.ts` | Start, cancel, list, detail, progress reading and the starter-role setting |
| `research/lifecycle/lifecycle.repository.ts` | One record query (kind, ledger count, spend, newest brief, matrix, loop state, evidence, fix run), the two counts, the insert |
| `research/lifecycle/lifecycle.resources.ts` | Row, detail, list and progress shapes; `pillOf()`, `linksOf()`, `primaryLink()` |
| `research/lifecycle/progress.stream.ts` | `watchProgress()` — the poll — and its SSE framing |
| `research/lifecycle/quarter.ts` | Calendar quarters in UTC: `quarterOf()`, `parseQuarter()` |
| `research/lifecycle/lifecycle.fixture.ts` | Mockup 22's four rows as records, and an in-memory store |

**The counts are computed.** `active` is every investigation not `failed` or `cancelled`;
`thisQuarter` is every investigation created in the current UTC calendar quarter, from the clock
at request time. Both cover the whole workspace whatever the filters, in one statement.

**The pill and the link are derived.** The pill is the status in the card's words, except
`fix loop live` (a finished investigation whose `fix_draft` was pushed as a ticket whose pull
request has a run in flight) and `cancelling`. The link is the first of *run → roadmap → brief →
evidence* the investigation has; evidence is the test run named by the first ledger record whose
`meta.test_run_id` is a test run of the same workspace.

**Who may start is `workspace_settings.research_start_role`** (V123): `member` — owner, admin
and member, the default — or `admin`. It is checked in the service because it is data, not a
fixed `@Roles()` list. Cancel is the starter's or an administrator's. Both writes are
`@HumanOnly()`.

**Progress is a poll per subscriber**, once a second (`POLL_MS`), of the same record the detail
reads — so any number of subscribers on any instance may watch one investigation. An event is
sent when the reading changes, `: keep-alive` otherwise, and `done` when the investigation is no
longer queued or running, after which the stream ends. The shared live-update channel (#89) is
not built; when it is, this stream can move to it without changing its events.

## Regression watch

Mockup 22's regression watch as a service ([#623](https://github.com/NobuData/ouroboros/issues/623),
decision V6): every nightly window compared with the release's baseline, real drift bisected to a
commit, turned into a forensics investigation and drafted as a fix — deterministically, with no
model involved. `research/watch/` owns the watch's own steps and composes every other plane
through that plane's exported service.

```
release tag ─▶ POST /internal/research/regression-watch/releases ─┐
by hand     ─▶ POST /api/v1/research/regression-watch/baselines ──┴▶ capture: telemetry metric_window
                                                                      ─▶ regression_baselines (once per release)
tick (once per UTC day) ─▶ compare: telemetry compare(baseline:<tag>, <n>d) ─▶ evaluateDrift
        within thresholds ─▶ nothing opened
        drift ─▶ watch item (signed drift · err|warn) ─▶ inbox: regression_drift_detected
tick (every pass, per open item) ─▶ one step:
  detected ─▶ CodeBisectService.start(good = release, bad = nightly ref, test = replay)   ─▶ bisecting
              no replay test · unresolvable ref ─▶ stays detected · "needs repro: …"
  bisecting ─▶ converged ─▶ bisect_result {culprit, farm jobs} ─▶ bisected ─▶ inbox: bisect_complete
               inconclusive | failed | canceled ─▶ detected · "needs repro: …"
  bisected ─▶ investigation (regression_forensics, origin regression_watch),
              ledger seeded with the telemetry:// comparison and the bisect:// source,
              storeEstimate + dispatch (best effort) ─▶ investigation_open
  investigation_open ─▶ BatchesService.compose (planner regression-watch-v1, one draft) ─▶ fix_drafted
  fix_drafted ─▶ [auto_file only] push the batch, queue the mirrored issue
                 draft pushed ─▶ fix ticket ─▶ run in flight ─▶ fix_running
  fix_running ─▶ pull request on the ticket merged ─▶ fixed_merged
```

| File | What it holds |
| --- | --- |
| `research/watch/watch.drift.ts` | `evaluateDrift()` — enough samples, clear of the baseline's spread, in the worse direction, past the threshold; the unit a drift is printed in |
| `research/watch/watch.readings.ts` | The telemetry tool's `metric_window` and `compare` as V115 window statistics, with their citations |
| `research/watch/watch.service.ts` | Capture, the nightly comparison, the card, the settings and dismissal |
| `research/watch/watch.chain.ts` | `advance()` — one item, one step; `bisectResultOf()`; the fix draft's title and body |
| `research/watch/watch.inbox.ts` | The two inbox emissions, keyed per item and stage, and the detector that settles them |
| `research/watch/watch.scheduler.ts` | The pass: comparisons due today, then every open item |
| `research/watch/watch.repository.ts` | V115/V124's tables, and the read-only looks at Planning, the run plane and the PR mirror |
| `research/watch/watch.resources.ts` | The card's rows — `detail` and `pill` derived from the item's state — and the settings |
| `research/watch/watch.fixture.ts` | The hover-drift baseline and item, an in-memory store, a scripted telemetry tool |

**Every move names the status it leaves** (`where status = …`), so two passes, or a pass and a
person's dismissal, cannot both move an item; V115's transition trigger holds the edges.

**Honest stops.** A metric with no replay test, a bisect that cannot start for a reason that
will not change, and a bisect that ends without a culprit each leave the item at `detected` with
a `needs repro` note. A transient failure (engine down, clone unreachable) is retried next pass.

**Filing is the opt-in.** The fix is always drafted; `BatchesService.push` and the queue write
are reached only when `regression_watch_settings.auto_file` is true. A change to `auto_bisect`
or `auto_file` writes the audit event `regression_watch.policy_updated` (webhook registry v8).

**A fix that "is not running" is demoted only when a run was recorded.** `fix_running` goes back
to `fix_drafted` when the ticket has a run and none is in flight; an item whose run this
deployment never saw (the dev seed's) is left as it is.

**One inbox event per stage.** `regression_drift_detected` and `bisect_complete` (declared by
V124) are keyed `research.watch` / `item:<id>:detected|bisected`; a card settles itself
(`watch_moved_on`) once the item has passed that stage, and **Dismiss drift** is bound to
`research.dismiss_watch_item`.

The pass runs every `OURO_RESEARCH_REGRESSION_TICK_MS` (default five minutes; `0` off).

## Gaps hand-off & roadmap pipeline

The two paths from a brief to work ([#624](https://github.com/NobuData/ouroboros/issues/624),
decisions V7 and V8). `research/pipeline/` composes Briefs, the skills registry, Planning and the
ticket sources through their own services — it adds no second push path and no second estimator.

```
POST /api/v1/research/investigations/:id/draft-epic
  brief.proposed (HIGH/MED rows' stubs) ─▶ EpicsService.create (proposed)
        ─▶ BatchesService.compose (planner research-gaps-v1, epic, one draft per stub,
                                   research_provenance {gap, sources}) ─▶ /planning?batch=…
        nothing is filed · a second call answers the same batch

POST …/roadmap            brief export ─create-roadmap─▶ roadmap_doc_versions v1 ─▶ project
POST …/roadmap/suggestions                    doc_suggestions (user) · raise() for the product's (ai)
POST …/suggestions/:id/apply   re-run create-roadmap {previous, suggestions…} ─▶ vN+1,
                               suggestion applied@vN+1 in the same transaction ─▶ project
POST …/suggestions/:id/dismiss status dismissed · audit roadmap.suggestion_dismissed
POST …/roadmap/issues     create-issues ─▶ compose (planner create-roadmap-v1, one batch per doc,
                            per-draft milestone + due date, label mvp) ─▶ [sizer] ─▶ push/resume
                            ─▶ writeback: newly filed items' ticket ids, MVP, done ─▶ vN+1 ─▶ project
                            stage: sizing | partial | filed
POST …/roadmap/drift-check settle projection ─▶ compare with the tracker mirror and the repo file
                            difference ─▶ committed → drift_detected + ONE suggestion (drift-detector)
project:  commit to ouroboros/roadmap-<id> ─▶ open or update the PR (draft under dry-run)
          direct_commit && !dry-run ─▶ commit to the default branch
          pending → pr_open → committed → drift_detected   (V113 holds the edges)
```

| File | What it holds |
| --- | --- |
| `research/pipeline/gap-handoff.service.ts` | `draftEpic()`; a gap draft's body and provenance |
| `research/pipeline/roadmap.service.ts` | Generate, the card, suggestions, apply (the re-run), dismiss, the policy |
| `research/pipeline/roadmap.issues.service.ts` | `file()` — draft, wait for the sizer, push, write back; re-entrant |
| `research/pipeline/roadmap.drift.service.ts` | `check()` and the scheduler's `pass()` |
| `research/pipeline/roadmap.projector.ts` | A version's life in the repository: PR, direct commit, following a PR, recording a drift |
| `research/pipeline/roadmap.structure.ts` | V113's structure: merge a skill's answer by item key, write back, refresh done states, render `ROADMAP.md` |
| `research/pipeline/roadmap.drift.ts` | Document versus tracker: the differences and the suggestion that names them |
| `research/pipeline/pipeline.skills.ts` | The shipped `create-roadmap` and `create-issues` bodies |
| `research/pipeline/pipeline.skill-registry.ts` | The workspace's current published version of a skill; ships it on first use (`origin: generated`) |
| `research/pipeline/pipeline.skill-runner.ts` | One run: skill version + the `research` route's alias → `EngineClient.runSkill` |
| `research/pipeline/pipeline.repo.ts` | The repository gateway over the provider SPI's repository-document family |
| `research/pipeline/pipeline.repository.ts` | V113/V125's tables and the looks at investigations, the tracker mirror and estimates |
| `research/pipeline/pipeline.fixture.ts`, `pipeline.bench.fixture.ts` | An in-memory store, a repository of branches, a scripted skill runner, a Planning that drafts and pushes — and the real services over them |

**Applying is a re-run, never a patch.** `create-roadmap` answers the whole roadmap again; this
service merges the answer over the version before it **by item key**, so a surviving item keeps
its draft and its issue. The skill owns what the roadmap says; the draft, the ticket and whether
it is closed are this service's, refreshed from the tracker on every re-run.

**The skills are the workspace's.** `PipelineSkillRegistry` reads the current published version
from the Knowledge registry, so publishing a version changes what runs. A workspace with none
gets the shipped body in one transaction; one whose copy was never published is refused
(`roadmap_skill_unpublished`). The engine appends the output's shape to whatever body runs
(`POST /v0/skills/run`), so an edit cannot change what is stored. Until the invocation gateway
exists (AF.2, #235) a live run answers `502 roadmap_skill_failed` with `gateway_unavailable`.

**The repository is reviewed, not written to.** Direct commit is
`roadmap_pipeline_settings.direct_commit` (V125, default false, `GET/PUT
/api/v1/research/roadmap-settings`, audited as `roadmap.policy_updated`), and is ignored under
dry-run. A version is stored **before** anything is projected: an unreachable repository leaves
it `pending` with `projection.problem`, and the drift check retries.

**The provider SPI gained a repository-document family** (`ticket-source.repo-doc.ts`,
`providers/github.repo-doc.ts`): `defaultBranch`, `fileAt`, `commitFile` (idempotent by content;
creates the branch) and `updatePR`, guarded by `supportsRepoDocs`. And push learned two things a
roadmap needs: a draft's own milestone with a due date (`ensureMilestone(context, name, dueOn)`
— sent only when the milestone is created) and its labels, which `recordPushed` now also writes
to the mirrored ticket.

**Create-issues is idempotent because it is re-entrant.** One batch per document
(`roadmap_docs.batch_id`), AL.3's per-draft key, and a writeback that writes no version when
nothing changed. The writeback touches only items that were not filed before; a later tracker
change is the drift check's to report — never absorbed silently.

**The drift check raises once.** While a `drift-detector` suggestion is open on a document no
other is added. It writes no version and edits no file. It runs every
`OURO_RESEARCH_ROADMAP_TICK_MS` (default fifteen minutes; `0` off) over documents with a target
source that are not already `drift_detected`.

Not here: the pipeline card (#631) and the brief card's button (#630); editing issues that are
already filed (push is create-only, so a re-run after filing changes the document and the drift
check says so); filing items that join the roadmap after its batch was composed (`undrafted`).

## Replay estimates

`POST /internal/dry-runs/{id}/replay-estimates` is mockup 20's replayed row —
`✓ build (replayed from history) est. 4m 02s (214 similar builds, ±20s)` — computed
([#561](https://github.com/NobuData/ouroboros/issues/561), decision **W4**). A dry run dispatches
nothing to the farm; its harness's `build` and `run_tests` tools (CD.2, #560) are replay stubs
that ask here instead.

```
never:  a model asked "how long will this build take?"
always: arithmetic over builds this farm actually ran, with the sample attached

dry run ─▶ its workspace, its ticket's repository
stage   ─▶ similarity class ─▶ sample in the window ─▶ n ≥ floor?
                                  median · MAD · n        ├─ yes ─▶ estimate {4m 02s, ±20s, n=214, 30 d}
                                                          └─ no  ─▶ insufficient_history {found: 7}
```

**The arithmetic is the database's.** `ouroboros-db`'s `V121` owns the similarity class
(`build_similarity_class()`, `test_similarity_class()`), the statistics (`build_replay_sample()`,
`test_replay_sample()`), the policy (`replay_estimate_policy()`: 30 days, floor 20) and the words
(`replay_estimate_note()`), because the dev seed's replayed row must be the same computation.
`src/modules/replay-estimates/replay.repository.ts` calls those functions and re-derives nothing —
`replay.repository.spec.ts` fails a statement that reaches for `percentile` or `build_jobs`.

| Rule | Where it is enforced |
| --- | --- |
| **Similar is defined.** A build matches on workspace, repository, pool, executor and *configuration class* — the image without its tag or digest, plus the whitespace-collapsed command. An SDK bump keeps its history; a changed command starts a new one. The executor and image are the pool's as configured now; a stage without a command takes the pool's default | `build_config_class()` (V121); `ouroboros-db/tests/constraints.sql` |
| **An estimate travels with its basis.** Median, spread, sample count and window are one answer | `assertCompleteEstimate()` in `replay.estimate.ts`, run on every result before it leaves; `ReplayEstimate` in `openapi.internal.yaml` requires all four |
| **The ± is the median absolute deviation** — the median distance from the median — which one stuck build cannot move | `build_replay_sample()`; `REPLAY_DISPERSION` |
| **Below the floor there is no number.** `insufficient_history` carries the count found, and its shape has no field a number could sit in | `composeEstimate()`; the contract's second `oneOf` branch |
| **Tests rest on test history.** A test stage is keyed by *suite set* — a run's distinct suite names — over `test_runs.wall_ms`; no suite set named means the one the repository last measured. Runs driven by a simulator are not history | `test_replay_sample()`; `ReplayEstimateService.estimateTest()` never calls the build sample |
| **Cache context is context.** The warm (ccache hit rate ≥ ½) and cold builds of the sample are counted and medianed apart and returned as `cache`, beside an `estimateMs` they never move | `cacheContext()`; kept off the stage row |
| **The formula is registered.** Each estimator declares its computation in the metrics registry's shape (id, version, title, formula, source planes, caveats) and every answer carries it with the real inputs, for the Details popover (#568). A change to the computation raises the version | `replay.formulas.ts` |
| **The workspace and repository are the dry run's.** The repository is the one its ticket names (`meta.github.owner` / `repo`), matched inside the workspace's own mirror; neither is accepted in the body | `ReplayEstimateRepository.context()`; `ReplayEstimateDto` |

The answer also carries `stage` — the same result as the `dry_run_stages` row that records it
(`how: replayed`, `note`, `metrics`), in the two shapes V121's `dry_run_stage_metrics_valid()`
accepts. This module writes nothing: recording the row is dry-run orchestration's (CD.4, #562),
which can also call the exported `ReplayEstimateService` directly.

What it refuses is a request with no class to sample — `dry_run_not_found` (404),
`replay_repository_unresolved`, `replay_pool_required`, `replay_pool_not_found`,
`replay_command_required` (422). Too little history is never one of them: it is an answer.

| File | What it holds |
| --- | --- |
| `replay.formulas.ts` | The registered formulas, by kind |
| `replay.estimate.ts` | Pure: the floor decision, the note, cache context, the completeness probe, the stage record |
| `replay.repository.ts` | The dry run's context, and the calls into V121's functions |
| `replay.service.ts` | `estimate()` for the route; `estimateBuild()` / `estimateTest()` for callers inside REST |
| `replay.internal.controller.ts` | The engine-facing route |
| `replay.integration-spec.ts` | The mockup's figure reproduced from a farm history whose answer is known by inspection; the floor; suite sets; isolation |

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

**Sizing an issue is the second thing the client can ask for, and it has no route yet.**
`EngineClient.estimate()` calls `POST /v0/estimate`
([#105](https://github.com/NobuData/ouroboros/issues/105)) with the issue and *the
vocabularies this installation has* — the workflow tags and the model defaults that exist —
because the engine holds neither and must not invent one (roadmap decisions **K5**, **K6**).
What comes back is one version of an `issue_estimates` row, so the orchestration that
persists it ([#107](https://github.com/NobuData/ouroboros/issues/107)) writes an answer
rather than translating one. There is deliberately no controller beside `engine/status` for
it: the callers are the sync pipeline and the re-estimation endpoints
([#108](https://github.com/NobuData/ouroboros/issues/108)), which reach it through the
orchestrator rather than around it, and a route beside `engine/status` would be a generic
proxy under another name.

Two things about that call are worth knowing before writing against it. **What answers it
changes and the shape does not** — today the engine's estimator is the deterministic rule
engine `heuristic-v0` ([#106](https://github.com/NobuData/ouroboros/issues/106)), which
returns an empty `breakdown.files` and `trace.tokensUsed: 0` because it knows no files and
invokes nothing; an LLM estimator
([#123](https://github.com/NobuData/ouroboros/issues/123)) answers the same shape later — so
a caller reads `trace.estimator` and `confidence` and never branches on which engine build
answered. And
**a `202` is a `502` here, for now**: the engine specifies a `202`-plus-poll escalation for
the slower estimator and cannot yet send one, so this client refuses a response it does not
know how to follow rather than guessing. The poll arrives with the estimator that needs it.

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

Everything above is the browser's boundary. This is the other one: the paths
`ouroboros-engine` calls, reachable from no browser at all
([#224](https://github.com/NobuData/ouroboros/issues/224), roadmap decision **P3**, extended
by [#303](https://github.com/NobuData/ouroboros/issues/303)).

```
POST /internal/llm/invoke          the control plane makes the call — keys never cross
POST /internal/credentials/lease   local providers only — an address, TTL'd and audited

POST /internal/runs                        open a run, pinned to one workflow version
POST /internal/runs/:id/stage-transitions  move one stage attempt, validated
POST /internal/runs/:id/events             append to the transcript
PUT  /internal/runs/:id/files              report the change-set, trigger the guardrails
POST /internal/runs/:id/commits            append commits
POST /internal/runs/:id/resources          attribute spend; hold or release a build job
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
*it* calls the engine — or, where a deployment configures one, `OURO_RUN_SIMULATOR_SECRET`,
which admits the same routes and marks the runs it opens as simulated. The comparison is constant time over digests, a missing header takes
the same path as a wrong one, and the rejection is one constant body. A session cookie is not
accepted here, whoever it belongs to: `guard.surface.spec.ts` enumerates all three categories
of route — *needs a session*, *needs nothing*, *needs the key* — and asserts each one in both
directions.

### The run ingestion contract

The six routes under `/internal/runs` are AP.1
([#303](https://github.com/NobuData/ouroboros/issues/303)), decision **R2**: **one** contract
every executor reports through — the simulated driver (AP.5) today, real execution (AR.1)
tomorrow. It exists before either because the Run Console has to ship before real execution
does, and the alternative — building the page against fixtures and adding ingestion later —
produces a mockup with a database behind it and discovers at integration time that the
contract the page assumed is not one an executor can produce. There is exactly one of these
deliberately: DASH-J.3 ([#91](https://github.com/NobuData/ouroboros/issues/91)) defined a
second bridge and left it unbuilt, and its scope is delivered here, because two writers would
fork the read-model.

**Every write is idempotency-keyed, and a replay returns the original result** — not an error.
An executor retries because it did not hear the answer; telling it *"you already sent that"*
without telling it **what it was told** leaves it exactly where it was. `run_ingest_receipts`
(`V049`) records the operation, the key, a **digest of the body** and the answer. The digest
is what makes storing a response safe: a key reused with a *different* body is refused with
`idempotency_key_reused`, because answering it with the first body's result would tell a caller
its report landed when it had not. A receipt rather than a natural key, because four of the six
operations have none a caller could supply — `ingest.repository.ts`'s header has the argument.

**The server owns the ordering.** Transcript entries carry the executor's own monotonic `hint`;
the server assigns the dense `run_events.seq` and **refuses** a batch that does not continue
the accepted order rather than silently reordering it. Reordering would mean renumbering a
sequence the console pages by — a transcript that changes under a reader's cursor — and
appending anyway would produce one whose order and whose clock disagree. Neither is
recoverable; a `409` carrying both numbers is, because the executor still holds the batch. The
run's row is locked for each write, which is also the lock the store's own append takes.

**Nothing on this surface can claim a workspace or a watermark.** A run is opened for a
canonical ticket (V030) and the workspace is read off that row; every later report resolves it
from the run. `simulated` is decision **R4**'s watermark and follows the *principal* — which on
this channel is the secret the caller presented, so `OURO_RUN_SIMULATOR_SECRET` is a second
accepted value of `X-Ouro-Internal-Key` and there is no body field in which the flag could be
claimed or cleared. The variable is optional; unset is a deployment that runs no simulator, and
`configuration.ts` refuses one that sets it equal to `OURO_ENGINE_SHARED_SECRET`, because two
principals presenting one proof are one principal.

**A stage transition composes no sentence.** V045 makes `run_stages.note` a generated column
over the attempt and the recorded transition, so *"attempt 1 failed tests — loop returned from
gate ↺"* is the database's; the request carries the transition and no `note` field exists to
send. The move itself is validated against the R1 state machine (`ingest.transitions.ts`) and
the pinned document's attempt limits, and every refusal is a code with the values that locate
it — `stage_transition_invalid` carries the stage, the attempt, where the row stands and where
the request tried to take it, which is the whole of what an executor needs to tell *"I lost a
response"* from *"I have a bug"*.

**A change-set report triggers guardrail evaluation**, carrying its own `change_set_seq` so
re-evaluation reads as a sequence rather than a pile — and a report naming **no** files
triggers none, because there is no change-set to judge. The four verdicts are answered by
AP.3's `GuardrailService` — see [Guardrail evaluation](#guardrail-evaluation) below.

**What it deliberately does not do is move `runs.status`.** None of the six operations carries
one. What closes a run is a terminal node's action (WF-T.6) or an acknowledged abort
([Run controls](#run-controls), AP.4), and inferring
it from stage rows would be this service guessing at a workflow's semantics — wrong for every
document whose last node is `needs_review`.

**These paths are outside `/api` and unversioned**, for the reason the health probes are: the
prefix is the browser's boundary — CORS-configured, session-authenticated, and published in
the document `ouroboros-ui` generates a client from — and the only caller of these two is
deployed alongside this service and upgraded with it.

### Guardrail evaluation

AP.3 ([#305](https://github.com/NobuData/ouroboros/issues/305)), decision **R5**, in
[`src/modules/guardrails/`](src/modules/guardrails). Every change-set report is judged, inside
the report's own transaction, by four checks against the run's pinned policy:

| check             | judged against                                                                 | `not_applicable` when                         |
| ----------------- | ------------------------------------------------------------------------------ | --------------------------------------------- |
| `allowed_paths`   | the repository's protected paths (`protected_path_policies`, V067 / [#380](https://github.com/NobuData/ouroboros/issues/380)) first — a touched protected path fails even inside the plan — then the plan's declared files (`issue_estimates.breakdown.files`) widened to their directories — `drivers/can/a.c` admits `drivers/can/**` — plus the CI registry when the stage may touch CI | the run's issue has no plan and the repository protects no path |
| `ci_config`       | a versioned CI-file registry (`ci-v1`) × the pinned model stage's `touch_ci`   | the pin has no model stage with permissions   |
| `secrets`         | the embedded ruleset `v3` (option 3-A) over the report's **added** hunk lines  | no file in the report carried `hunks`         |
| `review_required` | the pin's terminal (`open_pr_automerge`?) × enabled `add_vote` escalation rules matching the ticket | review is not required — auto-merge eligible |

`review_required` is `pass` when the terminal routes the run to a person, and `fail` when a vote
rule requires review but the terminal would auto-merge (or the pin cannot be read).

**Evidence is a place and a rule, never a value.** A finding records `{path, line, rule_id}`;
the hunks that carried it are scanned in memory and stored nowhere, and every evidence string is
screened against V048's constraints before it is written — a path that would break them is
withheld rather than refused, so a verdict can never fail the report it rides in.

**Evaluation, not enforcement.** A `fail` is returned to the executor as `guardrailFailures` and
`needsHuman: true` on the change-set answer; nothing moves `runs.status` or stops a stage. That
is AR.1 ([#315](https://github.com/NobuData/ouroboros/issues/315)). Re-evaluation appends, and
`v_run_guardrails_latest` supersedes.

**The recall limit is stated, not implied.** A format ruleset recognises roughly 70 % of
real-world secrets; high-entropy values with no recognisable shape are not detected.
`SECRETS_RULESET_DISCLOSURE` (and `GuardrailService.disclosure()`) carries that sentence for the
Guardrails card's tooltip (#313). Bump `SECRETS_RULESET_VERSION` / `CI_REGISTRY_VERSION` with
every edit to the ruleset or the registry — each verdict records the version it was judged
under.

### Run controls

AP.4 ([#306](https://github.com/NobuData/ouroboros/issues/306)), decision **R6**, in
[`src/modules/controls/`](src/modules/controls). Mockup 10's *Pause loop*, *Abort run* and the
steering box are rows on V048's durable `run_controls` queue, not calls to the executor,
because the moment somebody needs *Abort* is the moment the executor is busy or wedged.

```
POST /api/v1/runs/:id/controls                    a person asks        → pending | rejected
GET  /api/v1/runs/:id/controls                    the ack chips (newest 50)
POST /internal/runs/:id/controls/fetch            the executor claims  → delivered
POST /internal/runs/:id/controls/:controlId/ack   the executor answers → acked
     (sweep: every OURO_RUN_CONTROL_SWEEP_SECONDS) nobody answered     → expired
```

| kind     | who may send it          | what the executor does                                                      | TTL                             |
| -------- | ------------------------ | --------------------------------------------------------------------------- | ------------------------------- |
| `steer`  | `owner`, `admin`, `member` | appends the text to the **current attempt's** context and **does not pause**; acks with the attempt (*"steering applied to attempt 2"*) | `OURO_RUN_STEER_TTL_SECONDS`    |
| `pause`  | `owner`, `admin`         | stops at the next safe boundary, never mid-write                            | `OURO_RUN_CONTROL_TTL_SECONDS`  |
| `resume` | `owner`, `admin`         | continues a paused loop                                                     | `OURO_RUN_CONTROL_TTL_SECONDS`  |
| `abort`  | `owner`, `admin`         | terminates the run and **preserves its branch**; the ack closes the run as `canceled` (V050) | `OURO_RUN_CONTROL_TTL_SECONDS`  |

**The server decides, whatever the console showed.** The role is checked before the run is
read, so a member's abort is a `403 forbidden` that writes nothing, even with a correct
confirmation. An abort's `confirmation` must be the run's loop number, and it is re-checked
against `runs.loop_seq`.

**Nothing silently disappears.** A control against a run that has already finished is written
as `rejected` with a reason the console displays. A control nobody acknowledges before its
`expiresAt` becomes `expired`, which is a different state. A second `pause` or `abort` while one
is outstanding answers with that one, and a retry under the same `idempotencyKey` answers with
the control the key named. The listing, the fetch and the ack each sweep their own run first,
so none of them reports a control that has already elapsed.

**A steer is mirrored into the transcript** as a `user` entry on the active stage attempt, with
`{controlId, requestedBy}` in its payload. `remember: true` is the #412 amendment's *remember
this* flag: stored (V050) for the knowledge pipeline, never applied differently by an executor.

**A correction round is a steer with `retryStage: true`** (V061, #332). The Mark & Route card
queues it through `ControlsService.correctionRound` — the one in-process writer, held to the same
role policy — and the executor appends the note to the planning context and starts the current
stage's next attempt, acking with that attempt. The public route never sets the flag.

**The audit is the database's.** V048's `run_controls_audit()` trigger writes a
`run_control.requested | delivered | acked | expired | rejected` event for every write, and the
body is `{run_id, kind, state, has_payload}`, so the steer text has nowhere to go.

### Run console reads

AP.2 ([#304](https://github.com/NobuData/ouroboros/issues/304)), in
[`src/modules/runs/`](src/modules/runs) (`console.*.ts`). Mockup 10 needs three reads, each on
its own cadence. Every member of the workspace may make all three. Each starts from the same
org-scoped `find`, so another workspace's run is `404 run_not_found` on every route.

```
GET /api/v1/runs/:id                    snapshot   {asOf, run, head, timeline, changes, resources, guardrails}
GET /api/v1/runs/:id/events?after=&limit= tail     {entries, nextAfter, latestSeq, hasMore, live, elided, pollAfter}
GET /api/v1/runs/:id/transcript.jsonl   export     "# simulated run" + one run_events_jsonl line per entry
```

**The page states every figure.** Stage durations, the change-set totals, the token and cost
sums, the wall clock (`elapsedSeconds` measured to `asOf`) and the Guardrails pill are all
computed here, so the browser only formats. Resources follow decision **R8**:

| Row    | Numerator                     | Denominator                                                                                       |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| Tokens | `sum(token_usage)` of the run | `token_budget` of the model stage that started most recently                                      |
| Cost   | `sum(token_usage.cost_cents)` | the cap on the route that stage inherits (`routing.inherit_task` → task kind → `routes`); a pinned-model stage has no cap |
| Farm   | `runs.reserved_build_job_id`  | the job's runner; **omitted** when there is no reservation                                        |

**Unpriced is not free.** When nothing attributed to the run is priced, `costCents` is `null`
beside the token count, never `"0"`. `unpricedEvents` counts the rows with no price. The ledger
sum is `run.spend.ts`, the same statement AP.1's resources receipt uses.

**The tail is exact under concurrent ingest.** It reads `runs.event_seq` first and pages
`after < seq ≤ event_seq`. V046 allocates `seq` under the run lock and moves `event_seq` in the
same transaction, so a page never sees an entry whose predecessor is still being written.
`live` is the run's status (`coding`, `building` or `review`), never how recently an entry
arrived. `pollAfter` is 5 s while the run is live and `OURO_DASHBOARD_POLL_SECONDS` after that.
A cursor past the end is `422 run_events_cursor_out_of_range` with `details.latestSeq`.

**The export is the view's bytes.** Lines come from `ouroboros.run_events_jsonl`, 500 per
statement, bounded by `event_seq` at request time, and are never re-serialized. The export
adds only the watermark line. It is served as `application/x-ndjson`,
`inline; filename="loop-<loopSeq>.jsonl"`, and chunked.

### Console suites & mutation checks

AP.6 ([#308](https://github.com/NobuData/ouroboros/issues/308)) holds the console's
correctness core under `yarn test:integration`, beside AP.1–AP.4's own suites:

| Suite | Holds |
| ----- | ----- |
| `ingest/ingest.integration-spec.ts` | dense ordered `seq` under interleaving, replay of every write, the cap's elision marker, refused transitions and `max_attempts`, `simulated` follows the principal |
| `guardrails/guardrails.integration-spec.ts` | every rule-matrix cell `standard-fix` can reach, end to end; four credential formats reported three times and stored nowhere (rows, receipts, audit, logs); the ≤ 50 ms budget from the service's own timing line |
| `controls/controls.integration-spec.ts` | deliver / ack / expire / reject, duplicate suppression, the role matrix with a forged abort confirmation, steer mirrored into the transcript, audit rows without steer text |
| `runs/console.integration-spec.ts` | offset resume under concurrent ingest, export byte parity with AO.2's fixture, unpriced resource math, `live` false on terminal runs |
| `runs/console.mockup.integration-spec.ts` | the seeded `#482` against values **parsed out of `docs/mockups/10-run-detail.html`** at test time, so a drift from the design source fails |
| `runs/console.isolation.integration-spec.ts` | every route under `/api/v1/runs` and `/internal/runs`, checked against the route table the app registers — public routes `404` another org's run; internal routes `404` another org's repository, build job or control |
| `runs/console.mutation.integration-spec.ts` | one named test per mechanism below |

**Mutation checks.** Each mechanism has one test named for it, and removing the mechanism turns
that test — and only that test — red:

| Remove | Red test |
| ------ | -------- |
| idempotency (`IngestService.replayed()` and the receipt `commitReceipt()` records) | `idempotency: a replayed write stores nothing twice and answers the first answer` |
| the transition validator (`canTransition()` answering `true`) | `transition validator: pending → succeeded and every other illegal move is refused, and the stage does not move` |
| the evidence constraint (V048's `guardrail_evaluations_evidence_*` CHECKs) | `evidence constraint: a credential written straight into evidence is refused by the database` |

```bash
yarn test:integration src/modules/runs/console.mutation.integration-spec.ts
```

**One mockup disagreement is pinned, not hidden.** Run `#482` is drawn by mockup 01
(`Implementing · 4/6`, which the shared dev seed follows) and by mockup 10 (`Implement` … `Open
PR`). The parity suite asserts both label lists exactly, so the stepper after the active node is
the one reviewed difference and any further drift still fails.

### Classification & routing

AT.4 ([#332](https://github.com/NobuData/ouroboros/issues/332)), decisions **T6**/**T7**, option
**5-A**, in [`src/modules/triage/`](src/modules/triage). The test-results page's Mark & Route
card: honest hints, a recorded decision, and routes that compose over the control queue and the
farm rather than beside them.

```
GET  /api/v1/test-runs/:id/hints                    every failing case's rule verdicts   (any member)
GET  /api/v1/test-runs/:id/classifications          current decisions + routing receipts (any member)
POST /api/v1/test-runs/:id/cases/:caseId/classify   record, then route                   (member+)
GET  /api/v1/test-runs/:id/rerun                    could a re-run be placed now + counts (any member)
POST /api/v1/test-runs/:id/rerun   {scope}          failed set | full suite, as a new build (member+)
POST /api/v1/test-runs/:id/waivers {reason}         the waiver; no PR annotation (AV.2)   (admin+)
PUT  /api/v1/runs/:id/pr-intents                    the card's two PR toggles, on their own (member+)
```

| class | route | dispatches | receipt |
| ----- | ----- | ---------- | ------- |
| `product_bug`, `test_update` | correction round | a steer with `retryStage` carrying the note | `control_id`, `target_attempt` |
| `flake_retry` | flake | a `test_case_history` mark + a re-run of the case | `rerun_job_id` |
| `infra_rig` | infra | the runner's `health_note` (+ a full re-run with `toggles.requeue`) | `rerun_job_id` when requeued |

**Hints are rules, never a confidence.** `flake.pass_on_retry`, `infra.rig_error` and
`product.new_failure_in_diff`, evaluated in that order; every hint is `confidence: null`,
`actor: heuristic`, and is also answered in `/v0/triage`'s response shape
(`schemas/triage/v0.json`), the contract AV.1 (#343) implements with a model.
`triage.contract.spec.ts` pins every field of that schema, so a shape change is red here.

**Re-runs answer an honest queue state.** `FarmJobsService.submitRerun` copies the attempt's
build snapshot onto a new job with `build_jobs.test_selection` (V061) and answers `offered`,
`queued_runner_available` or `queued_no_eligible_runner` — never *started*.

**Recorded first, routed second, and what could not be routed is said.** `routing.skipped`
explains a missing runner, a missing farm build or a disabled pool beside a classification that
was still made. Audited as `triage.classified`, `triage.rerun_requested`, `triage.waived` and
`runner.flagged`, with the person as the actor; the note never enters the trail.

**A toggle is stored when it is flipped** (AU.6, [#340](https://github.com/NobuData/ouroboros/issues/340),
REST 0.37.21). Until the card was built the run's PR intents were written only as part of a
classification; `PUT /api/v1/runs/:id/pr-intents` sets *Block PR until green*, *Auto re-run
physical suite after fix* or both on their own, changing only what it is sent
(`422 pr_intents_empty` for neither). It answers with both as stored, and they are read back on
the timeline's `next.intents`. Audited as `triage.intents_set`, naming the toggles it set.

### Flake scorer

AT.3 ([#331](https://github.com/NobuData/ouroboros/issues/331)), option **4-A**, decision **T5**,
in [`src/modules/flakes/`](src/modules/flakes). Retry truth plus history — no model, no
fingerprint clustering.

```
parse (#329) ─▶ one test_case_history occurrence per case ─▶ score what the attempt touched ─▶ healthy ⇄ watching
nightly      ─▶ per workspace: bookkeeping row ─▶ re-score ≤ OURO_FLAKE_RESCORE_CAP active cases ─▶ candidates[]

GET /api/v1/flakes/summary            watching / quarantined counts, candidates, last nightly pass (any member)
GET /api/v1/flakes/cases/:caseKey     one case's score, state and pass-on-retry count              (any member)
```

**The occurrence is the parse's.** In the same transaction as the tree, every case of the attempt
gets one `test_case_history` row (V054); `pass_on_retry` is derived from the case's status, and a
case is `flaky` only when the pinned `flakes:` policy sanctioned its retry — so a sanctioned pass
on retry is exactly one flagged occurrence and an unsanctioned retry (a `failed` case) is none. A
re-parse rewrites an occurrence whose case changed (V063), so `test_case_history_drift` stays empty.

**The formula is the database's.** Flake score v1 — the latest 20 non-skipped occurrences newest
first, weight `0.9^i`, signal 1 for a pass on retry, `score = round(Σ w·f / Σ w, 4)`; `watching` at
≥ 0.25, `healthy` below 0.10, unchanged between or under 3 observations — is V054's
`flake_score()` and `flake_state_next()`, which every write calls. Each score row is stamped with
the latest `formula_version`; a re-tuning is a new formula row, and the nightly pass restamps
every score of an older version. Mockup 11's telemetry case scores `0.5028` over four
occurrences and lands `watching`.

**The nightly pass is bounded, jittered and observable.** `FlakeRescoreScheduler` books
`OURO_FLAKE_RESCORE_HOUR_UTC` (03:00) plus a random minute in the hour after. Each workspace with
an active case — not `healthy`, not zero, or of an older formula — gets a `flake_scorer_runs` row
opened before the work and closed with cases scored, state changes and duration, or with the error;
at most `OURO_FLAKE_RESCORE_CAP` cases per workspace, least recently scored first. A case that
stopped flaking returns to `healthy` here once clean builds push its flakes down the window. The
pass is idempotent, so every replica may run it.

**No code path writes `quarantined`.** The written state is always `flake_state_next()`'s, which
keeps a quarantined case quarantined and moves nothing else there; activation is AV.3's (#345).
`flakes.quarantine.spec.ts` holds that by source scan and compiled SQL, and
`flakes.integration-spec.ts` by behaviour.

### Test Results reads & artifact serving

AT.5 ([#333](https://github.com/NobuData/ouroboros/issues/333)), decision **T8**, in
[`src/modules/test-results-read/`](src/modules/test-results-read). Mockup 11's shaped reads, the
artifact download and the retention sweep. **The page renders what it is told**: every figure it
prints is a field here, computed once, so no client re-derives it.

```
GET /api/v1/runs/:id/test-runs                   attempts oldest first, each with its strip; T8's next step (any member)
GET /api/v1/test-runs/:id                        suites · cases · HIL · classifications · artifacts · coverage · warnings
GET /api/v1/test-runs/:id/cases/:caseId/failure  message · log excerpt · path — 404 for a case that did not fail
GET /api/v1/artifacts/:id                        the file, streamed through the store — 410 once expired
hourly sweep                                     stored before the artifacts cutoff ─▶ delete bytes ─▶ expired_at (a tombstone)
```

**The strip.** `total`, `suiteCount` (*across 5 suites*), `passed`, `failed` and `flaky` with the
cases their captions name (`passedOnRetry`/`attempts` for *retry 2/3*, the flake state), and the
`wallTime` split (*6m 12s · 4m sim · 2m 12s physical*). **`passedDelta` is measured since the count
last moved** — against the most recent earlier attempt that reported cases and passed a different
number — and names that attempt. Mockup 11's Build 3 re-ran Build 2's failed set and carried its 61
passes forward, so it reads `▲ 12` against **Build 1** (`versusAttemptSeq: 1`): the number the
mockup prints, with the label the data supports (#328's decision 2). Build 4 reads `▲ 2` against
Build 3.

**When a report last arrived.** Each attempt carries `lastReceivedAt` — `test_runs.updated_at`,
which every results write moves — beside `startedAt`. A running attempt whose `lastReceivedAt` has
stopped moving has stopped receiving uploads, which is what the page's ingest-lag banner names
([#342](https://github.com/NobuData/ouroboros/issues/342)).

**The next step (T8).** `activation` is `gate_armed` when the run's PR carries a required
`test_suite` gate — which the gate engine (#358) evaluates on every revision, so *gated on 63/63*
is true — `intent_stored` when *Block PR until green* is on and nothing holds the PR yet, and
`none` otherwise. The intents, the PR and the gate's provenance ride along.

**Artifacts.** Each is its name, kind, size, checksum, `retentionDays` (from the row — *retained
30d*), `preview` and an `href` — **never its storage reference, key or driver**. The download streams
through `ArtifactStore.open`, so the local→S3 swap is invisible to a caller. A `junit`, `hil`,
`coverage` or `log` artifact whose name is a text type is `inline`; a `capture` (the 2.1 MB rig CSV)
or `other` is an `attachment`; an unknown type is `application/octet-stream`, never HTML. Every
answer carries `nosniff`, `Content-Security-Policy: sandbox` and `private, no-cache`.

**Retention leaves tombstones.** `ArtifactRetentionSweeper` runs hourly (jittered): live rows
stored (`created_at`) before their workspace's `artifacts` cutoff, stored through this process's
driver, oldest first, at most 200 a tick — the
bytes are deleted through the store **first**, then `expired_at` is set, and name, kind and size
stay. The page lists the row as `state: expired` with no `href`, and the download answers `410
artifact_expired`. The cutoff is `RetentionPolicyService`'s `artifacts` tier as it stands at the
sweep ([data retention](#data-retention)) — `OURO_ARTIFACT_RETENTION_DAYS` (30) for a workspace that
set none — so a changed tier moves the next sweep. `retained_until` is still written at upload, from
the tier then, as the card's `retained 30d`. Each tick that removed something logs its tombstone
counts.

Coverage's `delta` is **absent**, not zero, with no earlier attempt that has coverage; the parser's
`parseWarnings` (#329) are on the page payload for the banner. Everything is scoped to the session's
workspace, and another workspace's run, attempt, case or artifact is a `404`.

### Test-plane suites & mutation checks

AT.6 ([#334](https://github.com/NobuData/ouroboros/issues/334)) certifies the test plane — parse →
score → classify → route, and the upload — under `yarn test:integration`, beside AT.1–AT.5's own
suites:

| Suite | Holds |
| ----- | ----- |
| `test-results/test-results.integration-spec.ts` | the parser matrix as trees V051/V053 accept; idempotent re-parse; `case_key` stability; typed warnings for malformed input (AT.1) |
| `farm/artifacts/upload.integration-spec.ts` | token scope and single use, cross-job replay refused, quota warning, truncation manifests, checksum refusal — declared twice, local volume and MinIO, unchanged (AT.2) |
| `flakes/flakes.integration-spec.ts` | sanctioned vs unsanctioned retries, formula 1's window boundaries (three observations, the band between thresholds, twenty runs) crossed both ways, `formula_version` stamping, the nightly cap (AT.3) |
| `triage/triage.integration-spec.ts` | hints with `confidence: null`, the correction round's steer and attempt increment, dispatch carrying only the failed set, the infra flag, audit rows (AT.4); `triage.rules.spec.ts` replays the hint matrix, every rule firing and not |
| `test-results-read/artifact.retention.integration-spec.ts` | the sweep removes bytes, leaves tombstones (`410`, `state: expired`), honours each workspace's `artifacts` tier, leaves another driver's rows — local volume and MinIO |
| `test-plane/test-plane.integration-spec.ts` | the **`failing-HIL` scenario** replayed, and **isolation**: every route the epic added, enumerated from the route table, `404`s another workspace |

**The `failing-HIL` scenario** (`test-plane/failing-hil.scenario.fixture.ts`) plays mockup 11's
story on the real contracts: a run opened as the simulated driver, a rig enrolled through the real
routes, and three builds each offered over the gateway and uploaded with the offer's single-use
token — Build 1 `49/63`, Build 2 `61/63` (overshoot 2.4% > 2.0%), a `product_bug` classification
with the correction note, the steer claimed and attempt 2 opened, Build 3 `63/63`. No result is
written to the database directly. The build submission is `FarmJobsService.submitForRun`, the seam
AJ.3 ([#265](https://github.com/NobuData/ouroboros/issues/265)) will route; the figures are in
`test-plane/failing-hil.fixture.ts`, pinned against the mockup by its spec. ouroboros-engine's
simulator plays the run-console half as its `failing-hil` scenario.

**Mutation checks.** Removing the mechanism turns the named test red:

| Remove | Red test |
| ------ | -------- |
| idempotent re-parse (`replaceTree` replacing every suite rather than by durable key) | `is idempotent: a re-parse keeps every id and count, duplicates nothing and spares classifications` |
| the upload token scope check (`uploadTokenMatches` in `UploadService.admit`) | `is job-scoped: one job's token is refused on another job, and the other's on it` (both drivers) |

```bash
yarn test:integration src/modules/test-plane src/modules/test-results-read src/modules/flakes
```

### PR gate engine

AX.2 ([#358](https://github.com/NobuData/ouroboros/issues/358)), decision **V2**, in
[`src/modules/pull-requests/gates/`](src/modules/pull-requests/gates). Mockup 12's Verification
gates card, as data: definitions materialized from the pinned policy into `pr_gate_definitions`,
and a verdict snapshot per gate per revision appended to `pr_gate_results` (V056).

| gate | required when | green line | otherwise |
| ---- | ------------- | ---------- | --------- |
| `build` | the pin has a `checks` gate node | `forge-01 · zephyr.elf · FLASH 43.5%` | red `forge-01 · exit 2`; pending while no build of the head has finished |
| `test_suite` | … or the run's *block until green* intent is on | `63/63 after attempt 4` | red `61/63 · 2 failing after attempt 4`; waived when AS.4 waivers cover every failing case |
| `physical_hil` | the pin has a `checks` gate node | `overshoot 1.7% ≤ 2.0% · rig helios-rig-02` | red with the worst failure; not required with no physical suite |
| `diff_vs_plan` | the pin has a `checks` gate node | `all hunks map to planned files · 0 out-of-scope edits` | red naming the out-of-scope paths; not required with no plan |
| `secrets_license` | the pin has a `checks` gate node | `clean (headers + manifest delta)` | red with AP.3's secrets fail or the license layer's first finding |
| `model_review` | an `add_vote` rule matches the ticket (#194) | — | **`unavailable`, never `pending`**, until AZ.1 (#371) |
| `human_approval` | always; required whatever org config says once a review is requested (#361) | `approved by Priya N — <note>` | an approval slot answers first: `pending` while requested, red on a decline, `pending` again after a push; else `not_required` when the terminal auto-merges, pending otherwise |

Each definition's `source` names what produced it — `standard-fix@v14 pin`, `ouroboros default`
for a PR without a readable pin (everything required), or `org config`. Org config is read
through the `ORG_GATE_POLICY` port, bound to the defaults (no overrides; a permissive SPDX
allow-list) until the org policy document's resolver (#481) rebinds it.

**Triggers.** The PR sync (`revision_pushed` / `pr_synced`), the artifact upload's parse
(`test_run_parsed`), the gateway's `job.finish` (`build_job_finished`) and the change-set report
(`guardrail_evaluated`) notify the `GATE_EVIDENCE` sink after their own transaction commits, and
the PR page's head actions do too when an approval slot moves (`approval_recorded`, #361). Each
event re-evaluates only the gates it can move, plus any gate never judged on the revision. The
sink never throws into its caller.

**Idempotent.** Providers are pure functions of the gathered facts; a result identical to the
latest one is not appended, and the PR row is locked per evaluation. Only the latest revision is
judged, so a push leaves the previous revision's verdicts intact.

**State.** After each evaluation, `pr_gate_aggregate(revision)` moves `pull_requests.state` along
V052's graph: a red required gate is `blocked`, otherwise `verifying`. An `armed` PR stays armed
while its gates are only pending and leaves `armed` for a red gate. Every evaluation is then told
to `GateListeners` — the merge executor (#360) fires or disarms there.

**The license layer states its scope** (decision V7, option 3-A): SPDX headers on the revision's
diff sample (every added `SPDX-License-Identifier:` expression against the allow-list, and a new
source file without one), and added `"license"` entries in `package-lock.json`, `composer.lock`
and `package.json`. No full-text detection, no transitive audit — that is AZ.4 (#374). The SPDX
list is bundled (`gate.spdx.ts`, list version in every result's `provider_version`).

### PR acceptance criteria

AX.3 ([#359](https://github.com/NobuData/ouroboros/issues/359)), decisions **V6** and **V9**, in
[`src/modules/pull-requests/criteria/`](src/modules/pull-requests/criteria). Mockup 12's *Does
the PR do what the ticket says?* matrix over V057's `pr_criteria` and `pr_criteria_evidence`.

| route | what | who |
| ----- | ---- | --- |
| `GET /api/v1/pull-requests/:id/criteria` | the matrix: claims, evidence lines, status, waiver | every member |
| `POST …/criteria` · `PATCH`/`DELETE …/criteria/:criterionId` · `PUT …/criteria/order` | author (`manual`), reword, delete, reorder | member+ |
| `POST …/criteria/import` | the plan's *Acceptance criteria* section, as `plan` rows (repeatable) | member+ |
| `POST …/criteria/:criterionId/evidence` · `DELETE …/evidence/:evidenceId` | cite / remove a typed reference | member+ |
| `POST …/criteria/:criterionId/verify` · `…/unverify` | status, audited | member+ |
| `POST …/criteria/:criterionId/waive` | AS.4 waiver + host PR annotation, audited | owner, admin |

**Evidence resolves before it is stored.** `test_case` by `caseKey` in an attempt of the PR's run
(a skipped case did not run), `hil_measurement` and `build_artifact` of the run, `hunk` against
the revision's files snapshot (`hunk_outside_snapshot` otherwise), `analysis_note` on a revision
of the PR. A reference that does not resolve is `422 evidence_unresolved` for every kind. The
composed mono line — `hunk telemetry_buf.c:41–66`, `HIL overshoot 1.7% vs 2.0% limit (was 2.4%
in build 3)` — is stored beside the reference.

**Verification requires evidence** (`409 criterion_evidence_required`). `extracted` provenance is
refused until AZ.2 (#372). The plan import reads the newest draft pushed as the PR's ticket
(`ticket_drafts.pushed_ticket_id`) and only its stated *Acceptance criteria* section.

**Waiving** writes the waiver and `waived` in one transaction, then posts
`criterion.<id>`-keyed Markdown (criterion, reason, author) through `PrSyncService.comment` — the
SPI's `commentPR`, which now also answers the comment's `url`. A re-waive is a new waiver and an
**edit** of the same comment. A host refusal is answered as `annotation.state: failed`, recorded
on the waiver (V062), never thrown; waiving again retries. Audited as `pr_criterion.verified`,
`pr_criterion.unverified` and `pr_criterion.waived`.

### PR merge executor

AX.4 ([#360](https://github.com/NobuData/ouroboros/issues/360)), decisions **V3** and **V9**, in
[`src/modules/pull-requests/merge/`](src/modules/pull-requests/merge). Mockup 12's **Merge when all
gates green** over V058's `pr_merge_plans` and V064's `planning_epic_notes`.

| route | what | who |
| ----- | ---- | --- |
| `GET /api/v1/pull-requests/:id/merge-plan` | the plan, `disarmReason {code, message}`, `mergedResult`, `armedByPerson` (written with the defaults if absent) | every member |
| `PATCH …/merge-plan` `{commitMessage?, closeTicket?, commentEvidence?, backAnnotateEpic?, epicId?}` | edit the plan — only what is sent changes (#369) | owner, admin; a member when the pin auto-merges |
| `POST …/merge-plan/arm` `{revisionId}` | arm against the revision looked at; fires at once when already green | owner, admin; a member when the pin auto-merges |
| `POST …/merge-plan/disarm` | withdraw the intent | member+ |
| `POST …/merge-plan/merge` | merge now, through the same re-check | owner, admin; a member when the pin auto-merges |

**The re-check runs inside the transaction that holds the PR row** — the gate engine's own
`for update` lock — so no verdict can land between the check and the merge. In order: the armed
revision is still the head (`head_moved`), no required gate is red (`gate_red`), every one is
satisfied (`gates_pending` — the only refusal that leaves an arm standing), the host reports it
open (`host_not_open`), at the verified head (`host_head_moved` — a push not yet synced), without a
conflict (`host_conflict`). A host that refuses the merge itself — branch protection, a required
check — is `host_refused`. Every refusal of an armed plan disarms it with `<code>: <sentence>` in
`disarm_reason`; there is no retry.

**Event-driven.** The executor registers on `GateListeners` at boot; each evaluation schedules a
re-check of that PR (chained per PR, never blocking the engine), and a PR nobody armed costs one
plan read.

**After the merge**, still in the transaction: the canonical ticket's closure is read back from
`mergePR`'s verified closures — a key no keyword could close (`PROJ-142`, another repository) is
reported, never assumed; the evidence summary (gate table, criteria matrix, spend) is published as
one host comment keyed `evidence-summary`, **edited** on every re-publish; the epic note is written
when toggled; the run becomes `merged` with its `pr_number` (the dashboard's outcome); and
`merged_result` records the sha, the identity the host recorded — `configured token` rather than any
`[bot]` claim while merges are token-based — and the actions that actually ran. The PR mirror is
synced after commit. Audited by V058's trigger: arm (who armed), disarm (who, or nobody for a
re-check), merge (the person it was made for, V064).

**Editing the plan** (AY.7, [#369](https://github.com/NobuData/ouroboros/issues/369), REST 0.37.20)
is the Merge plan card's: the commit message, the three toggles and the epic the third annotates.
An absent field is left alone and `null` clears the epic — the only field it clears — which also
switches back-annotate off (`merge.edit.ts`). The strategy and delete-branch are the pinned
policy's, and a body naming them is a `422`.

| refusal | when |
| ------- | ---- |
| `409 merge_plan_armed` | the plan is armed — arming confirmed its terms, so disarm first |
| `409 merge_plan_merged` | the plan has merged and is final |
| `409 pull_request_not_open` | the PR is merged or closed on its host |
| `422 merge_plan_epic_required` | back-annotate would be on with no epic |
| `422 merge_plan_epic_not_found` | the epic is not this workspace's — checked before the write, and V058's own refusal is answered the same way if the check is raced past |

An edit that changes nothing writes nothing. Audited by V058's trigger as `pr_merge_plan.edited`,
with the person and the columns that changed — never the message. `armedByPerson` names who armed
the plan, `{id, name}`, for the card's footer; `armedBy` stays the id.

**Closing the ticket is the host's.** `closeTicket` records the intent; the close happens on the
message's `Closes <key>.` keyword. A message edited to drop it leaves the ticket open, and the
merge reports `close_ticket` among the actions that did not run.

**The dry-run policy** ([below](#the-dry-run-policy)) sits under all of it: arm and merge answer
`409 dry_run_policy_active` while it is active, and every run re-reads it uncached first, so a plan
armed before it turned on is disarmed with `dry_run_policy_active` rather than merged. The plan
carries `dryRun {active, reason, autoMerge {requested, effective, overridden}}`.

**Not wired yet:** the policy document's `auto_merge` rule (#481); explicit ticket closing — the SPI has no member for it, so a failed keyword close is reported; a
`Co-authored-by:` trailer for the arming person — the message is sent as written.

### The dry-run policy

BA.3 ([#382](https://github.com/NobuData/ouroboros/issues/382)), decision **O3**, in
[`src/modules/policies/`](src/modules/policies) over V075's `org_policies` (read through
`org_policies_effective`). Mockup 13's *"starts in dry-run: draft PRs, never merges"* as a policy the
PR plane enforces **below** every surface that could merge.

| point | while dry-run is active |
| ----- | ----------------------- |
| `PrSyncService.create` (the SPI's `createPR`) | forced to **draft**, whatever the caller asked |
| `POST …/merge-plan/arm`, `…/merge` | `409 dry_run_policy_active`, `details {reason, policy}` |
| every executor run | re-read **uncached**; an armed plan is disarmed `dry_run_policy_active`, never merged |
| `plan.dryRun.autoMerge` | a pinned `open_pr_automerge` terminal overridden at evaluation — the document is never written |

| route | what | who |
| ----- | ---- | --- |
| `GET /api/v1/policies/dry-run` | `{dryRun, explicit, reason, updatedAt, updatedBy}` — the one read every surface uses | every member |
| `PATCH /api/v1/policies/dry-run` `{dryRun}` | flip; audited `policy.dry_run_changed` (subject `org_policy`) with `previous` | owner, admin |

**A workspace that never answered reads off**; completing the Get Started wizard (step 4) writes
`dry_run = true` when unset and never overwrites an explicit `false`. Reads are cached per process
for 30 s and every write busts the cache; the merge path never trusts the cache.

Since #481 this switch is the **stricter override** of the org policy document's
`dry_run_new_repos` rule — see below: "is dry-run active" is asked per PR.

### The org policy document

BQ.2 ([#481](https://github.com/NobuData/ouroboros/issues/481)) over V092's `org_policy_versions`
(BQ.1, #480), in [`src/modules/policies/`](src/modules/policies). One
`PolicyResolutionService` reads the version `org_policies.current_version` points at — cached per
process for 30 s, cleared by a publish, uncached where a decision is taken at execution — and every
enforcement point asks its rule there (`policy-resolution.ts`, one pure evaluator per rule). Every
verdict carries its **rule id and version**, and one decision reads one version (`snapshot`), so a
publish mid-flight cannot produce a half-old, half-new answer. A workspace that has published
nothing is bound by no rule.

| rule | enforced by | what it decides |
| ---- | ----------- | --------------- |
| `auto_merge` | AX.4 merge executor (#360) | A `member` may arm/merge only a PR whose pinned workflow auto-merges **and** whose ticket meets the rule (*effort ≤ M · non-refactor*); an armed plan is re-checked at execution and refused `auto_merge_policy_ineligible` unless an owner/admin armed it. `plan.autoMergePolicy` says why |
| `human_review` | AX.2 gate engine (#358) | `human_approval` is required for a matching ticket, with the provenance `… + org policy v7: refactor → human review`. Switching it off lets a refactor-labelled PR through; the engine holds no rule of its own (`gate.no-hardcoded-policy.spec.ts`) |
| `protected_paths` | AP.3 guardrails (#305) · BN.4 inbox card (#464) | The **union** of the document's org-wide globs and each repository's `protected_path_policies` rows — publishing a glob protects it on the next run with no write to BA.1's rows, and absorbing never un-protects one. A failure on an org glob names the policy version |
| `spend_guard` | Z.1 resolution (#194) | The resolution's `maxCostCents` is the **stricter** of the route's cap and `per_run_cap_cents`; `costCap` names which (`route` or `spend_guard`, with the version), so the executor's `cost_cap_exceeded` reports the limit that fired. Pausing a run and the monthly cap are AF.4's (#237) |
| `dry_run_new_repos` | BA.3 dry-run plane (#382) | A repository's first N loops are in dry-run: draft PRs, arming and merging refused. A loop is a run on the repository that opened a PR (recorded on the run or mirrored); the PR is loop *k* when *k − 1* came before it. The org-wide switch above stays the stricter override; refusals say which (`details.source`) |

| route | what | who |
| ----- | ---- | --- |
| `GET /api/v1/policies` | `{version, document, publishedAt, publishedBy, changeNote}` — the version in force, verbatim; all null when nothing is published | every member |
| `GET /api/v1/policies/versions` `?limit&before` | the history, newest first — each version's note, publisher (`publishedBy`, `publisherName`), time, document and the rules it changed against the one before it; `nextBefore` pages | every member |
| `POST /api/v1/policies/preview` `{document}` | each changed rule's class (`tightening`/`loosening`/`neutral`) and line, the draft's class, `requiresOwner`, `mayPublish` — writes nothing | owner, admin |
| `POST /api/v1/policies` `{document, baseVersion, changeNote?}` | publish `vN+1`; `422 policy_document_invalid` (against `schemas/org-policy/v1.json`) or `policy_unchanged`, `409 policy_version_conflict`, `403 policy_loosening_requires_owner`; audited `policy.published` with the version, changed rules, classes and the audit card's line — *"enabled auto-merge (policy v8)"* | owner, admin — a loosening owner only |

**The classification is computed, not guessed** (`policy-publish.ts`): each rule is read as the set of
things it lets through — tickets eligible to auto-merge, tickets needing review, protected globs,
caps, dry-run loops — and compared before and after. A predicate reads only the ticket's effort and
the labels it names, so the comparison enumerates every case that could tell two versions apart
(up to 10 distinct labels; beyond that, and for any `custom:*` rule, a change is classed as loosening).

**The version history and the glob preview** (BS.4,
[#494](https://github.com/NobuData/ouroboros/issues/494)) are the settings card's two reads beside
the document.

- **`GET /api/v1/policies/versions`** (`policy-history.service.ts`) stores nothing of its own: each
  version's `changes`, `classification` and `summary` are recomputed from its document and the one
  before it by `diffPolicies` and `publishSummary` — the functions the publish audited with — so the
  popover's `v6 → v7` and the audit card's line cannot disagree. Version 1 is compared with "no
  policy". The page reads one row more than it returns: the last item's predecessor, and whether
  another page exists.
- **`POST /api/v1/policies/path-preview`** `{globs}` (owner, admin; `path-preview.service.ts`)
  answers, per enabled repository, each glob's `matchCount` and up to five `samples`. A glob is
  accepted when the document's `path_glob` grammar accepts it (`422 policy_path_glob_invalid`
  names the others) and matched by `guardrails.glob.ts`, the matcher AP.3 enforces with. Trees are
  listed through `DetectionService.readTree` — one host request, cached 60 s per process — and a
  repository that cannot be listed is `status: "unavailable"` with a `reason`, never a `5xx`. It
  writes and audits nothing. It is `PathPreviewModule`, separate from `PoliciesModule`, which
  imports no plane so that every plane may import it.

### Estimator calibration

BI.4 ([#435](https://github.com/NobuData/ouroboros/issues/435)), decision **I7**, in
[`src/modules/insights/`](src/modules/insights) over V077's `estimate_outcomes`. Every merged loop
is graded against the estimate **in force when its work was queued** — never a later revision — so
*"89% within band"* measures the estimator rather than its hindsight.

| piece | what |
| ----- | ---- |
| the fill | `PrSyncService` tells `CALIBRATION_MERGE_OBSERVER` about every merge it first sees; `ouroboros.record_estimate_outcome(org, pr)` upserts one row per PR (a replay re-derives it). A failure is logged and never fails the sync |
| the join | newest `issue_estimates` row for the PR's ticket or the loop's mirrored issue created by the queue instant (`queue_items.enqueued_at` when it precedes the loop's start, else `runs.started_at`) |
| the actual | `ouroboros.lead_time_ms(runs.started_at, merged_at)` — the DORA lead-time definition, one function so the two cannot disagree |
| the grade | generated columns: `within_band` (inclusive) and signed `deviation_ms` from the band midpoint; an unestimated merge is a row with a null prediction |

| route | what | who |
| ----- | ---- | --- |
| `GET /api/v1/insights/calibration?window=7d\|30d\|90d` | `{window, from, to, merged, estimated, unestimated, withinBand, withinBandPct, efforts[5]}` — each effort with `over`/`under` counts, `biasPct` and `bias` (`over\|under\|even`); `30d` when absent | every member |

Rates are re-derived from counts (the headline is never an average of the slices) and are null
over nothing.

### Intervention causes

BI.3 ([#434](https://github.com/NobuData/ouroboros/issues/434)), decision **I5**, in
[`src/modules/insights/`](src/modules/insights) over V079's `intervention_events`. The events and
their rule causes are the database's: hooks on runs, failure classifications, waivers and guardrail
evaluations call `sync_intervention_events(run)`, idempotently, and `intervention_cause_rules` maps
each event's signals to `infra_rig | ambiguous_ticket | policy_gate | model_disagreement | other`.
The service's one write is a person's correction; BK.4
([#445](https://github.com/NobuData/ouroboros/issues/445)) adds the list a person reaches an event
from.

| route | what | who |
| ----- | ---- | --- |
| `GET /api/v1/insights/interventions` | `?range=` (`30d` when absent) and optional `?cause=` → `{range, window, cause, total, interventions}`: the events the Insights card counts — detected on one of the page's window's UTC days, on a run with a repository, exactly as `intervention_cause_daily` groups them — newest first, at most 50, each with its latest override | any member, a viewer included |
| `POST /api/v1/insights/interventions/{id}/recategorize` | `{cause, reason}` → the event with `causeOrigin: "human"` and its `override` (actor, from, to, reason); `recategorize_intervention()` writes the audit row and the change in one transaction. `404 intervention_not_found` for another workspace's event, `409 intervention_cause_unchanged` for the cause it already has | `owner`, `admin`, `member` — a viewer is `403` |

A human cause survives every later rule run (`apply_intervention_rules()`) and replay — the
database refuses to turn it back into a rule's.

**The card moves with the correction.** The hourly tail re-reads only today and the nightly
consolidation only a trailing window, so a correction to an older event would otherwise never reach
the bars. After the write, `RollupService.refillDay` re-fills the `interventions` family for the
event's UTC day and stamps the family's run, which retires every replica's cached window: the next
`GET /api/v1/insights` has the bars and the line computed from them already moved. A re-fill that
fails is recorded on `metric_rollup_state` and logged; it never undoes the committed correction.

### Insights rollups

BI.2 ([#433](https://github.com/NobuData/ouroboros/issues/433)), decisions **I1**/**I2**, in
[`src/modules/insights/rollup/`](src/modules/insights/rollup) over V076/V078's `metric_daily`. One
extractor per metric family fills the daily grain — per workspace, repository, metric, dimension
and **UTC day** — from the source planes; nothing here is an endpoint yet
([windowed metrics](#windowed-metrics-service), #437, reads it).

| family | metrics | population |
| ------ | ------- | ---------- |
| `throughput` | `merged_prs`, `merge_rate`, `merged_untouched_rate` | loop PRs merged that day, or closed unmerged on the day their loop finished; *untouched* is I6: every revision's head sha is a commit the loop reported |
| `interventions` | `human_interventions` (v2, by `cause`) | V079's intervention events per cause, read from `intervention_cause_daily` — needs-human handoffs, human classifications, waivers, the first `fail` of each guardrail check per loop (`review_required` is the policy gate) and blocking votes (#434) |
| `cycle` | `cycle_time`, `stage_duration` (by stage) | loops that finished `merged`; medians |
| `cost` | `cost_cents`, `tokens`, `unpriced_tokens`, `local_tokens`, `tokens_by_task_kind` (by task kind) | run-attributed usage; no `cost_cents` row on a day with nothing priced (unpriced ≠ $0). `cost_per_merged_pr` is Σ`cost_cents` / Σ`merged_prs` per window, never stored per day. `local_tokens` is the part an `ollama`/`openai_compatible` connection served — where the model ran, not what it cost. Usage with no task kind is in `tokens` and in no `tokens_by_task_kind` row (V083, #438) |
| `builds` | `builds`, `build_failures`, `build_success_rate` | farm jobs finished `succeeded`/`failed`/`retried` |
| `build_duration` | `build_duration` (by job label) | farm jobs finished `succeeded`; start-to-finish ms, medians — the Build Analyzer's duration series (V086, #510) |
| `tests` | `test_cases_run`, `test_pass_rate`, `test_failures_by_suite` (by suite) | finished test runs started that day, from suite counts |
| `effort` | `completion_time_by_effort` (by effort) | `estimate_outcomes` merged that day; medians |
| `dora` | `deploy_frequency`, `lead_time`, `change_failure_rate`, `mttr` | green default-branch builds; `lead_time_ms()`; revert detection (`Revert "…"`, `revert:`) over merged PR titles and loop commits, dated by the original merge; loop-scoped red→green recovery |

**How a window reads it** is the registry's `aggregation`: `sum` sums values, `ratio` re-sums
`numerator`/`denominator` and divides once, `median` pools every day's `meta.samples` — never an
average of daily values or daily medians. Each extractor declares the registry `version` of every
metric it fills and refuses to fill (`metric_rollup_state.last_error`) when the database disagrees.

**Scheduling** is one jittered loop (`OURO_INSIGHTS_ROLLUP_INTERVAL_SECONDS`, an hour): every tick
re-fills today; a family never filled backfills `OURO_INSIGHTS_ROLLUP_BACKFILL_DAYS` (90); the
first tick of a new UTC day consolidates the last `OURO_INSIGHTS_ROLLUP_CONSOLIDATE_DAYS` (3) plus
any gap; a backfill moves at most `OURO_INSIGHTS_ROLLUP_DAYS_PER_TICK` (31) days a tick. Each day is
one transaction under a per-(workspace, family) advisory lock that replaces the day's rows and moves
the cursor, so re-runs are idempotent and an interrupted backfill resumes without gaps or
double-counting.

**The oracle.** Every metric has an on-the-fly SQL twin in `rollup.oracle.fixture.ts`;
`rollup.integration-spec.ts` fills a fixture through the extractors and requires every window,
per repository and dimension, to equal the twin — the build fails if a rollup drifts.

```bash
yarn test:integration src/modules/insights/rollup
```

### Windowed metrics service

BJ.1 ([#437](https://github.com/NobuData/ouroboros/issues/437)), decisions **I1–I3**, in
[`src/modules/insights/metrics/`](src/modules/insights/metrics). `MetricsService` is exported by
`InsightsModule`. It is the one place any surface asks what a number is, what it was, and how it
was computed.

```ts
metrics.window("merge_rate", { organizationId, repo?, dimension?, range: "30d", now? })
// ⇒ { value: 92, components: {numerator: 96, denominator: 104}, prior: 89, delta: 3,
//     series: [{day, value, meta}, …30], methodology: {formula, sources, caveats, unit, version, proxy} }
```

| Rule | What it means |
| ---- | ------------- |
| **Days** | UTC calendar days, the grain's (V078). A caller's offset never moves a window. |
| **Window** | `7d`/`30d`/`90d` = N days ending **today**, today included. |
| **Prior** | The N days immediately before. Equal length, adjacent, no calendar snapping. |
| **Rollup scan** | `metric_daily` over `[prior.from, yesterday]`. It never reads today's row. |
| **Live tail** | Today, from each family's extractor run live for that **one** day. Never written. |
| **Recomposition** | `ratio` = Σnumerator / Σdenominator; `median` pools samples; `sum` adds. `cost_per_merged_pr` = Σ`cost_cents` / Σ`merged_prs`. |
| **Units** | As the registry stores them: a `pct` is 0–100 and `delta` is in points. A rate or median with nothing to compute from is `null`; a sum of nothing is `0`. |
| **Methodology** | The `metric_definitions` entry, `version` included, travels with every answer. |
| **Cache** | 30 s, keyed by workspace, metric, repo, dimension, range, today and a rollup stamp (`metric_rollup_state`). A refresh on any replica retires the cached windows. |

It refuses (`MetricWindowError`) a metric not in the registry, one no rollup family fills
(calibration reads its own table), and a dimensioned median asked for without a dimension.
The dashboard's pulse card and merged stat read it (the DASH-G.3 amendment).

Two reads serve a page that draws many figures at once (#438), under the same rules and cache:

```ts
metrics.windows(["merge_rate", "cycle_time", …], scope)  // ⇒ Map<metricId, MetricWindow>
metrics.breakdown("human_interventions", scope)          // ⇒ { dimensionKind: "cause", entries: [{dimension, window}, …] }
```

`windows` answers N metrics from **one** rollup scan and one live tail per family. `breakdown`
answers a dimensioned metric as one window per label seen in the window or its prior, labels
ascending; it refuses a metric with no dimension. Each window is the one `window()` would answer
alone.

```bash
yarn test src/modules/insights/metrics                 # window matrix vs an event-level oracle
yarn test:integration src/modules/insights/metrics     # vs rewindow, live tail, isolation, KPI budget
```

### Model scoreboard

BJ.3 ([#439](https://github.com/NobuData/ouroboros/issues/439)), decisions **I1**, **I6** and
**I10**, in [`src/modules/insights/scoreboard/`](src/modules/insights/scoreboard).
`ScoreboardService` is exported by `InsightsModule` for the Insights read APIs (#438). It answers
mockup 15's MODEL SCOREBOARD: how often each task kind × model's work merged untouched, what a
success costs, and which way that is trending.

```ts
scoreboards.scoreboard({ organizationId, repo?, range: "30d", now? })
// ⇒ { window, prior, minSample: 10, rows: [{ taskKind: "implement", model: "claude-fable-5",
//       hop: 1, role: "primary", merged: 25, untouched: 21, untouchedRate: 84,
//       cost: { pricing: "priced", cents: 2175, centsPerSuccess: 87 },
//       trend: { direction: "up", prior: 80, delta: 4 }, lowSample: false }, …],
//     methodology: { untouched, costPerSuccess, trend, sample }, suggestion? }
```

| Column | Rule |
| ------ | ---- |
| **Row** | Task kind × the model of the hop that served it. That is the latest resolved `resolution_snapshots` row for each (run, task kind), taking the last kept hop that was tried (it has `duration_ms`), or the first kept hop if none was timed. A merge counts in a row for every task kind its run resolved. |
| **Role** | Hop 1 of the resolved chain is `primary`, and any later hop is a `fallback`. A fallback row covers the work its primary could not do. |
| **Untouched %** | Decision I6. `untouched.sql.ts`'s predicate is the one the throughput extractor fills the KPI row's `merged_untouched_rate` with, applied to the row's merged loop PRs. |
| **$ / success** | The usage the row's runs recorded under its task kind in the window, divided by the row's merges. It is `priced` (dollars) only when every token had a price. With any unpriced usage it is `unpriced` (tokens per success, never a partial dollar figure). With no usage it is `none`. A local model priced at zero shows `$0.00`. |
| **Trend** | The row's rate minus the same row's rate in the prior window of equal length: `up`, `down` or `flat`. It is also `flat` when either window has no rate. |
| **Sample** | `merged`. A row below `minSample` (10) has `lowSample: true`. It is shown with the badge, never dropped. |
| **Suggestion** | AB.3's (#209) payload, passed through when a `SCOREBOARD_SUGGESTIONS` source is bound and answers. Nothing binds it yet, so the key is absent (I10). The service never writes advice of its own. |

Windows follow the [windowed metrics](#windowed-metrics-service) rules: UTC days, N days ending
today, and the prior N days before. Each column's popover is a registry entry: the KPI row's own
`merged_untouched_rate`, plus V082's `scoreboard_cost_per_success`, `scoreboard_trend` and
`scoreboard_merged`. A missing entry throws `ScoreboardRegistryError`. The scoreboard reads the
source planes per request and is not on the daily grain.

```bash
yarn test src/modules/insights/scoreboard              # mockup rows, badge, pricing, trend, slot
yarn test:integration src/modules/insights/scoreboard  # real loops, KPI parity, human push, isolation
```

### Insights page

BJ.2 ([#438](https://github.com/NobuData/ouroboros/issues/438)), decisions **I1**, **I5**, **I6**,
**I8** and **I10**, in [`src/modules/insights/page/`](src/modules/insights/page). Mockup 15 in one
read. `InsightsPageService` is exported by `InsightsModule`, so the email digest (#440) reads the
same payload.

| route | what | who |
| ----- | ---- | --- |
| `GET /api/v1/insights?range=7d\|30d\|90d&repo=owner/name` | `{range, window, repo, usage, head, kpis[5], series, hbars, performance[6], flaky, scoreboard, dora[4], freshness}`; `30d` when `range` is absent, the whole workspace when `repo` is; a range outside the three (`custom` included) or a malformed `repo` is `422 validation_failed` | every member |

The service computes nothing of its own. Every figure is a [windowed metric](#windowed-metrics-service)
read with one `now`, and the composers (`page.cards.ts`, `page.series.ts`, `page.hbars.ts`,
`page.flaky.ts`) are pure functions from those facts to the payload.

| Part | Source | Notes |
| ---- | ------ | ----- |
| `head` | `merged_prs`, `human_interventions` over **7d** | Always the last week, whatever `range` is. The numbers behind the headline; the sentence is the client's. |
| `kpis` | `merge_rate`, `merged_untouched_rate`, `cycle_time`, `cost_per_merged_pr`, `human_interventions` | `value`, `prior`, `delta`, `trend {direction, good}` and the registry `methodology`. |
| `series` | `merged_prs` (+ interventions and the day's cost for the tooltip), `cost_cents`/`tokens`, `builds`/`build_failures` | One point per UTC day of the window. |
| `hbars` | `breakdown()` of `human_interventions`, `stage_duration`, `test_failures_by_suite`, `completion_time_by_effort`, `tokens_by_task_kind` | Bars plus a computed `line` (below). |
| `performance` | `builds`, `build_success_rate`, `test_cases_run`, `test_pass_rate`, `tokens`, `cost_cents` | Rates carry `components`. |
| `flaky` | `FlakeStateService.card` (AT.3) | Non-healthy cases, plus cases that came back to `healthy` inside the window (`fixed`). Rate and per-day history come from `test_case_history`. `platform` only when every flaky occurrence ran on one; `resolvedBy {runId, issueNumber}` only when a loop's build produced the first clean pass. |
| `scoreboard` | [`ScoreboardService`](#model-scoreboard) | As it answers it. |
| `dora` | `deploy_frequency` (as `per_day`), `lead_time`, `change_failure_rate`, `mttr` | `sparkline` per day; `proxy` is the registry's flag. |
| `freshness` | `metric_rollup_state`, summarized over the workspace's families (#447) | `filledThrough` — the stalest family's last complete UTC day; `lastFilledAt` — the latest successful run; `behind` when that day is before yesterday or some families never filled; `failing` when a latest run failed. Both instants `null` before any fill — a cold workspace, not `behind`. The page's rollup-lag banner says this. |

**Insight lines are computed** (I5). Each is arithmetic over the bars above it, and `null` when
the window gives it nothing true to say:

| Card | Line | Arithmetic |
| ---- | ---- | ---------- |
| interventions | *Fix the top row and interventions drop ~40%.* | top cause ÷ all causes |
| stages | *Implement dominates the loop — the other five stages sum to 8m 20s.* | Σ of the other stages' medians |
| suites | *33 failing cases total — 0.12% of everything that ran.* | Σ failures ÷ `test_cases_run` |
| effort | *Estimator calibration: 89% of issues land within their predicted band.* | [calibration](#estimator-calibration)'s `withinBandPct` |
| tokens | *≈ 1.3M tokens per merged PR · 31% served by local models.* | `tokens` ÷ `merged_prs`; `local_tokens` ÷ `tokens` |

**Money is present or absent, never zero by default** (I8). `usage.pricing` is `priced`,
`unpriced` or `none`. A dollar key (`costCents`, `budget`, `projection`, `spike`) exists only where
priced usage backs it. In a workspace nothing prices, the payload has tokens and no dollar key:
the fourth KPI reads tokens per merged PR under the `tokens` methodology and `total_cost` is
`null`.

| Cost-chart key | Rule |
| -------------- | ---- |
| `budget` | Σ `monthly_cap_cents` of the enabled `provider_connections` that have one, and that sum ÷ the days in the current UTC month. Absent with no cap or no priced usage. |
| `projection` | `method: "linear_to_date"`: month-to-date priced spend ÷ days elapsed × days in month. Absent with no priced usage this month. |
| `spike` | The highest priced day, when it costs at least twice the window's median priced day and the window has five priced days. A plain value: nothing attributes it to a cause. |

**A gated claim is a missing key** (I10). Cap alerts (#237), the routing suggestion (#209) and the
analyzer's cluster note have no source yet, so the payload has no key for them. The OpenAPI
schemas are closed (`additionalProperties: false`), so one cannot appear without a contract
change.

Today's figures come from the live tail, so on the dev seed the last day of each series is what
the source planes hold, not the seeded `metric_daily` row for today.

```bash
yarn test src/modules/insights/page                # composers, lines, money rule, contract
yarn test:integration src/modules/insights/page    # one truth vs window(), gates, isolation
```

### Email digest

BJ.4 ([#440](https://github.com/NobuData/ouroboros/issues/440)), decision **I9**, in
[`src/modules/insights/digest/`](src/modules/insights/digest) over V084's four tables. A weekly
email that says what the [Insights page](#insights-page) says.

**It is assembled from the page and from nothing else.** A run reads
`InsightsPageService.read(org, {range: "7d"})` once and `assembleDigest(page)` turns that payload
into a `DigestAssembly`: the KPI row with its deltas, the top intervention cause with the page's
own computed line, the flaky tests that moved, and the cost line. No file in `digest/` imports a
layer a metric is computed in, and its repository reads only its own tables and the people it
mails — `digest.sources.spec.ts` fails the build otherwise. So the mail inherits the page's rules
without restating them:

| Page rule | In the mail |
| --------- | ----------- |
| Dollars only for priced usage (I8) | Priced: `$118 this week across 31M tokens.` Partly priced: `… for priced usage only — 7.8M of 31M tokens have no price.` Unpriced: tokens only, the fourth KPI reads *Tokens per merged PR*, and no `$` appears anywhere. |
| Proxy metrics are flagged | A KPI whose registry entry is a proxy is marked `(proxy)`. |
| Insight lines are computed | The cause section prints the page's own line. |
| A figure with nothing to compute it from is null | Printed `—`, never `0`. |

A week with no merges, closes, interventions, usage, builds or test runs is mailed one sentence —
*"Nothing to report this week."* — and no table. A flaky case that did not run this week does
not count as activity.

**One assembly, two presentations.** `digest.html.ts` and `digest.text.ts` print the assembly's
own strings, so the plain-text part carries the same figures as the HTML part, and a chat
rendering (#536) can read the same object. The HTML is one 600 px table with every style inline,
no image, script or web font, drawn in the light design tokens and declared `color-scheme:
light`. [`tests/e2e`](../tests/e2e/README.md#the-digest-emails-client-profiles) renders it under
four client profiles.

| route | what | who |
| ----- | ---- | --- |
| `GET /api/v1/insights/digest` | `{subscribed, recipient, schedule{weeklyDay, weeklyTime, timezone, nextRunAt}, mail{transport}}` | every member |
| `PUT …/subscription` `{subscribed}` | opt **yourself** in or out; `409 insights_digest_mail_unconfigured` when subscribing with no mail server | every member |
| `PATCH …/schedule` `{weeklyDay?, weeklyTime?}` | the workspace's weekly slot: ISO day 1–7, `HH:MM` **UTC**; Monday 09:00 until somebody chooses | `owner`, `admin` |
| `GET …/preview` | `{subject, html, text, window, contentVersion}` as of now, with no unsubscribe link | every member |
| `GET …/unsubscribe/{token}` | an HTML confirmation page; changes nothing | **no session** |
| `POST …/unsubscribe/{token}` | unsubscribes, answers an HTML page; idempotent | **no session** |

**Subscription is per person, per workspace, and opt-in**: a row in
`insights_digest_subscriptions`, absent until somebody asks. Recipients are read by joining
subscriptions to `member` and `user`, so a person removed from a workspace stops receiving its
numbers, and one workspace's run can only address its own members.

**The unsubscribe link needs no login.** Each send mints a random token; the mail carries it and
the send row keeps only its SHA-256, written *before* the mail leaves. `GET` renders a page with
one button because mail scanners open every link; the button's `POST` unsubscribes, and is also
what a mail client's own control sends (`List-Unsubscribe-Post`, RFC 8058, advertised when
`OURO_REST_URL` is https). A malformed token is refused before any read. The token does not
expire.

**The weekly run** (`digest.runner.ts`, ticked by `digest.scheduler.ts` every
`OURO_INSIGHTS_DIGEST_INTERVAL_SECONDS`):

| Step | Rule |
| ---- | ---- |
| **Due** | The latest weekly slot at or before now, if it is at most 24 h old and the workspace has no run in the 6 days before it — a moved schedule never sends twice in a week. |
| **Who** | Members subscribed at or before the slot. Subscribing never triggers a late copy. |
| **Claim the run** | One short transaction under a per-workspace advisory lock inserts `(organization_id, slot_at)`; the unique key decides between replicas. |
| **Assemble once** | The page is read as of the slot and the assembly is stored on the run row. Every send and retry renders that stored content. |
| **Claim each send** | `(run_id, user_id, attempt)` is inserted as `claimed`, with the token hash, before sending; only the inserter sends, then settles it `sent` or `failed`. |
| **Retry** | A failed send is retried on later ticks, up to 3 attempts, under the same `Message-ID`. A claim unsettled for 5 minutes is failed. |
| **Complete** | When nobody is left to mail or retry. |

**The send audit** is `insights_digest_sends` joined to its run: recipient, attempt, outcome and
reason, with the run's window and `content_version` (`DIGEST_CONTENT_VERSION`, which moves when
the assembly's shape or wording rules change).

Organisation-level notification routes (`weekly_insights` to a list or a channel) are #488's;
Slack is #448's.

```bash
yarn test src/modules/insights/digest                # assembly, honesty, renders + golden, runner, routes
yarn test:integration src/modules/insights/digest    # real SMTP into mailpit, vs GET /insights?range=7d
OURO_UPDATE_GOLDENS=1 yarn jest src/modules/insights/digest/digest.render   # after changing the template
```

### Build Analyzer runs

BV.1 ([#510](https://github.com/NobuData/ouroboros/issues/510)), decisions **A2**/**A7**, in
[`src/modules/analyzer/`](src/modules/analyzer) over V080/V081/V086's `analysis_runs`,
`analysis_schedules` and `analysis_findings`. Three triggers, one orchestrator:

| trigger | where | rule |
| ------- | ----- | ---- |
| `manual` | `POST /api/v1/analyzer/runs` | `owner`/`admin`, audited |
| `weekly` | a one-minute tick (`analysis.scheduler.ts`) | the schedule's ISO day + UTC time has passed with no analysis started since, and after the schedule existed |
| `every_n_builds` | `JobCompletions` (`analysis.counter.ts`) | each `succeeded`/`failed`/`retried` job increments its repository's counter; the increment, the threshold test and the reset are **one `UPDATE`**, so a burst fires once per N; a fire that cannot start is re-armed |

**One running analysis per repository.** A start is refused with `409 analysis_already_running`
(naming the running run) before the engine is asked anything; V080's partial unique index decides
any race. The same tick fails runs left `running` past their compute ceiling plus fifteen minutes
— a process that stopped mid-run — and shutdown fails the runs a process was executing.

**Assembly** (`corpus/`) reads the window — the ninety whole UTC days before the run started —
within the schedule's budgets (or V080's defaults): builds in `md5(id)` order a page at a time up
to `max_builds`; each build's log **tail** (the last 200 lines, read backwards a few chunks at a
time) while the volume it stands for fits `max_log_lines`; failed and flaky test cases; flake
scores; loop stage timings and transcript statistics; ccache statistics; waivers; and the
`build_duration` series. Counts are aggregates (`build_jobs.log_lines` is counted where the bytes
land, V086), so `4.1M log lines` is never read. Every source carries a sampling record
`{sampled, rate, cap}`; the compute ceiling is checked between pages and an overrun ends the run
`budget_exceeded` before dispatch. Rig telemetry (#266) is `null` and named in `manifest.absent`.

**Dispatch** goes to `OURO_ENGINE_URL`'s `POST /v0/analysis/runs` and nowhere else
([`docs/SECURITY_MODEL.md` § 6.6](../docs/SECURITY_MODEL.md#66-the-build-analyzers-corpus-stays-on-the-tenant);
the `analyzer-corpus-stays-on-tenant` dependency rule). The engine streams NDJSON; each analyzer's
start and outcome tick `analysis_runs.progress`, and a completed analyzer's findings are written
as it completes — so `budget_exceeded` keeps them and names the analyzers that did not finish,
and a database refusal fails only that analyzer. The phases are `assembling → analyzing →
composing`, then `complete`, `budget_exceeded` or `failed` with its reason.

**The confidence note's basis** (BW.1, [#516](https://github.com/NobuData/ouroboros/issues/516)).
When a run ends with a note, the manifest stores `confidence` beside it: the level, the window's
builds and days with a build, the coverage and builds-a-day ratios, and the rule they were judged
against (`CONFIDENCE_RULE`: high needs 90 % of days and 5 a day, medium 60 % and 1). The run
resource publishes it as `manifest.confidence` (null on a run with no note or from before #516),
so the strip's popover shows what produced the note.

**The schedule** (BW.1, #516, [`schedule/`](src/modules/analyzer/schedule)).
`GET /api/v1/analyzer/schedule?repo=` answers the saved schedule with its live `buildCounter`, or
V080's defaults with `saved: false`; a repository the workspace does not have is a `404`.
`PUT` saves the whole configuration (owner/admin) under V080's rules — an ISO weekday 1–7 and a
UTC `HH:MM` required while the weekly trigger is on and kept while it is off, `everyNBuilds` ≥ 1
or null, budgets ≥ 1 — never touching the counter, and is audited `analyzer.schedule_updated`.

**Composing** (BV.4, [#513](https://github.com/NobuData/ouroboros/issues/513),
[`composer/`](src/modules/analyzer/composer)) turns the run's findings into suggestions while the
run is still `running`.
- **Templates.** `composer.templates.ts` holds one typed template per suggestion kind: the six
  mockup cards and the BA-1…BA-4 ticket drafts. A template selects the findings it can speak
  about and fills the title and evidence line from their typed data, with no free text. Its
  impact is a named formula over the finding's measured fields (`slowdown_seconds`,
  `pr_seconds_per_commit`, `wait_reduction_seconds`…).
- **Calibration.** The impact is multiplied by BU.3's factor for that analyzer and impact class
  (`analyzer_calibration`, 1 without a row). `impact.basis` stores the formula id, its inputs,
  the window, the calibration and the raw estimate, so the number reconstructs.
- **Spikes.** A missing input makes the impact `unquantified` and the suggestion `needs_spike`,
  bound to a spike draft.
- **Confidence.** It is `round(100 × (1 − e^(−n/scale)) × stability × min(1, |effect|/target))`
  over the cited findings' bases, stored with every input in V087's `confidence_basis`.
- **Writing.** Each suggestion is recorded through `record_analysis_suggestion()`, which upserts
  on the identity derived from the cited findings. Re-analysis therefore updates rather than
  duplicates, and a resolved suggestion keeps what it was resolved as.
- **Failures.** A template that throws, or a suggestion the database refuses, is logged and
  skipped. Composition never fails a run.
- **Synthesis contract.** `/v0/synthesize-findings` is committed here: it is
  `schemas/synthesize-findings/v0.json`, and `synthesis.contract.spec.ts` is its drift check.
  The v2 LLM pass (BX.1, #522) will implement it; until then the `SYNTHESIZER` port is bound to
  `UnavailableSynthesizer`, which answers the contract's empty shape. Composition does not
  depend on it.

**Acting on suggestions** (BV.5, [#514](https://github.com/NobuData/ouroboros/issues/514),
[`actions/`](src/modules/analyzer/actions)) previews, applies, dismisses, drafts and pushes. The
analyzer never mutates another plane: each apply hands its change to the owning plane's service.
- **Preview.** `GET /api/v1/analyzer/suggestions/{id}/preview` is open to members and has no side
  effects. `bindings.ts` builds the exact payload the plane will receive and the sentence naming
  the concrete change — runner, pool, UTC window; repository, title filter, command; workflow,
  stage delta, next version. A `fingerprint` lets Apply refuse anything else.
- **Apply.** `POST …/{id}/apply` is admin+. A pool move goes to `PoolWindowsService` and a cache
  re-warm to `JobHooksService` (`farm/config/`, `/api/v1/farm/pool-windows` and `/job-hooks`). A
  workflow suggestion becomes a **draft** through `WorkflowsService.proposeDraft`, guarded by the
  base etag and carrying a change note that cites the suggestion; publishing stays human. A
  test-gate split has no owning plane and answers `422 analysis_plane_unavailable`. Every refusal
  happens before any plane is touched.
- **Recording.** After the plane accepts and `analysis_suggestion.applied` is audited, one
  transaction resolves the suggestion and writes two rows. The application row keeps the payload,
  preview, landing and reversal. BU.3's measurement row freezes the target metric
  (`build_duration`, `queue_wait` p95 for the moved-to pool, `human_interventions`), the baseline
  over the policy window before the apply, and the prediction with its calibration.
- **Dismiss.** `POST …/{id}/dismiss` is member+ and takes an optional reason. It is kept against
  the suggestion's stable identity, so it survives re-analysis.
- **Draft and push.** `POST /api/v1/analyzer/suggestions/draft` turns ticket and spike suggestions
  into one ordinary AK batch, `analyzer-v1`, through `BatchesService.compose`, and the estimator
  sizes it. Each body carries the evidence line and every evidence reference; a spike states what
  is uncertain and asserts no estimate. `POST /api/v1/analyzer/batches/{id}/push` is AL.3's
  idempotent push. Such a batch cannot be regenerated (`409 batch_not_regenerable`, #519).
- **Boundary.** `.dependency-cruiser.cjs`'s `analyzer-composes-planes-through-their-services`
  forbids importing another plane's repository. `actions.boundary.spec.ts` checks that every write
  in the analyzer's source targets its own tables.

**Measuring** (BV.6, [#515](https://github.com/NobuData/ouroboros/issues/515),
[`measurement/`](src/modules/analyzer/measurement)) keeps the page's promise: *"every applied
suggestion is re-measured for 14 days; the analyzer's model retrains on its own misses."*
- **The job.** `MeasurementScheduler` ticks hourly; `MeasurementService.pass()` is idempotent.
  For each pending measurement it records interference as it lands. It closes the window once its
  last day is over and the target metric's rollup family is filled through it.
- **Measured value.** Day 1…N of the target metric, read the way the baseline was: same statistic,
  unit and pool. A window with no data stays pending.
- **Confounds.** Another application on the **same target metric** applied inside the window, or a
  change-point the analyzer detected in that metric inside it. Either closes the row `confounded`,
  lists them, and keeps it out of calibration.
- **Verdict and note.** The verdict is V085's band arithmetic over the stored numbers. The note,
  *"under-delivered — analyzer revised its cache model"*, is composed from what recalibration
  actually did: the close runs once inside a savepoint to learn the new factor exactly, then again
  for real.
- **Calibration.** `recalibrate_analyzer()` applies V089's bounded formula,
  `round(Σ clamp(measured ÷ raw, 0, 2) × raw ÷ Σ raw, 4)`. The composer applies the new factor at
  the next composition.
- **Read.** `GET /api/v1/analyzer/measurements?repo=` returns every measurement with day N of its
  window, plus the calibration cells with their history and the formula. Since 0.38.14 the
  contract documents what a measurement's three objects hold (#520, which draws them):
  `MeasurementBaseline` (the window, its value, and the statistic and slice where BV.5 stored
  them), `MeasurementPrediction` (the delta, its unit, its basis and the calibration it was made
  under) and `MeasurementResult` (the window, its value and the delta from the baseline).
  `measurement.contract.spec.ts` holds the schemas to what V085 writes.
- **Suite.** `measurement.integration-spec.ts`, `analyzer.isolation.integration-spec.ts` (every
  analyzer route) and `actions/draft.integration-spec.ts` (draft, size, push to a recorded
  GitHub). Removing confound detection, calibration application or dismissal persistence turns one
  of them red.

**The duration chart** (BW.2, [#517](https://github.com/NobuData/ouroboros/issues/517),
[`duration/`](src/modules/analyzer/duration)) is the read behind mockup 18's annotated chart and
the Details sheet each chip opens: `GET /api/v1/analyzer/duration?repo=`, any member.
- **One run's.** The chart is the repository's newest ended run in which the change-point analyzer
  completed — a run in flight, a failed one, or one that hit its budget before detecting never
  blanks it. The window is that run's corpus window, the series is BI's `build_duration` daily
  medians for the job label its corpus timed (`manifest.durationLabel`), and the change-points are
  its `change_point` findings. Before such a run — or for a repository the workspace has none of —
  the answer is an empty chart.
- **A ranking, not a verdict.** Every stored candidate is published in rank order with its `score`
  and the two factors it is the product of (`proximity`, `prior`), beside the measured
  `deltaSeconds` and both segment medians. `attributionWindowDays` is stated per analyzer version
  (`change_point` v1 is ±3 days, pinned by the engine's ledger) and is `null` for a version this
  service does not know. A key V081 does not require is `null` when a finding lacks it.
- **Evidence resolves in the workspace.** Each `{kind, id}` answers what it names and the surface
  it opens on: a build, a runner or a pool on the **farm**; a workflow version in the **workflow**
  studio; a merge on its mirrored **pull request** (matched through the merge plan's recorded
  sha, either side abbreviated) or, when the mirror has none, on the farm that first built the
  commit. A row retention has removed has a `null` label and surface.
- **Suite.** `duration.resources.spec.ts`, `duration.service.spec.ts`,
  `duration.contract.spec.ts` (the answer against `openapi.yaml`) and
  `duration.integration-spec.ts` (the run chosen, the series scoped to the label and window, each
  evidence kind resolved against real rows).

**The suggestion cards** (BW.3, [#518](https://github.com/NobuData/ouroboros/issues/518),
[`suggestions/`](src/modules/analyzer/suggestions)) are the read behind mockup 18's **Suggested
build-process changes** and **Suggested workflow changes**, their scoring popovers and the Details
sheet behind each row: `GET /api/v1/analyzer/suggestions?repo=`, any member.
- **What is current.** A suggestion stays on the cards until an analysis **looks again and does
  not find it**: until a later run that ended (`complete` or `budget_exceeded`) had every analyzer
  its findings came from complete, and still did not compose it. A run that did not look — one in
  flight, a failed one, one whose pattern analyzers were skipped, as a live run's are today —
  never blanks the cards; a run that looked and found nothing does. The rule is per suggestion, so
  an analysis that ran only some analyzers supersedes only what those analyzers feed.
- **Every status.** The current build-process and workflow suggestions are answered `open`,
  `applied` (with the `measurement` its apply opened: day N of its window, the verdict once
  closed), `dismissed` (who, when, why) and `drafted` (the planning batch). A dismissed suggestion
  a re-analysis finds again is still listed, still dismissed; one an analysis no longer finds
  leaves the cards without being resolved by anybody. Ticket drafts are not listed. `runId` names
  the newest ended run that composed any suggestion, and is `null` before one has.
- **Nothing recomputed.** Beside each number is what produced it: `confidenceBasis` (V087's formula
  and every input), `impact.basis` (method, formula id, inputs, window, the calibration applied and
  the raw estimate before it), and `findings` — the cited findings of the suggestion's own last
  analysis, as their analyzers wrote them. A key an older row never stored is `null`.
- **Evidence, bounded.** Each finding answers its first 25 references, resolved, and
  `evidenceTotal` says how many it cites; only those 25 are resolved. `workflow.nextVersion` is
  the workflow's version in force plus one — what a draft becomes when a person publishes it.
  `calibration` is the repository's cells with their history.
- **Evidence resolution is shared** ([`evidence/`](src/modules/analyzer/evidence)) with the
  duration chart, and since #518 resolves every kind V081 knows: a `test_run` and a `test_case` on
  their loop's **test results** (the attempt, and the suite and case to select), and a `waiver` on
  the **pull request** its loop opened, else on that loop's test results.
- **The preview's workflow delta.** `GET …/suggestions/{id}/preview` answers `delta` for a workflow
  draft: the stages and connections the proposed document adds to and removes from the one it is
  built on (`workflow.delta.ts` `summarizeDelta`). It sits beside `change`, outside the
  fingerprint: the payload is what the plane is handed.
- **Suite.** `suggestions.resources.spec.ts`, `suggestions.service.spec.ts`,
  `suggestions.contract.spec.ts` (the answer and the preview against `openapi.yaml`),
  `evidence.resources.spec.ts`, and against real rows `suggestions.integration-spec.ts` (what is
  current: a dismissal across a re-analysis, a suggestion looked for and no longer found, ones
  kept because their analyzer was skipped, a run in flight or failed superseding nothing) and
  `evidence.integration-spec.ts` (test runs, cases and waivers, none of them resolved from another
  workspace). Each clause of the currency rule was removed in turn and turned the suite red.

**The corpus state** (BW.6, [#521](https://github.com/NobuData/ouroboros/issues/521),
[`corpus/corpus.controller.ts`](src/modules/analyzer/corpus/corpus.controller.ts)) is the read
behind the analyzer page's *needs more history* and *no analysis yet* states:
`GET /api/v1/analyzer/corpus?repo=`, any member.
- **The floor.** `MINIMUM_DAYS_WITH_BUILDS` (`corpus.manifest.ts`) is **10**: the change-point
  analyzer compares two segments of at least `min_segment_days` (5) observed days, so under ten
  it can detect nothing. `corpus.manifest.spec.ts` reads the engine's source and holds the
  constant to twice that parameter. It is a proxy and says so — it counts days with any finished
  build, the analyzer days with a successful build of the timed label.
- **Counted, never assembled.** `builds` and `daysWithBuilds` are `CorpusRepository.counts` over
  the window a run started now would read (today excluded) — the statement a manifest is filled
  from — and `sufficient` is that count against the floor.
- **`analyzed`** is the same for the newest run that **ended having judged its corpus**
  (`AnalysisRepository.latestJudged`: `complete` or `budget_exceeded`, with #516's confidence
  basis in its manifest) — the population the result reads draw from — or `null`. A run in
  flight, a failed one and one that stored no basis are not counted.
- **Nothing is refused on account of it.** An analysis may be started on a corpus below the
  floor; the page withholds its results. A repository the workspace has none of reads as an empty
  corpus nothing analysed.
- **Suite.** `corpus.service.spec.ts`, `corpus.contract.spec.ts`, and against real rows
  `corpus.state.integration-spec.ts` (what is and is not inside the window, the tenth day, which
  runs count as judged, a viewer's read) and the isolation suite's claim.

**The drafted-tickets card** (BW.4, [#519](https://github.com/NobuData/ouroboros/issues/519),
[`tickets/`](src/modules/analyzer/tickets)) is the read behind mockup 18's **Drafted tickets — from
patterns, not people**: `GET /api/v1/analyzer/tickets?repo=`, any member. It is a view onto
ordinary planning batches, not a second drafting system — nothing here sizes, edits or pushes.
- **Two lists.** `undrafted` are the `ticket_draft` suggestions still `open` and still current —
  what `POST …/suggestions/draft` turns into a batch. `batches` are the planning batches the
  current ticket suggestions were drafted into, newest first. *Current* is the suggestion cards'
  rule, one shared predicate (`STILL_CURRENT`); a spike's batch is the suggestion cards', not
  this card's.
- **The batch is planning's.** Each is read through `BatchesService.read` and answered as
  `GET /planning/batches/{batch}` answers it: every draft it holds — a push files every selected
  one — with its checkbox, its estimate, its push state and the estimator-summed footer. Selecting
  and editing are planning's `PATCH …/drafts/{key}`; pushing is `POST /analyzer/batches/{id}/push`.
- **Evidence is read from the body.** A draft is a title and a body, and the body is what a push
  files, so `draftEvidence` (`actions/ticket.drafts.ts`, the inverse of `ticketDraftOf`) reads the
  `**Evidence:**` line and the references listed under `**References:**` (a kind and a backticked
  id per line) back out of it as it stands now, and they are resolved like any finding's. An edit that kept them keeps
  them; a body rewritten without them answers `null` and none. A line that is not a well-formed
  reference — an id that is neither a uuid nor, for a `merge`, a commit sha — is prose: nothing a
  person typed reaches a typed lookup. The first 25 references are answered, with the total.
- **Suite.** `ticket.drafts.spec.ts` (the round trip, and what is not a reference),
  `tickets.resources.spec.ts`, `tickets.service.spec.ts`, `tickets.contract.spec.ts`, and against
  real rows `tickets.integration-spec.ts`: un-drafted → drafted, planning's edits answered, a push
  landing, what stays and what leaves, a second repository, a second workspace mirroring the same
  one, and the refused regeneration. Each predicate of both statements was removed in turn and
  turned the suite red — bar `status = 'drafted'`, which V081's check makes the same question as
  *has a batch*.

```bash
yarn test:integration src/modules/analyzer
```

### Mail

BJ.4 ([#440](https://github.com/NobuData/ouroboros/issues/440)), in
[`src/modules/mail/`](src/modules/mail). One seam for everything this service mails: the digest
today, invitations (#724) and the inbox digest (#463) later.

```ts
interface Mailer {
  readonly transport: "smtp" | "none";
  send(message: { to, subject, text, html, messageId?, headers? }): Promise<{ messageId }>;
}
```

`MailModule` provides it under the `MAILER` token, chosen once at boot. `OURO_SMTP_URL` set:
`SmtpMailer`, over `nodemailer` — the only file that names it — with explicit connection,
greeting and socket timeouts, sending as *Ouroboros* from `OURO_MAIL_FROM`. Unset: a mailer that
reports `none` and refuses to send, so "mail is not configured" is a state callers read rather
than a message silently dropped.

In development the server is **mailpit** (`docker compose --profile mail up -d mailpit`, or any
`--profile full` stack): SMTP on `localhost:1025`, the inbox at <http://localhost:8025>. It
relays nothing.

```bash
yarn test src/modules/mail
```

### PR page reads & head actions

AX.5 ([#361](https://github.com/NobuData/ouroboros/issues/361)), decisions **V5** and **V8**, in
[`src/modules/pull-requests/page/`](src/modules/pull-requests/page). Mockup 12's whole page in one
read, and its two composed head actions, over V065's `pr_approvals` and `pr_loop_returns`.

| route | what | who |
| ----- | ---- | --- |
| `GET /api/v1/pull-requests` | the workspace's PRs, newest update first, each with its latest revision's aggregate; `?state=verifying,blocked`, `?reviewRequested=true` (the needs-you feed), `?runId=a,b` (the PRs those runs opened — #363's by-run lookup), `limit`/`offset` | every member |
| `GET /api/v1/pull-requests/:id` | head, revisions **each with its own gate snapshot**, current gates, criteria (#359), files + diff excerpt, thread + open count, merge plan (#360), spend, review, loop return | every member |
| `POST …/return-to-loop` `{gates, revisionId?, note?, idempotencyKey?}` | AP.4's correction round (steer + stage retry) whose text is the selected red gates' evidence; records the expected attempt | member+ |
| `POST …/request-review` `{reviewer?}` | open the approval slot — human approval becomes required and pending; optional SPI `requestReview` | member+ |
| `POST …/approvals` `{decision, note?}` | approve or decline (a decline needs a note) on the latest revision; the gate re-evaluates | member+ |
| `POST …/thread/:entryId/resolve` `{reply?, mirror?}` | resolve a review-thread entry with the reply that resolves it; optionally mirror the reply to the host PR (#368) | member+ |

**Return to loop is not a new control path** (V5). It calls `ControlsService.correctionRound` — the
Mark & Route card's own composition (#332) — with `<gate_key>: <evidence>` per selected gate, in the
card's order, and the person's note after a blank line as `note: …`. Every selected gate must be red
on the revision (`422 pr_gate_not_red`); the revision defaults to the latest, and can be an earlier
one the gates card was scoped to. A queued control is recorded in `pr_loop_returns` with the current
stage's next attempt — the next revision's expectation; a rejected one (the run has finished) records
nothing.

**Request human review is a gate mutation.** It opens V065's approval slot — at most one open per PR,
so asking again answers the open one — under the PR's `for update` lock, then notifies the gate
engine (`approval_recorded`), which materializes `human_approval` as required (`… + review
requested`) and `pending`. The open slot is the PR's needs-you item until mockup 16's inbox (#461)
wraps it. A named `reviewer` is asked on the host; `requested`, `unsupported` or `failed` (with the
host's reason) is recorded on the slot and never fails the request. An approval answers the open
slot on the latest revision — opening one first when nobody asked — and the re-evaluation can flip
the aggregate to merge-ready (and an armed plan then merges). An answer counts only on the revision
it was given on. Audited as `pr_approval.requested`, `pr_approval.approved`, `pr_approval.declined`.

**Reply and resolve is one act, and one-way**
([#368](https://github.com/NobuData/ouroboros/issues/368), `page.thread.ts`). Under the PR's lock
it raises `resolved` on an entry and writes `reply` as its `resolution_body` — V057's lifecycle, so
*was blocking → "Addressed in attempt 4" → resolved* is written once. An entry already resolved is
`409 pr_thread_entry_resolved`; a `policy_bot` entry states a rule and is
`409 pr_thread_entry_not_resolvable`. **Nothing here authors an entry**: `author_kind`,
`author_name` and `simulated` are untouched, so the route cannot invent a reviewer. The PR may be in
any state. `mirror: true` posts the reply to the host PR (`page.mirror.ts`, keyed
`thread.<entryId>`, carrying the entry's `simulated` watermark) and needs a reply
(`422 pr_thread_mirror_needs_reply`); `posted` or `failed` with the host's reason is answered and
never fails the request. The row does not record who resolved it — the trail does: audited as
`pr_thread.resolved`, never with the reply.

**Every step of the strip is a join** (V4): a revision's `testAttempt` is the attempt its own
`test_suite` verdict cites; its `correction` is the classification on a case of the previous
revision's attempt and any loop return sent from it.

**When the host was last heard.** A PR's head — on the page and in the listing — carries
`syncedAt`: `pull_requests.synced_at` (V066), which **every** sync moves, including one that found
nothing new. `updatedAt` moves only when the PR changed, so it cannot tell a quiet PR from a stalled
sync; the stamp can, and it is what the PR page's sync-lag banner reads. The sync writes the stamp
alone when nothing changed, and V066's touch trigger leaves `updated_at` where it was, so the
listing's *newest update first* is unmoved by polling. `null` for a PR no sync has written — the
development seed's #514. Additive (AY.8, [#370](https://github.com/NobuData/ouroboros/issues/370),
REST 0.37.22).

**Spend is a grouping, not a counter** (V8): the run's whole ledger and its `task_kind = 'verify'`
share, both through `readSpendTotals`, against the budget stage's route cap (the console's rule).
**Unpriced is never `$0`** — a ledger with no prices is token counts and a `null` cost, and
`withinCap` is `null` whenever it cannot honestly be said.

### PR-plane suites & mutation checks

AX.6 ([#362](https://github.com/NobuData/ouroboros/issues/362)) covers the three PR-plane failures
that throw nothing: a merge re-check that stopped checking, a comment marker that stopped
deduplicating, and a gate engine that stopped re-judging. The suites run under
`yarn test:integration`, beside AX.1–AX.5's own suites:

| Suite | Holds |
| ----- | ----- |
| `pull-requests/pr-plane.integration-spec.ts` | **TOCTOU**: gate flips red, a new revision recorded, the host's head moved, host conflict, branch protection — each disarms with its reason and nothing merges (plus a control case that merges). **Publish**: evidence summaries and waiver annotations edited under their keys across repeated publishes and the merge. **Gates**: 7 gates × 6 verdicts through V056's aggregate and the engine's; a synced push is a new snapshot, and the prior one is left intact; a headerless new file is license-red with the file named. **Head actions**: the steer and transcript equal the selected gates' evidence; review requests flip human approval, ask the host and list the PR as needs-you. **Roles**: refusals held server-side. **Isolation**: every PR route, enumerated from the route table, `404`s another workspace |
| `pull-requests/pr-sync.integration-spec.ts` | also: a local edit of host-owned content is written back on the next sync; concurrent syncs mirror once, and V052 refuses a second mirror; a re-sync with nothing new moves `synced_at` and leaves `updated_at` where it was (#370) |
| `ticket-sources/providers/github.pr.integration-spec.ts` | also: on recorded GitHub, three publishes under two keys are two POSTs and four PATCHes |

The scene (`pull-requests/pr-plane.integration.fixture.ts`) is mockup 12's PR on the in-memory git
host. It reaches the host through **the application's own services**: the harness replaces the
ticket-source registry and nothing else, and swaps in a fresh host for each case.

**Mutation checks.** Removing the mechanism turns the named test red:

| Remove | Red test |
| ------ | -------- |
| the re-check's `gate_red` branch (`recheckVerification`) | `disarms, never merges, when a gate flips red between arm and fire` |
| the comment marker (`withPrCommentMarker`) | `edits the evidence summary across repeated publishes…`, `keeps one comment per key…` (fake and recorded GitHub) |
| the sync's gate-engine notification (`PrSyncService.sync`) | `judges a revision synced from the host as a new snapshot, leaving the prior one intact` |

```bash
env -u OURO_DATABASE_URL yarn test:integration src/modules/pull-requests
```

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
│       ├── onboarding/     # the Get Started wizard — derived rail, guards · #385; first-issue picker · #387; launcher, smart defaults · #388
│       ├── detection/      # repo detection — rule packs over the probe SPI · #384
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
│       ├── replay-estimates/ # POST /internal/dry-runs/:id/replay-estimates — infra estimates from farm and test history · #561
│       ├── research/       # POST /research/estimates — sources & cost, researcher pill · #622
│       │   ├── briefs/     # a brief, read: GET /research/investigations/:id/{brief,sources,brief/export}, the matrix builder, severity rule, proposed-from-gaps, Markdown export · #621
│       │   ├── lifecycle/  # an investigation's public lifecycle: POST/GET /research/investigations, /:id, /:id/cancel, /:id/progress (SSE), /research/settings · #625
│       │   ├── pipeline/   # gaps → Planning draft epic; brief → create-roadmap → ROADMAP.md PR → suggestions → create-issues → writeback → drift check · #624
│       │   ├── watch/      # the regression watch: baselines, nightly comparison, bisect → forensics → fix draft chain, /research/regression-watch · #623
│       │   ├── loop/       # the investigation loop's control-plane half — /internal/research/investigations/:id/{start,checkpoint,brief,finish}, dispatch, cancel, the resume pass · #620
│       │   ├── telemetry/  # the telemetry tool's reads: windows, re-runnable telemetry:// locators, readings (ok | no_data), the read-only repository · #619
│       │   └── tools/      # ResearchToolAdapter SPI, registry, conformance kit, POST /internal/research/tools/:slug/:op · #614
│       │                   #   estimate.calibration.ts — the versioned constants
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
│       ├── github/         # the workspace's GitHub token + the API client   · #101
│       │                   #   PUT/DELETE/GET /settings/github-token — owner & admin only
│       │                   #   github.octokit.ts is the only file that may import @octokit/*
│       ├── backlog-sync/   # the poller that fills github_issues            · #102
│       │                   #   no controller — the routes are backlog/'s (#113)
│       ├── backlog/        # GET /backlog/sync-status · POST /backlog/sync   · #113
│       │                   #   the freshness tag's data, and the debounced trigger
│       │                   #   no loop — the cycle it drives is backlog-sync/'s
│       ├── estimation/     # unsized -> estimating -> sized | needs_human   · #107
│       │                   #   bounded queue · versioned writes · recovery sweep
│       │                   #   POST /backlog/{id}/estimate · /backlog/estimate-all (#108)
│       │                   #   member+ · admin+ · 30/min per workspace, sliding
│       ├── ticket-sources/ # the TicketSourceProvider SPI, registry, sync loop · #139
│       │   ├── sources.*   # the management API — /api/v1/sources, the catalog, test, sync · #141
│       │   └── providers/  # the GitHub provider — the first conforming plugin · #140
│       │                   #   providers/ is where a provider lives — lint-enforced,
│       │                   #   and empty until Q.3 (#140) registers the GitHub one
│       │                   #   no controller — the management API is Q.4 (#141)
│       ├── workflows/      # the workflow DSL: zod validator + YAML projection · #133
│       │                   #   stats.* — the rail's captions, stage counts, usage share · #135
│       │                   #   registry.service.ts — which workflows a workspace may name
│       │                   #   the lifecycle API: /api/v1/workflows, 7 operations   · #134
│       │                   #   draft.etag.ts — the If-Match guard; publish.gate.ts — zod + engine
│       │                   #   trigger.* — which workflow claims a queued ticket, and its pin · #143
│       │                   #   validates against ../../schemas/workflow-dsl/v1.json
│       ├── farm/           # the build farm's identity layer               · #250
│       │                   #   /farm/enrollment-tokens · /farm/registrations · /farm/authority
│       │                   #   farm.authority.ts — the ONE file that may unwrap a CA key
│       │                   #   runner.identity.ts — the handshake check AH.3 (#251) shares
│       │                   #   x509/ — DER in, DER out; no dependency on anything above it
│       │                   #   no-ca-key-escape.mjs — the lint rule that keeps the key in
│       │   ├── protocol/   # the runner protocol codec, held to schemas/runner-protocol · #251
│       │   ├── gateway/    # wss://…/api/v1/farm/agent — sessions, presence, resume  · #251
│       │   │               #   transport.ts — the upgrade's identity; agent.connection.ts —
│       │   │               #   one session's protocol; gateway.repository.ts — the ledger
│       │   ├── fleet/      # GET /farm — the page, its stats and the ⋯ menu          · #254
│       │   │               #   fleet.stats.ts — where null stops being zero
│       │   │               #   fleet.policy.ts — the day boundary, last week, B5's label
│       │   ├── config/     # /farm/pool-windows · /farm/job-hooks — what Apply composes · #514
│       │   └── installer/  # /install.sh · /runner/<version>/<file> — the agent's installer · #248
│       ├── pull-requests/  # the PR plane: SPI sync (#357), gates/ (#358)
│       │                   #   criteria/ — claims, typed evidence, verify, waive + annotate · #359
│       │                   #   merge/ — arm, TOCTOU re-check, merge, actions, evidence comment · #360
│       │                   #   page/ — the page read, return-to-loop, request-review, approvals · #361
│       ├── triage/         # Mark & Route: hints, classify, re-run, waive  · #332
│       │                   #   triage.rules.ts — the three heuristic rules, pure
│       │                   #   triage.contract.ts — /v0/triage, held to schemas/triage/v0.json
│       ├── retention/        # data-retention tiers, the cutoffs every sweep reads · #482
│       ├── test-results-read/ # the Test Results page's reads, downloads, retention · #333
│       │                   #   results.strip.ts — ▲ deltas, T8's activation state, pure
│       │                   #   artifact.serving.ts — type, inline or attachment, safe headers
│       │                   #   artifact.retention.ts — the hourly sweep that leaves tombstones
│       ├── test-plane/     # suites only: the failing-HIL scenario + isolation     · #334
│       ├── analyzer/       # Build Analyzer runs: triggers, guard, orchestrator  · #510
│       │   ├── composer/   #   findings → suggestions: templates, impact, confidence · #513
│       │   ├── actions/    #   preview · apply · dismiss · draft · push, through the planes · #514
│       │   ├── measurement/ #  the 14-day job, confounds, bounded calibration, the read · #515
│       │   └── duration/   #   the annotated chart's read: series, change-points, evidence · #517
│       │                   #   corpus/ — bounded, paged readers, log tails, the manifest,
│       │                   #   and the corpus-state read (the floor an analysis needs) · #521
│       └── internal/       # /internal/* — the engine-facing surface       · #224
│                           #   lease (local providers only) + the invoke contract
├── Dockerfile              # the production image — built from the *repo root*
├── Dockerfile.dockerignore # …and the context that image is built from
├── scripts/openapi.mjs     # `yarn openapi` — renders the JSON from the YAML
├── openapi.yaml            # the API specification — authoritative, hand-written
├── openapi.json            # rendered from it; the copy the service loads
├── openapi.internal.yaml   # the engine-facing contract — authoritative      · #224
├── openapi.internal.json   # rendered from it; read by AF.1/AF.2, served nowhere
├── .dependency-cruiser.cjs # the provider and Octokit boundaries — `yarn lint` runs them · #216 #101
├── eslint.config.mjs       # flat config; Prettier runs as a lint rule
├── jest.config.mjs         # unit suite — src/**/*.spec.ts, starts nothing
├── jest.integration.config.mjs  # src/**/*.integration-spec.ts, on a container it starts
├── jest.esm-transform.cjs  # the ES-module dependencies the suites load for real  · #701 #101
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
the run rather than a module ([#37](https://github.com/NobuData/ouroboros/issues/37)). Its
run-level pieces, each a `*.fixture.ts` and therefore excluded from the build alongside the
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
| `engine.stub.fixture.ts`      | `ouroboros-engine` on a loopback port, holding itself to the engine's published contract |

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
research scope & cost estimation [#622](https://github.com/NobuData/ouroboros/issues/622) ·
the model registry [#189](https://github.com/NobuData/ouroboros/issues/189) ·
provider health [#196](https://github.com/NobuData/ouroboros/issues/196) ·
provider adapters [#216](https://github.com/NobuData/ouroboros/issues/216) ·
the Anthropic adapter [#217](https://github.com/NobuData/ouroboros/issues/217) ·
the OpenAI-compatible adapter [#218](https://github.com/NobuData/ouroboros/issues/218) ·
the Ollama adapter and server-side pulls [#219](https://github.com/NobuData/ouroboros/issues/219) ·
the Copilot & Cursor adapters [#220](https://github.com/NobuData/ouroboros/issues/220) ·
the credential lifecycle [#223](https://github.com/NobuData/ouroboros/issues/223) ·
the credential audit trail [#225](https://github.com/NobuData/ouroboros/issues/225) ·
the GitHub token and API client [#101](https://github.com/NobuData/ouroboros/issues/101) ·
the backlog sync [#102](https://github.com/NobuData/ouroboros/issues/102) ·
the sync status and manual re-sync [#113](https://github.com/NobuData/ouroboros/issues/113) ·
the estimation pipeline [#107](https://github.com/NobuData/ouroboros/issues/107) ·
the re-estimation endpoints [#108](https://github.com/NobuData/ouroboros/issues/108) ·
the estimation contract it calls [#105](https://github.com/NobuData/ouroboros/issues/105) ·
the workflow DSL and its shared validation [#133](https://github.com/NobuData/ouroboros/issues/133) ·
the workflow rail's statistics and registry [#135](https://github.com/NobuData/ouroboros/issues/135) ·
the ticket-source SPI, registry and sync loop [#139](https://github.com/NobuData/ouroboros/issues/139) ·
the PR gate engine and its providers [#358](https://github.com/NobuData/ouroboros/issues/358) ·
the build farm's enrollment API and runner CA [#250](https://github.com/NobuData/ouroboros/issues/250) ·
the runner installer, served from this deployment [#248](https://github.com/NobuData/ouroboros/issues/248) ·
the farm schema it writes [#249](https://github.com/NobuData/ouroboros/issues/249) ·
the farm page, its stats and lifecycle actions [#254](https://github.com/NobuData/ouroboros/issues/254) ·
the canonical ticket model it writes [#138](https://github.com/NobuData/ouroboros/issues/138) ·
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
