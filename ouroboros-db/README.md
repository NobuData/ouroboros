# ouroboros-db

> **Status:** the Flyway project is complete.
> [#10](https://github.com/NobuData/ouroboros/issues/10) added `migrations/` and the
> repo-root compose stack that applies it;
> [#19](https://github.com/NobuData/ouroboros/issues/19) added
> [`flyway.toml`](flyway.toml) — where every setting now lives, for the stack and for a
> hand-run migration alike — the [`scripts/`](scripts) commands, and
> [`tests/`](tests). The tenancy tables themselves start at `V001`
> ([#20](https://github.com/NobuData/ouroboros/issues/20) onwards) — `V001` (tenants and
> domains), `V002` (users, identities and membership) and `V003` (GitHub enablement) have
> all landed, and [`tests/constraints.sql`](tests/constraints.sql) asserts what they
> enforce. `V004` ([#706](https://github.com/NobuData/ouroboros/issues/706)) adds
> BetterAuth's four core tables and back-fills them from `V002` — see
> [The two generations of user table](#the-two-generations-of-user-table), and note that
> `"user"` is quoted everywhere because it is a reserved word. `V005`
> ([#707](https://github.com/NobuData/ouroboros/issues/707)) adds the organization
> plugin's `organization`, `member` and `invitation`, and the column that makes tenancy
> server state — see [The tenant pointer](#the-tenant-pointer). `V006`
> ([#708](https://github.com/NobuData/ouroboros/issues/708)) is the cut-over: it moves
> the tenancy rows into those tables, re-parents `tenant_domains` and `github_orgs`
> onto `organization_id`, and **drops `tenants`, `tenant_members`, `users` and
> `user_identities`** — see
> [The two generations of user table](#the-two-generations-of-user-table) for why that
> chapter is closed, and [`tests/rehearsal/`](tests/rehearsal) for the standing
> rehearsal `ci/db` runs it through.
> [#23](https://github.com/NobuData/ouroboros/issues/23) added the dev seed —
> [`migrations/R__dev_seed.sql`](migrations/R__dev_seed.sql), the demo workspace every
> mockup is drawn around, in a development database and nowhere else. And
> [#24](https://github.com/NobuData/ouroboros/issues/24) turned all of that into a gate:
> `ci/db` now starts a throwaway PostgreSQL on every pull request, migrates it from
> empty, validates it, and runs both `.sql` suites against the result — see
> [Continuous integration](#continuous-integration). What that pass proves is now also
> what ships: [`Dockerfile`](Dockerfile) is this module as a one-shot migration task, and
> `publish/db` pushes it once `ci/db` is green on `main` — see [The image](#the-image).
> Five product tables have landed on that base since the cut-over: `V007`
> ([#649](https://github.com/NobuData/ouroboros/issues/649)) adds `user_preferences`, the
> per-person font scale, and `V008`
> ([#64](https://github.com/NobuData/ouroboros/issues/64)), `V009`
> ([#65](https://github.com/NobuData/ouroboros/issues/65)), `V010`
> ([#66](https://github.com/NobuData/ouroboros/issues/66)) and `V011`
> ([#67](https://github.com/NobuData/ouroboros/issues/67)) add the whole of the
> **dashboard read-model** — `runs`, the entity mockup 02's stat row, *Active loops*
> and *Recently closed* cards are all views over, `queue_items`, the ordered queue behind
> *Up next in queue* and the *Queued issues* estimate, `token_usage`, the append-only
> spend ledger behind *Token spend · today* (with `token_usage_daily`, this schema's first
> view), and `workspace_settings`, the org-scoped home of the **Auto-merge when checks
> pass** switch — the page's only *write*, read through
> `workspace_settings_effective`. Each carries its own section in
> [`tests/constraints.sql`](tests/constraints.sql). With all four in place,
> [#68](https://github.com/NobuData/ouroboros/issues/68) fills them:
> [`migrations/R__dev_seed_dashboard.sql`](migrations/R__dev_seed_dashboard.sql) is
> **mockup 02 as rows** — every figure that screen renders, reproduced from data rather
> than asserted by a mock — and the personal workspace deliberately left empty as the
> zero-state fixture. See [The development seed](#the-development-seed).
> `V012` ([#580](https://github.com/NobuData/ouroboros/issues/580)) opens the **model
> registry** with `model_prices`, the pricing catalog mockup 21's `$ per 1M in·out`
> column is rendered from — and the first migration that ships *product* rows rather than
> dev-only ones:
> [`migrations/R__model_price_catalog.sql`](migrations/R__model_price_catalog.sql) applies
> a vendored, pinned snapshot of upstream prices in every environment, development and
> production alike. See [The bundled price catalog](#the-bundled-price-catalog).
> `V014` ([#99](https://github.com/NobuData/ouroboros/issues/99)) opens the **intake**
> read-model with `github_issues`, the mirror mockup 03's backlog table and detail panel
> are rendered from, and the per-repo sync cursor the incremental poller writes onto
> `github_repos`. It is the one migration that reads as a table you could let somebody
> edit and is not: decision **K3** makes it a *cache* whose source of truth is GitHub, and
> its header says so at the top for the reader who arrives with an `update` in mind. It is
> also the one migration that takes an extension — `pg_trgm`, so the backlog's search box
> is an index scan rather than a scan of every title; the header argues why `V001`'s
> no-extensions posture does not reach it.
> `V015` ([#189](https://github.com/NobuData/ouroboros/issues/189)) opens the **routing**
> domain with `provider_connections` and `model_aliases` — where a workspace's model
> providers are, and the names its routes are allowed to use. It is the one migration
> written for two roadmaps that have not started: decision **M2** makes it the shared
> foundation mockup 07 (*Providers & keys*) and mockup 21 (*Model registry*) will build
> their management UIs on, so the schema, its constraints and `ouroboros-rest`'s
> resolution accessors land here and every CRUD surface stays with them. Two of its
> rules are worth knowing before reading it: `model_aliases.model_id` is the **only**
> column in this schema where a raw provider model string may live (decision **M1**), and
> `provider_connections.credentials_encrypted` accepts an `ouro.v1.…` envelope and
> nothing else — so a plaintext API key cannot be stored in it by any writer.
> `V016` ([#190](https://github.com/NobuData/ouroboros/issues/190)) builds the routing
> matrix on top of it: `task_kinds`, `routes` and ordered `route_hops`. It is the one
> migration where **ordering is a correctness rule rather than a convention** — hop
> positions are unique *and* dense from 1, because `floor_hop_index` is a rule about a hop
> *number* and a chain that numbers itself 1, 2, 5 makes *"fail instead of degrading below
> fallback 2"* mean nothing. Both ordering rules are deferred to `commit`, so a drag-reorder
> is plain SQL with no ceremony in it; the header carries the transaction Z.2 is meant to
> inherit rather than reinvent. It is also where decision **M1** stops being a statement and
> becomes structural: a hop names a `model_aliases` row, and there is no column in any of
> the three tables a raw provider model string could be put in.
> `V018` ([#191](https://github.com/NobuData/ouroboros/issues/191)) finishes the routing
> foundation with `escalation_rules` — mockup 06's *"effort ≥ L → implement uses coder-max
> (max thinking)"* stored as a **structured predicate**, not as that sentence. `"when"` is
> the WF-P8 predicate grammar scoped to routing, `"then"` is one of exactly three route
> modifications, and `display` — the sentence the card prints — is a **stored generated
> column** derived from the pair, so a hand-written one is refused by PostgreSQL itself and
> the text can never drift from what the rule does. Both predicate columns are **domains**
> rather than table CHECKs, which is what puts the grammar's refusal *before* the
> derivation runs.
> `V019` ([#579](https://github.com/NobuData/ouroboros/issues/579)) opens the **model
> registry's management surface** by growing `V015`'s `model_aliases` rather than forking it
> — the enable switch, the **unbound** binding, and params that cannot lie. Three things
> arrive together and each is a rule the schema now holds rather than a service promising
> it: `enabled` is mockup 21's `On` switch and is neither provider health nor a delete;
> `provider_connection_id` becomes **nullable**, where null is an alias created ahead of its
> key; and a CHECK makes those two inseparable — `provider_connection_id is not null or
> enabled = false`, so an unbound alias can never be switched on and no service path can
> race past it. `params` stops being free-form and becomes a **closed vocabulary**
> (`thinking`, `token_budget`, `temperature`, `max_output`, `context_clamp`), joined by a
> `restrictions` document carrying the two registry-policy flags, because mockup 21's chips
> are *derived from* those documents and a derivation over free-form jsonb either drops what
> it cannot read or prints it raw. What this layer deliberately does **not** do is decide
> whether a well-formed param means anything for the bound model: that reads the adapter's
> schema and `provider_models`, neither of which a CHECK may look at, and it is CH.2's
> ([#585](https://github.com/NobuData/ouroboros/issues/585)).
> `V020` ([#192](https://github.com/NobuData/ouroboros/issues/192)) closes the routing
> foundation with the two facts a spend event had to carry before mockup 06's `$/run avg`
> and `p50 latency` columns could be *computed* rather than stored: `token_usage.task_kind`
> and `token_usage.latency_ms`. It is the smallest migration in the schema and the one that
> makes decision **M7** reachable — a ledger row already knew which *model* it paid for and
> never which *kind of work* it was doing, so a per-kind average had nothing to group by and
> a per-kind median had nothing to take the median of. Both columns are nullable and null is
> the load-bearing state: an aggregate over no rows is null, which renders the em-dash the
> rule requires rather than a `$0.00` and a `0.0s` nobody measured. `task_kind` is
> deliberately **text with no foreign key**, on `V008`'s decision **F8** precedent — a ledger
> records what happened, and retiring a task kind must not block, delete or rewrite the
> history routed under it. With it in place
> [`migrations/R__dev_seed_routing.sql`](migrations/R__dev_seed_routing.sql) is **mockup 06
> as rows** — seven aliases, eight kinds, their chains, three rules and the 370 routed calls
> every number on the screen is aggregated out of, with not one of those numbers stored
> anywhere. See [The development seed](#the-development-seed).
> `V021` ([#195](https://github.com/NobuData/ouroboros/issues/195)) adds the table `V016`
> anticipated in as many words — *"when versioned route configuration arrives it is history in
> a table of its own"*. Mockup 06's editing model is **staged**: edits accumulate in the
> browser and commit when somebody presses **Save routes**, and that press deserves a record,
> because *"somebody saved the routes at some point"* is not an answer to *"why did last
> Tuesday's runs go to the fallback provider"* — and it is the only answer `routes.updated_by`
> and `updated_at` can give, since both are overwritten by the next save. `route_revisions` is
> three facts and no more: an **actor** (`on delete set null`, so deleting the person does not
> delete the record of what they changed), a **stamp**, and a **diff** —
> `{routes: [{task_kind, changes: {<column>: {from, to}}}]}`, whose shape is CHECKed by
> `ouroboros.route_revision_diff_valid()` so that the audit log
> ([#26](https://github.com/NobuData/ouroboros/issues/26)) is not left reading a union of
> whatever four services happened to write. It is **history, not versions**: a revision records
> what changed rather than a copy of the route as it then stood, which is smaller, is the
> question anybody actually asks, and is why it names its routes by `task_kinds.name` and its
> hops by `model_aliases.alias` rather than by ids that may since have been repointed. Two
> consequences are structural rather than conventional: there is **no `updated_at`** and no
> touch trigger, because an event that can be edited is not one; and a save that changed
> nothing is **unstorable**, because `routes` and every `changes` must be non-empty — an audit
> trail whose rows mostly say *somebody pressed Save and nothing moved* is one nobody reads to
> the end.
> `V022` ([#225](https://github.com/NobuData/ouroboros/issues/225)) adds `audit_events` — and
> it is the one migration in this project that **lands somebody else's table**. Scaffolding
> [#26](https://github.com/NobuData/ouroboros/issues/26) specified it for the platform's audit
> log and is v2; AD.4 is MVP, because a page that reveals and rotates credentials while keeping
> no record of who did it fails its own stated security posture, and *"we'll add audit later"*
> means the first months of a credential store's history are simply gone. Two tables would have
> been the cheap way out of that ordering, so the coordination was made at filing time and is
> recorded in the migration's header: the shape is #26's column for column — tenant fk, nullable
> actor fk, action, subject type/id, jsonb detail, `occurred_at` — with one addition that issue
> did not name, `ip`, and #26 will inherit the table rather than create a second one.
> It is the schema's first **append-only** table in the database rather than by convention, and
> that takes two mechanisms because neither covers the other's case: `ouroboros_app` — a role
> this migration creates, `nologin` and unprivileged — is granted `select` and `insert` and
> nothing else, and `audit_events_no_update` refuses a revision from **any** role including the
> owner this stack connects as, since a superuser bypasses every grant in the catalogue and a
> rule that is true in production and false on a developer's machine is a rule nobody can test.
> Both of its foreign keys shape that trigger: `organization_id` cascades, which is why the
> trigger covers `update` and not `delete` — a delete-refusing trigger would not protect the
> trail, it would make removing a workspace impossible — and `actor_id`'s `on delete set null`
> *is* an update, so exactly that one statement is permitted and nothing beside it. The
> guarantee is therefore stated precisely rather than approximately: **what happened cannot be
> rewritten; who did it can be forgotten.** The invariant that matters most is enforced outside
> the schema, and the header says why: a CHECK against secret material could only pattern-match
> the credential shapes somebody thought of, so `detail` is built from a closed field set by
> `ouroboros-rest`'s audit module and grep-tested — here too, in `tests/seed.sql`, over the rows
> the seed writes.
> [`migrations/R__dev_seed_audit.sql`](migrations/R__dev_seed_audit.sql) is the fifth seed and
> the fixture mockup 07's **Audit log** sheet is drawn against: fourteen events covering every
> action in the vocabulary, including the three a renderer would otherwise meet for the first
> time in production — a failed rotation, a lease grant with **no actor**, and a worker's
> cluster address rather than a person's.
> `V023` ([#581](https://github.com/NobuData/ouroboros/issues/581)) adds
> [`alias_references`](migrations/V023__alias_reference_index.sql), the schema's third view
> and the one answer to *"what references this alias?"* that mockup 21 asks four times on one
> screen — the `USED BY` column, the inspector's chip list, the blocked **Remove** button and
> the rename beside it. The reference lives in four incompatible shapes: a `route_hops`
> **foreign key** (`V016`), an escalation rule's target **inside a jsonb document** (`V018`),
> a workflow `llm` node's alias **by name inside a versioned document**, and a chat route pin
> that does not exist yet — so decision **R5** refuses a stored counter, because four writers
> two of which write jsonb is exactly where a trigger-maintained count goes quietly wrong,
> and a wrong count here is a delete guard that lets a referenced alias vanish. `Used by` is
> therefore `count(*)` over this view and the mockup's `0 routes` is a **left join**, not a
> zero anybody stores. Two of the four legs are live and two are **declared and unbuilt**:
> `workflow` needs WF-P.1 ([#132](https://github.com/NobuData/ouroboros/issues/132)) and the
> P.2 amendment CH.6 ([#589](https://github.com/NobuData/ouroboros/issues/589)) carries, and
> `chat_pin` needs BZ.3 ([#537](https://github.com/NobuData/ouroboros/issues/537)) — while
> absent each contributes zero rows and never errors, the `alias_reference_kind` domain names
> all four so the output shape does not change when they arrive, and the migration's header
> carries the `create or replace view` that adds each. The other half is
> `alias_reference_guard()`, and it is a **lock before a count** rather than a count: check
> then delete is two statements, and between them a concurrent route save adds the hop the
> check did not see. It takes `for update` on the alias — not `for share`, because a hop
> insert takes `for key share` to satisfy its own foreign key and `for key share` does not
> conflict with `for share` — so the referrer list CH.1
> ([#584](https://github.com/NobuData/ouroboros/issues/584)) renders into a 409 is still true
> when the statement after it runs. A race needs two sessions, which `constraints.sql` does
> not have, so that half is proven by
> [`tests/verify-alias-reference-guard.sh`](tests/verify-alias-reference-guard.sh) — see
> [Proving the guard is a guard](#proving-the-guard-is-a-guard).

> **If you have a database from before `V002` landed, reset it.** `V002` filled a version
> number `V003` had already passed, so a database carrying `V003` sees a pending
> migration *below* its current version — which `validate` rejects, and `migrate`
> therefore refuses before applying anything:
>
> ```
> ERROR: Validate failed: Migrations have failed validation
> Detected resolved migration not applied to database: 002.
> ```
>
> `docker compose down -v && docker compose up` from the repo root, or
> `ouroboros-db/scripts/clean-dev` followed by `ouroboros-db/scripts/migrate` for a
> database the stack does not own. Nothing is lost that a dev seed will not put back.
> `outOfOrder` stays off in [`flyway.toml`](flyway.toml) rather than being loosened for
> one gap that cannot recur — every version through `V003` is now taken, and a database
> created from empty applies them in order and never meets this.

## Purpose

The **tenancy database** — the PostgreSQL schema every other module hangs off, and the
Flyway migrations that own it. Organizations and their sign-in domains, people and the
accounts they authenticate with, per-organization membership roles, sessions, and GitHub
org/repo enablement live here — and, since `V008`, the **read-model** the product renders
over that boundary: what the loop has been doing, one row per run, since `V009` what
it will do next, one row per queued issue, since `V010` what it has spent doing so,
one row per call, and since `V011` what each workspace has told the loop it may do
unattended, one row per organization. Since `V014` it also holds the **backlog those runs
are drawn from** — one row per mirrored GitHub issue, which is a cache and not a fork
(decision **K3**). Since `V015` it also holds the **model providers a workspace has
configured and the aliases its routes name** — the foundation mockups 06, 07 and 21 all
read, and the only place a raw provider model string lives (decision **M1**) — and since
`V016` the **routing matrix over them**: which kinds of work exist, the one route each has,
and the ordered chain of aliases that route falls back through — with `V018` adding the
**escalation rules that modify a route** when an issue is large, labelled or docs-only.

Flyway is the **sole owner of DDL**. No application module creates or alters tables;
`ouroboros-rest` reads and writes through Kysely against a schema this module defines.

## Stack

| Concern | Choice |
|---|---|
| Database | PostgreSQL 17 |
| Migrations | Flyway 13, run from its container — no local Java required |
| Language | Plain SQL (no templating, no ORM DSL) |
| Schema | `ouroboros` |
| Configuration | [`flyway.toml`](flyway.toml) — one file, read by every path |
| CI | `flyway migrate` + `validate` against a throwaway PostgreSQL |
| Image | [`Dockerfile`](Dockerfile) — the migrations as a one-shot task, published by `publish/db` |

## Run

### The database

The short way, from the **repo root**, is the same command that starts everything else:

```bash
yarn dev                      # this database, migrated, plus the application services
```

That runs [`scripts/dev`](scripts/dev) first and waits for it: PostgreSQL up, healthcheck
passed, migrations applied. Run it directly — `ouroboros-db/scripts/dev` — for the data
tier alone. It goes through the compose file for both halves, which is what guarantees
the migration lands in the database it just started; `run.sh` below is the tool for
migrating a database that is already running somewhere else.

The stack it drives comes from the repo-root compose file
([#10](https://github.com/NobuData/ouroboros/issues/10)), and is equally usable by hand.
Run these from the **repo root**, not from this directory:

```bash
docker compose up             # PostgreSQL 17 on :5432, migrations applied
docker compose up db          # the database alone, without a migration pass
docker compose down           # stop; the data survives
docker compose down -v        # reset — drops the volume and all data
```

`up` starts PostgreSQL, waits for its healthcheck, then runs `flyway migrate` and exits;
the database stays up. It is safe to repeat — Flyway applies only what is pending, so a
second `up` reports "no migration necessary". The stack is the one place the development
seed is switched on, so what it leaves behind is a database with the demo tenant in it —
see [The development seed](#the-development-seed). No `.env` file is needed: every value
has a development default. Copy the repo-root `.env.example` to `.env` to change any of
them.

Confirm what was applied by reading Flyway's own history table:

```bash
docker compose exec db psql -U ouroboros -d ouroboros \
  -c 'select version, description, success from ouroboros.flyway_schema_history
      order by installed_rank;'
```

Or connect from the host with the development credentials — user `ouroboros`, password
`ouroboros`, database `ouroboros` on port 5432:

```bash
PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros
```

A reset is `docker compose down -v` followed by `docker compose up`: the named volume is
dropped, PostgreSQL initialises an empty cluster, and every migration is applied again
from scratch.

If `up` fails with `bind: address already in use`, something else on the machine already
holds 5432 — a system PostgreSQL, or another project's stack. Publish this one somewhere
else instead of stopping that:

```bash
OURO_DB_PORT=45432 docker compose up
```

The port only changes where the database is published on the host; inside the compose
network it is always `db:5432`, and it is only ever published on `127.0.0.1`.

### The four commands

`docker compose up` migrates on the way up, which covers most days. These are for
everything else — a migration you just wrote against a database already running, a
PostgreSQL installed on your machine, a server across the network:

```bash
ouroboros-db/scripts/migrate     # apply what is pending
ouroboros-db/scripts/info        # applied and pending versions
ouroboros-db/scripts/validate    # checksums and naming rules
ouroboros-db/scripts/clean-dev   # drop everything — development databases only
```

They connect by host and port like any other client, so **nothing has to be
containerised**. Out of the box they point at `localhost:5432`, which is both a default
PostgreSQL install and — with the port the compose stack publishes — the compose
database. Point them anywhere else with the `OURO_*` variables below:

```bash
OURO_DB_PORT=45432 OURO_DB_SCHEMA=scratch ouroboros-db/scripts/info
```

`clean-dev` drops **every object in the schema**, which is the reset for a migration you
have edited after it was applied — `validate` will refuse that database until you do.
Three things stand in its way, and all three have to be got past deliberately:
`flyway.toml` disables `clean` outright, only [`flyway.dev.toml`](flyway.dev.toml)
re-enables it and only `clean-dev` loads that file, and `clean-dev` itself refuses any
host that is not this machine and asks for the database name back before it drops
anything:

```bash
ouroboros-db/scripts/clean-dev          # names the database, waits for you to type it
ouroboros-db/scripts/clean-dev --yes    # no prompt — scripted resets and CI
```

There is deliberately no `scripts/clean`.

### The development seed

`docker compose up` leaves a database with data in it: the demo content every screen in
[`../docs/mockups`](../docs/mockups) is drawn around — mockup 01 Step 2's three
organizations and mockup 02's dashboard, number for number — so a UI has something to
render and an e2e test has something to assert against by name.

It is **five migrations**, because they answer five questions and change on different
days:

| File | Holds | Issue |
|---|---|---|
| [`R__dev_seed.sql`](migrations/R__dev_seed.sql) | *Who exists* — the workspaces, the people, and where the loop may run | [#23](https://github.com/NobuData/ouroboros/issues/23) |
| [`R__dev_seed_dashboard.sql`](migrations/R__dev_seed_dashboard.sql) | *What the loop has done* — runs, queue, spend, and the auto-merge switch | [#68](https://github.com/NobuData/ouroboros/issues/68) |
| [`R__dev_seed_providers.sql`](migrations/R__dev_seed_providers.sql) | *What it is allowed to call* — mockup 07's five provider cards, their discovered models, and the spend behind their meters | [#221](https://github.com/NobuData/ouroboros/issues/221) |
| [`R__dev_seed_routing.sql`](migrations/R__dev_seed_routing.sql) | *How it decides which one to call* — mockup 06's aliases, task kinds, chains, escalation rules, and the routed calls its numbers are computed from | [#192](https://github.com/NobuData/ouroboros/issues/192) |
| [`R__dev_seed_audit.sql`](migrations/R__dev_seed_audit.sql) | *Who touched the keys* — the credential trail mockup 07's **Audit log** sheet opens, including a failed rotation and a lease grant with no actor | [#225](https://github.com/NobuData/ouroboros/issues/225) |

> **The names are load-bearing.** Flyway applies repeatable migrations in the order of
> their *descriptions*, and every row the later seeds write finds its parent by natural key —
> so `dev_seed_audit`, `dev_seed_dashboard`, `dev_seed_providers` and `dev_seed_routing` all
> have to sort after `dev_seed`, and `dev_seed_routing` after `dev_seed_providers` besides,
> since every alias binds to a connection by kind and name. They do. `tests/seed.test.sh`
> asserts the whole order, because the failure mode is silent: applied in the wrong order,
> every join finds nothing, every insert inserts nothing, and a second `migrate` does not put
> it right (Flyway re-applies a repeatable migration only when its checksum changes).
>
> **`dev_seed_audit` sorts *before* `dev_seed_providers`, and is the one seed that does not
> care.** Its events name their connections by literal uuid rather than by join, because
> `audit_events.subject_id` is deliberately non-referential — an event about a connection has
> to outlive the connection — so there is nothing to join to and nothing for the ordering to
> break. The alternative would have been a seed that finds nothing on the first pass and
> inserts on the second, which is exactly the non-convergence the rule above exists to
> prevent.

#### Who exists

| Row | Value |
|---|---|
| Organizations | `acme-robotics` — *Acme Robotics*, shared · `acme-labs` — *Acme Labs*, shared · `kensuenobu` — Ken's personal workspace (`metadata.personal = true`) |
| Domain | `acme-robotics.dev`, primary — the address domain mockup 01 resolves acme-robotics from |
| People | `ken@acme-robotics.dev` · `maya@acme-robotics.dev` · `jorge@acme-robotics.dev` |
| Roles | acme-robotics: Ken owner, Maya admin, Jorge member · acme-labs: Maya owner, Ken member · kensuenobu: Ken owner |
| Passwords | every person signs in with `ouroboros-dev-password` — a `credential` account holding a real scrypt hash BetterAuth's verifier accepts; the form only exists on a non-production stack |
| GitHub | one GitHub-shaped account, Ken's, so "Continue with GitHub" has someone deterministic to resolve to |
| Orgs | `acme-robotics` enabled · `acme-labs` disabled · `kensuenobu` enabled |
| Repos | acme-robotics: 4 enabled, incl. `helios-firmware` · acme-labs: none · kensuenobu: 2 enabled — all default branch `main` |

#### What the loop has done

All of it belongs to `acme-robotics`, and every window is relative to `now()`, so the
"today" and "seven day" arithmetic holds however long after the seed was written the stack
is brought up.

| Table | Rows | What mockup 02 renders from them |
|---|---|---|
| `runs` | 53 | 3 live (`#482` coding · `#479` building · `#476` in review), 50 closed — of which the four newest are the *Recently closed* card, `#474 → PR #512` … `#465 → PR #504` |
| `queue_items` | 12 | *Queued issues* `12`, `est. 9h 40m`, and the five the *Up next in queue* card draws — `#485` M, `#486` L, `#488` XS, `#490` XL, `#491` S |
| `token_usage` | 12 | *Token spend · today* — `4.2M` tokens, `≈ $18.60 across 4 providers`; the `≈` is the three unpriced local-inference events |
| `workspace_settings` | 1 | *Auto-merge when checks pass*, on |

The *Loop pulse* metrics are aggregates over the same runs: **92%** autonomous merge rate
(46 merged of the 50 closed), **14m 20s** average cycle time (over the 29 that closed in
the trailing seven days), **2** human interventions this week, and **27** merged in seven
days against **19** the week before — the `▲ 8`.

> **One of the card's numbers cannot be true of one seven-day window**, and the migration
> header says so at length rather than leaving #70 to find out: 27 merged and 2
> interventions make the trailing week's merge rate 93.1%, and no integer count of closed
> runs divides 27 into 92%. The seed makes 92% exact over the population it can — the whole
> fourteen days it spans, 46 of 50 — and states both figures.

#### What it may call

Mockup 07's five cards, and everything on one of them that is not a live API call. All of
it belongs to `acme-robotics`, and it is drawn from three tables:

| Table | Rows | What mockup 07 renders from them |
|---|---|---|
| `provider_connections` | 5 | The five cards — *Anthropic Claude* `$600` cap, *Cursor* `$120`, *GitHub Copilot* `$95` and *degraded upstream*, *OpenAI-compatible · local vLLM* and *Ollama · workstation* with no cap at all. Every switch is on; every meta row reads *Added by Ken · <date> · last used <minutes> ago* |
| `provider_models` | 11 | The chips — four Anthropic models carrying `"tier": "priority"`, one apiece for Cursor and Copilot, two `local/…` from vLLM — and the workstation's pull-list, `qwen3-coder:32b` `19 GB`, `llama4:scout` `63 GB`, `phi4:14b` `9.1 GB` |
| `token_usage` | 11 | The month's spend behind the meters, *earlier this month* |

> **The meters are three seeds added together.** A card's *This month* figure is calendar-
> month spend over `token_usage`; the dashboard seed writes twelve events dated *today* and
> the routing seed writes the month's routed calls. So the providers seed writes the
> remainder — `$379.15` of Anthropic, `$62.30` of Cursor, `$68.80` of Copilot and 1.0M
> unpriced Ollama tokens — and the three together are the mockup's `$412.80`, `$64.10`,
> `$76.00` and *2.1M tokens on-box*. Nothing the providers seed
> writes lands on *today*, which is what keeps mockup 02's *Token spend · today* card
> exactly the dashboard seed's twelve events; `tests/seed.sql` asserts both totals and the
> rule that keeps them apart. On the first of a month there is no *earlier this month*: the
> rows fall on the last day of the previous one and the meters read the day's spend alone,
> which is the one day in thirty the cards are not the mockup's figures — asserted as such
> rather than left to be discovered.

The three cloud connections carry a sealed `ouro.v1.…` credential whose body decodes to
*dev-seed-value-not-a-real-credential-…*: it is a well-formed envelope, so the card renders
its masked key row and V015's envelope-only rule is exercised by the data a developer
actually has, and it is **not decryptable** — a real one is AES-256-GCM under a workspace
DEK bound to the row's id, which no SQL file can produce. *Reveal* against a seeded
connection therefore fails in the designed way rather than showing a key. The two local
connections carry none, because a local provider needs none.

#### How it decides which one to call

Mockup 06's routing screen, and everything on it. All of it belongs to `acme-robotics`, and
it is drawn from six tables plus the connections above:

| Table | Rows | What mockup 06 renders from them |
|---|---|---|
| `model_aliases` | 7 | The pills and their grey resolution lines — `coder-max` → *claude-fable-5 · Anthropic*, `coder-fallback` → *gpt-5-codex · GitHub Copilot*, `local-docs`, `local-free`, `coder-std`, `sizer`, and `second-opinion`, which no chain contains and the *security label* rule adds as a vote |
| `task_kinds` | 8 | The matrix's eight rows, in its order — the mono name and the grey line under it |
| `routes` | 8 | Each row's tag pill, and the inspector's policy triple: local fallback **on**, no floor, and `$2.50` — a cap only `implement-primary` carries |
| `route_hops` | 17 | The *Primary model* and *Fallback* columns, and the inspector's numbered rail — `coder-max → coder-fallback → local-docs`, with the mockup's two hop notes |
| `escalation_rules` | 3 | The card's three sentences, which V018 **generates** from the rules' structure rather than storing |
| `token_usage` | 370 | The routed calls every number on the screen is aggregated out of |

> **Not one figure on that screen is stored, and that is decision M7.** `$0.87` is the mean
> of fifteen `implement` costs, `41.0s` the median of fifteen `implement` latencies,
> `$412.80` a sum across three seeds and *31%* a ratio of two sums — so the seed shapes the
> *usage* and lets the aggregation land on the mockup. Storing the answers instead would
> leave the stats service ([#198](https://github.com/NobuData/ouroboros/issues/198))
> untested and the em-dash rule unverifiable: a number that was never computed cannot be
> *absent* in the way the rule requires. Each kind's calls are spread symmetrically around
> its figure, so the mean is exactly the centre and the median is exactly the row at it, with
> no rounding anywhere. `tests/seed.test.sh` asserts the file carries none of the rendered
> figures as a literal; `tests/seed.sql` computes all sixteen of them back.

> **`$0.00` is a price, not an absence.** The two local kinds route to vLLM and Ollama, and
> their rows carry `cost_cents = 0` — calls that were priced, at nothing. The earlier seeds'
> Ollama rows carry `null`, which says the other thing: *nobody priced this*. Both states now
> exist in one workspace, which is what makes
> [#92](https://github.com/NobuData/ouroboros/issues/92)'s honesty rule testable rather than
> promised — a re-pricing pass must fill the nulls and leave the zeros alone.

> **Two of mockup 06's spend figures cannot be reached by any seed.** *Spend by provider ·
> 30d* asks for `$96.40` of Copilot and `$54.10` of Cursor, while mockup 07's cards pin the
> same rows' calendar month at `$76.00` and `$64.10`. Thirty days is a **superset** of
> month-to-date, so a 30-day total can never be less than the month total inside it, and
> Cursor's figure is `$10.00` below one. Anthropic's `$412.80` and the local `$0.00` land
> exactly; the other two land on mockup 07's, which is the reading both screens can hold at
> once, and [#192](https://github.com/NobuData/ouroboros/issues/192) asks for the design to be
> amended. The seed's header carries the arithmetic and `tests/seed.sql` asserts all four.

**Nothing the routing seed writes lands on *today*** either, and its priced spend comes *out
of* the providers seed's remainder rather than on top of it — so mockup 02's *Token spend ·
today* card and mockup 07's month meters both read exactly what they read without it.

**`kensuenobu` and `acme-labs` get no dashboard rows at all.** That is not an omission: the
personal workspace is the *empty-state fixture* the zero-state cards
([#86](https://github.com/NobuData/ouroboros/issues/86)) are rendered against, so switching
the active organization to it is how a developer sees the empty dashboard. **Neither gets a
provider connection either**, which is the same fixture for mockup 07's *connect your first
provider* guidance ([#233](https://github.com/NobuData/ouroboros/issues/233)). Neither gets a
`workspace_settings` row either, which keeps "answered no" and "never asked" distinguishable
— `workspace_settings_effective` resolves both to `false`, and only it says which.

Every seeded row carries an id beginning `5eed` —
`5eed0001-0000-4000-8000-000000000001` is the acme-robotics organization,
`5eed0009-…-000000000482` the run against issue `#482` — so demo data is recognisable on
sight in a log or a URL, and a test can name a row without looking it up. The workspace
seed lists all of its ids; the dashboard seed builds its seventy-seven from three
documented prefixes (`5eed0009…` runs, `5eed000a…` queue items, `5eed000b…` usage events)
and the issue number or ordinal of the row, which is as deterministic and rather more
readable than seventy-seven literals. The providers seed takes the three prefixes after
those — `5eed000c…` connections, `5eed000d…` discovered models, `5eed000e…` its own spend
events — which is also what keeps its usage rows and the dashboard's apart on sight in a
table both of them write. The routing seed takes the six after *those* — `5eed000f…`
aliases, `5eed0010…` task kinds, `5eed0011…` routes, `5eed0012…` hops, `5eed0013…` rules and
`5eed0014…` its own routed calls — so all three of the seeds that write `token_usage` are
told apart by the first two hex digits of a row's id.

**Neither can run against anything but a development database.** Each statement in either
seed ends `and ${ouro_dev_seed}`, a Flyway placeholder that is `false` in
[`flyway.toml`](flyway.toml) — the configuration `scripts/migrate`, CI and every
hand-run migration read. With it false the migration still applies and inserts nothing.
[`flyway.seed.toml`](flyway.seed.toml) is the one file that sets it `true`, the compose
stack is the one thing that loads it by itself, and this is the deliberate way to reach
it for a database the stack does not own:

```bash
ouroboros-db/scripts/migrate --config flyway.seed.toml
```

Both are repeatable migrations and both are idempotent: every id is fixed and every
statement ends `on conflict do nothing`, so applying either twice writes nothing the second
time and leaves even the timestamps alone. Child rows find their parent by slug, by email
or by repository name rather than by id, so a database somebody has edited by hand gets a
seed that re-creates what it can instead of failing.

> One consequence of Flyway's rules is worth knowing: a repeatable migration's checksum
> is taken of the file, *before* placeholders are substituted. A database that has
> already recorded these migrations un-seeded therefore does not pick the data up merely
> by being migrated again with the overlay — reachable only by pointing both
> configurations at the same database. `scripts/clean-dev` then a seeded `migrate` fixes
> it, or `docker compose down -v && docker compose up` for the stack's own database.

### The bundled price catalog

The other repeatable migration is not a seed, and it is the one piece of data this module
ships to **every** environment:
[`migrations/R__model_price_catalog.sql`](migrations/R__model_price_catalog.sql) fills
`model_prices` ([#580](https://github.com/NobuData/ouroboros/issues/580)) with what a
model costs, which is what mockup 21's `$ per 1M in·out` column renders and what
[#92](https://github.com/NobuData/ouroboros/issues/92)'s priced accounting will value
`token_usage` with.

It carries no `${ouro_dev_seed}` guard because it is not development data. A price is a
fact about the world, an air-gapped deployment needs it as much as a laptop does, and the
alternative — an empty column until somebody types a hundred models in — is the failure
mode [decision R4](migrations/V012__model_prices.sql) exists to avoid.

**Nothing reaches a network, at migration time or ever.** The catalog is data in the
repository, in three files with one direction of flow:

```
catalog/litellm-model-prices.json     a pruned extract of upstream, at a pinned commit
  └── scripts/price-catalog.mjs       the transform: per-token costs → cents per 1M
        └── migrations/R__model_price_catalog.sql   generated; one import call, rows as jsonb
```

```bash
ouroboros-db/scripts/price-catalog.mjs --check   # the migration is what the extract renders (ci/db)
ouroboros-db/scripts/price-catalog.mjs --write   # re-render it after the extract moves
ouroboros-db/scripts/price-catalog.mjs --vendor --commit <sha>   # refresh the pin — the only mode that downloads
```

The extract is a subset of
[LiteLLM's `model_prices_and_context_window.json`](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
(MIT — the licence is committed as `catalog/LICENSE.litellm`), pruned to the providers
this product can reach and the fields it keeps, so it can be diffed against upstream
directly. Every row it renders is stamped with a `catalog_version` naming that commit and
its date. Three rows are *not* upstream's — Copilot's `seat`, Cursor's `usage` and
Ollama's `free` — because upstream publishes no rate for a provider that has none; they
are stamped `meta.catalog_source = 'ouroboros'`.

Re-running it is safe by construction. `ouroboros.import_model_price_catalog()`, which is
all the generated file calls, returns `(inserted, updated, unchanged, deleted)`: the same
snapshot twice is `(0, 0, n, 0)` and writes nothing at all, a newer snapshot updates the
bundled rows and sweeps the ones it dropped, and **no organization's override is reachable
from it** — every row it writes is `organization_id null`, so there is no key it can
produce that collides with one. A workspace that corrects a price for itself does so in a
row of its own, and it survives every re-import:

```sql
insert into ouroboros.model_prices
  (organization_id, match_provider_kind, match_model, billing_mode,
   input_cents_per_1m, output_cents_per_1m, source)
values ('org-acme', 'anthropic', 'claude-fable-5', 'token', 1200, 6000, 'override');

select * from ouroboros.model_price('org-acme', 'anthropic', 'claude-fable-5');
```

`ouroboros.model_price(organization, provider kind, model)` is how everything reads this
table: it returns the one row that prices that pair — override over bundled, exact model
over family row — or **no row at all** when the catalog does not cover the model, which is
what the registry renders as `—`. It never returns a zero for a model whose price is
unknown, and that distinction is the point of the table: `—` says *we do not know*, `$0`
says *this is free*, and only one of them is safe to be wrong about.

### The runner underneath

Each command is a name for one [`run.sh`](run.sh) invocation; use `run.sh` directly for
anything the four do not cover, and pass its flags through any of them:

```bash
ouroboros-db/run.sh repair                    # any Flyway command
ouroboros-db/scripts/migrate --dry-run        # print the command, run nothing
ouroboros-db/scripts/migrate --runner docker  # force a runner instead of choosing one
ouroboros-db/run.sh --help                    # every flag, and what it reads
```

Flyway itself comes from whichever is available, and `--runner` overrides the choice:

| Runner | What it uses | When it is chosen |
|---|---|---|
| `flyway` | the `flyway` on your PATH | automatically, if you have one — no Docker at all |
| `docker` | the pinned `flyway/flyway:13` image | otherwise, so no local Java is needed |

When the container runs against a database on this machine it is given host networking,
because a server bound to loopback — which both a default PostgreSQL install and the
compose stack are — is not otherwise reachable from inside a container. Only what Flyway
reads is mounted into it, read-only: `flyway.toml` and `migrations/`.

Parameters come from `ouroboros-db/.env`, then the repo-root `.env`, then the defaults,
and anything already in the environment beats all three. Any argument the runner does
not recognise goes to Flyway untouched, and the password is never printed — not in the
progress line, not by `--dry-run`.

> `run.sh` migrates whatever `OURO_DB_HOST`/`OURO_DB_PORT` resolve to, and the default
> is `localhost:5432`. If you have a PostgreSQL of your own there, that is the one it
> will migrate. `--dry-run` prints the target without touching it.

### The tests

The module's tooling has its own suite — the runner and the four commands, exercised
against a synthetic module with both Flyway runners stubbed out, so it needs no database
and no Docker:

```bash
scripts/run-tests.sh ouroboros-db/tests   # this module's suite
scripts/run-tests.sh                      # every suite in the repository
```

`ci/db` runs it on every pull request that touches this directory, after
[`scripts/verify-dev-env.sh`](../scripts/verify-dev-env.sh).

The two `.sql` suites are the other half, and they are separate because they need the one
thing the suite above deliberately does without: a database with the migrations applied.
They share their assertion helpers through [`tests/lib/assert.sql`](tests/lib/assert.sql),
as the shell suites share [`../scripts/lib/checks.sh`](../scripts/lib/checks.sh).

[`tests/constraints.sql`](tests/constraints.sql) asserts what the schema *enforces* —
every uniqueness rule, check constraint, cascade, trigger and index the migrations claim
— because `validate` compares checksums rather than behaviour, and a `unique` on the
wrong columns passes it. [`tests/seed.sql`](tests/seed.sql) asserts the opposite side:
what the three `R__dev_seed*.sql` migrations actually put in a development database, one
assertion per row — the workspaces, mockup 02's dashboard number for number, and mockup
07's five provider cards with the meters their two seeds add up to.
Run them against a migrated database:

```bash
PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros \
  -v ON_ERROR_STOP=1 -f ouroboros-db/tests/constraints.sql
PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros \
  -v ON_ERROR_STOP=1 -f ouroboros-db/tests/seed.sql
```

`constraints.sql` creates its own fixtures inside a transaction and rolls back, so it
leaves no rows behind — including the seed's, which it clears and restores so its counts
mean what they say. `seed.sql` writes nothing at all. Both are safe to repeat against a
database that is already in use. `seed.sql` wants a database migrated *with* the seed
enabled and fails on the first assertion against one that is not, which is the answer it
should give; running it after two `migrate` passes is how "migrate twice changes nothing"
is checked, since every assertion in it says *exactly one*.

A passing run prints one line; a failure names the rule and exits non-zero, which is what
makes both a CI step — [#24](https://github.com/NobuData/ouroboros/issues/24) wires them
into `ci/db`, below. A migration that adds a rule adds its assertion in the same change.

`constraints.sql`'s last section belongs to no migration. Every assertion above it is
behavioural — a write the schema must refuse, attempted, and refused — and a behavioural
probe has one failure mode nothing can see from the outside: it can go **vacuous**, because
it depends on a fixture, and a fixture is a live thing that a later ticket can rename or
delete out from under it. So [#193](https://github.com/NobuData/ouroboros/issues/193)
enumerates the invariants routing resolution ([#194](https://github.com/NobuData/ouroboros/issues/194))
is *written against* rather than re-checks — hop ordering and density, one route per task
kind, the two `restrict` foreign keys, the rule `then` and `when` grammars, the provider
vocabularies, the floor-index bound — and asks the catalogue for each of them by name. It
asserts the **shape** where the shape is the rule: a foreign key is checked for `restrict`,
because a relaxation to `cascade` leaves the name exactly where it was. It deliberately does
not assert any rule's *body* — a CHECK's expression, a trigger function's source — because
those are legitimately rewritten, and a test that pins the wording of a rule fails on the
refactor rather than on the regression.

Both are **one session inside one transaction**, which is what
[Proving the guard is a guard](#proving-the-guard-is-a-guard) exists for: a rule about what
two concurrent writers may do to each other cannot be asserted by one of them.

### Proving the assertions are load-bearing

A green `constraints.sql` does not prove its assertions are doing anything. A file that
asserted nothing at all would be exactly as green, and so would one whose probes had
drifted off the constraints they were written for — the two are indistinguishable from the
outside. The only way to tell them apart is to break a rule on purpose and check that the
right probe goes red for the right reason.

[`tests/verify-constraint-probes.sh`](tests/verify-constraint-probes.sh) is that check for
the dashboard read-model ([#69](https://github.com/NobuData/ouroboros/issues/69)), the
provider cards ([#221](https://github.com/NobuData/ouroboros/issues/221)) and the routing
invariants ([#193](https://github.com/NobuData/ouroboros/issues/193)). It drops one rule at
a time — the `runs.status` and `queue_items.effort` vocabularies, the terminal-run rule, the
queue's position and issue keys, the `workspace_settings` primary key; the monthly cap's
floor, the discovered catalog's uniqueness, the `enabled` switch's `not null` and the health
vocabulary beside it, the `added_by` reference; the hop position key, the
one-route-per-task-kind key, the rule `then` grammar and the provider `kind` vocabulary —
and rewrites the expressions a rule lives in where no drop can falsify it: the two
`token_usage_daily` computes its sums from, and the two tests inside `route_chain_intact()`
that hold a chain dense from 1 and its floor inside it. For each, it requires the suite to
fail **and** to name the assertion that caught it: a bare non-zero status would also be
produced by a mutation that broke on its own statement.

Two of the routing mutations are *relaxations* rather than drops, and they are the ones
worth understanding. `route_hops_alias_fk` and `model_aliases_provider_fk` are re-added as
`on delete cascade`, because `restrict` → `cascade` is the refactor that really happens and
it leaves the constraint's name exactly where it was. Both fail **open**: the delete succeeds
and takes the dependent rows with it, so a provider removed on *Providers & keys* would empty
chains drawn on *Model routing*, and an alias retired in the model registry would shorten
every chain that named it — past the floor those chains were written against. That is the
class of regression a green suite cannot see, which is why it is probed rather than trusted.

```bash
PGPASSWORD=ouroboros ouroboros-db/tests/verify-constraint-probes.sh
```

It reads where to connect from `run.sh --print-target`, so the same `.env` precedence
applies; `PGPASSWORD` is the one thing it needs from the environment, because that is the
one thing `--print-target` will not print. Every mutation runs against a throwaway copy of
a template database it migrates for itself, inside a transaction that is never committed,
so it changes nothing that outlives the run — including the database you point it at. The
copy is what makes the runs *deterministic*: `constraints.sql` carries plan assertions, and
a plan is chosen from catalogue statistics rather than from the schema, so a database the
suite has already been run against and left dead rows in can plan differently once
autovacuum has recorded those tables as empty. A copy of a freshly migrated template always
has the statistics a freshly migrated database has.

### Proving the guard is a guard

`constraints.sql` is one session inside one transaction, and CG.3's delete guard
([#581](https://github.com/NobuData/ouroboros/issues/581)) is a rule about what a *second*
session may do while the first is deciding. `alias_reference_guard()` takes a row lock
before it counts, so what has to be proven is that a concurrent route save waits for it —
and that a plain `select` from `alias_references` does not make it wait, because a guard
nothing distinguishes from a bare count is not a guard.

[`tests/verify-alias-reference-guard.sh`](tests/verify-alias-reference-guard.sh) drives two
long-lived psql sessions through three interleavings against a database of its own:

1. **The guard holds.** A guards an unreferenced alias and is told it is unreferenced; B's
   route save naming that alias *waits* — asserted from `pg_stat_activity`, not inferred
   from a statement that has not finished; A deletes and commits; B wakes into a foreign key
   whose target is gone. No orphan, and the list A acted on was still true when A acted.
2. **Without the lock, that list goes stale.** The same interleaving through the bare view:
   B does not wait, B commits, and A's delete is refused by `route_hops_alias_fk` — still no
   orphan, because the foreign key is not optional, but a referential error where the user
   was owed a 409 naming the route. This is the probe, and it is what would go green if the
   guard ever stopped locking.
3. **The lock is no wider than the alias.** Two guards on two aliases of one workspace do
   not wait on each other.

```bash
PGPASSWORD=ouroboros ouroboros-db/tests/verify-alias-reference-guard.sh
```

Same connection rules as the probes above — `run.sh --print-target`, `PGPASSWORD` from the
environment — and its own database, dropped on the way out, because two sessions cannot see
each other's uncommitted rows and this suite therefore has to commit while it runs.

### The drift check

Every table BetterAuth uses is hand-ported into a `V###__*.sql` migration here, because
Flyway is the only thing allowed to change this schema and the library is never allowed to
change it itself. That is the right arrangement, and it is exactly what makes **drift**
possible: a `better-auth` upgrade, or a plugin added to `ouroboros-rest/src/auth`, can
move what the library expects while this copy stands still. Nothing about that is visible
until a query in production names a column that does not exist.

[`scripts/betterauth-schema.mjs`](scripts/betterauth-schema.mjs) is what makes it visible
on the pull request instead ([#710](https://github.com/NobuData/ouroboros/issues/710)). It
asks BetterAuth's own schema planner what it wants, and answers two different questions
depending on which database it is pointed at:

```bash
# does the applied schema still hold everything the library expects?
ouroboros-db/scripts/betterauth-schema.mjs --applied   # against a migrated database

# has what the library expects changed since the snapshot was rendered?
ouroboros-db/scripts/betterauth-schema.mjs --check     # against an empty schema
ouroboros-db/scripts/betterauth-schema.mjs --write     # …and re-render it
```

Both need `OURO_DATABASE_URL`, and both refuse the other's database rather than answering
the wrong question. The service's own `.env` supplies the rest, as it does for
`ouroboros-rest` itself; `--check` and `--write` want a scratch database whose `ouroboros`
schema is empty, because the planner reports what a database is *missing* and only an
empty one draws the whole picture. Both read `ouroboros-rest/dist`, so
`yarn workspace ouroboros-rest build` comes first.

[`betterauth-schema.sql`](betterauth-schema.sql) is the committed rendering — beside the
migrations rather than among them, because Flyway would otherwise try to apply it, and it
is a description of what the library wants rather than a migration. Committing it is what
turns an upgrade into a reviewable diff, and the diff is the DDL the new migration has to
apply. Neither mode ever writes to a database.

> Two things the check deliberately does not do. It does not shell out to
> `@better-auth/cli`, which brings its own copy of `better-auth` — the CLI's latest release
> carries 1.4.x while this repository pins 1.6.26 — so the core tables would be checked
> against a version the service does not run, and the two copies already disagree about
> `organization_slug_uidx`. And it cannot see **indexes**: the planner plans one only for a
> table it is creating or a column it is adding, so an index dropped from a table that
> otherwise still fits is invisible to it. That gap is closed in `tests/constraints.sql`,
> which asserts every index the snapshot lists, by name — and the suite that reads this
> file checks the two lists still agree.

## Continuous integration

[`ci/db`](../.github/workflows/db.yml) is what runs all of the above on a pull request
that touches this directory, the compose file, `.env.example`, the workflow itself, or the
two things in `ouroboros-rest` that decide what BetterAuth expects — `src/auth/` and the
`package.json` that pins the library
([#11](https://github.com/NobuData/ouroboros/issues/11) set the routing;
[#24](https://github.com/NobuData/ouroboros/issues/24) added the live pass;
[#710](https://github.com/NobuData/ouroboros/issues/710) added the last two, because a
version bump touches no file in this directory and is exactly what the drift check exists
to catch). It runs in two halves, cheap first — a misnamed migration is worth reporting
before a database is waited on.

| Step | What it proves | Needs a database |
|---|---|---|
| `scripts/verify-dev-env.sh` | Migration naming, the pinned images and healthcheck gate, `flyway.toml`'s settings, credential hygiene, `.env.example` coverage | no |
| `scripts/run-tests.sh ouroboros-db/tests` | `run.sh` and the four commands, against stubbed runners | no |
| `scripts/migrate` | Every migration applies, in order, to a database that has never seen them | yes |
| `scripts/validate` | Checksums and the naming rule, read back from the history that pass wrote | yes |
| `tests/constraints.sql` | What the schema *enforces* — the half `validate` cannot see | yes |
| `tests/verify-constraint-probes.sh` | That those assertions are load-bearing — each goes red when the rule it watches is dropped, routing included ([#193](https://github.com/NobuData/ouroboros/issues/193)) | yes (copies of its own) |
| `tests/verify-alias-reference-guard.sh` | That the alias delete guard is a lock and not a count — the rule two concurrent writers make, which one session cannot assert | yes (one of its own) |
| `scripts/betterauth-schema.mjs --applied` | The applied schema still holds everything BetterAuth expects | yes |
| `scripts/betterauth-schema.mjs --check` | The library still expects what the committed snapshot describes | yes (an empty one) |
| `scripts/migrate --config flyway.seed.toml` ×2 | The seed applies, and applies twice without changing anything | yes (a second one) |
| `tests/seed.sql` | The demo tenant is there, exactly once, with the ids the documentation publishes | yes (that one) |

The drift check is the one step that needs a Node toolchain, which is why the job installs
the workspace and builds `ouroboros-rest`: the configuration deciding the expected schema
is that module's, and reading it is the whole point — a plugin enabled there changes the
answer the same way an upgrade does, and neither has to be remembered.

The database is a `postgres:17-alpine` service container — **the same image
[`../docker-compose.yml`](../docker-compose.yml) pins**, so what a pull request proves is
what a developer gets; `scripts/verify-ci.sh` fails if the two ever drift apart. It is
created empty for every run and thrown away with the runner, which is what makes
"migrate from scratch" mean it.

Two details are the reason the job is worth its minute:

- **It runs the module's own commands**, not a `flyway` invocation written into the
  workflow. CI reads [`flyway.toml`](flyway.toml) through `-workingDirectory` exactly as
  `docker compose up` and a hand-run `scripts/migrate` do, so there is no configuration
  that only CI applies and none it can miss.
- **The seed gets a database of its own.** The first one has to go on proving what a
  production migration does — apply both `R__dev_seed*.sql` migrations and insert
  nothing, because `${ouro_dev_seed}` is `false` in `flyway.toml` — so the overlay is
  layered onto a second database instead. Migrating it twice before asserting is the idempotency
  criterion, since every assertion in `seed.sql` says *exactly one*.
- **`OURO_*` enters the environment where the live pass begins**, not job-wide. Those
  variables are the last word in `run.sh`'s precedence, and the tooling suite two steps
  earlier is what tests that precedence — in job scope they point it at the workflow
  instead of at the `.env` files it writes. `scripts/verify-ci.sh` fails on an `OURO_*`
  key in job scope, so the mistake cannot come back quietly.

Everything the live pass runs is runnable by hand against any PostgreSQL, which is how a
failure is reproduced: start one, point the `OURO_*` variables at it, and run the same
commands in the same order.

A second job, `publish/db`, turns what that pass proved into [the image](#the-image). It
`needs: ci`, which is why it lives in this workflow rather than one of its own — the
image is the SQL the job above applied to a real database, validated and asserted
against, so a red run publishes nothing. The build itself runs on every event and needs
no credential, so a `Dockerfile` that stops building fails the pull request that broke
it; only the login and the push are held back to a push on `main`. Two things about the
artefact are checked before it is pushed, and neither needs a database: that it carries
every migration in the checkout — the allow-list in `.dockerignore` is what could
silently drop one — and that it still refuses to migrate a database nobody named.

## The image

Everything above assumes a checkout: `docker compose up` mounts this directory, and the
`scripts/` commands read it from disk. A deployment has neither. [`Dockerfile`](Dockerfile)
is this module in the form that needs no checkout — the migrations, `flyway.toml`, the
seed overlay and [`docker-entrypoint.sh`](docker-entrypoint.sh), on the same
`flyway/flyway:13-alpine` the compose stack and `run.sh` already use — and `publish/db`
pushes it as `ouroboros-db:latest` and `ouroboros-db:<commit sha>`.

**It is a task, not a service.** It applies what is pending and exits, and its exit
status is the answer — which is what makes it a Kubernetes `Job`, a compose service with
`restart: "no"`, or a step in a deploy script:

```bash
docker run --rm \
  -e OURO_DB_HOST=db.internal \
  -e OURO_DB_USER=ouroboros \
  -e OURO_DB_PASSWORD="$PGPASSWORD" \
  "$DOCKER_HOSTNAME"/ouroboros-db:latest            # migrate

docker run --rm … "$DOCKER_HOSTNAME"/ouroboros-db:latest info       # or validate, repair, …
```

The parameters are the six this module already documents under
[Configuration](#configuration) — `OURO_DB_HOST`, `OURO_DB_PORT`, `OURO_DB_NAME`,
`OURO_DB_USER`, `OURO_DB_PASSWORD`, `OURO_DB_SCHEMA` — because a seventh that only the
image understood would be a parameter no other way of migrating had. Four details are
worth knowing before it goes near a production database:

- **`OURO_DB_HOST` has no default.** `localhost` inside a container is the container, so
  a default would turn a forgotten variable into a run that migrates nothing and reports
  success. Missing, it exits `2` naming the variable.
- **The password never reaches the command line.** The entrypoint sets Flyway's own
  `FLYWAY_*` environment variables rather than `-user=`/`-password=` arguments, which
  keeps the credential out of the container's process list and out of anything that logs
  a command. Anything you *do* pass on the command line goes to Flyway untouched and
  beats the environment, so `-url=… -user=… -password=… migrate` works with no
  `OURO_*` variable at all.
- **`clean` cannot be reached from it.** `flyway.toml` disables it and
  [`flyway.dev.toml`](flyway.dev.toml), the one file that re-enables it, is deliberately
  not in the image — so the command that drops every object in the schema is not
  available to a caller who asks for it by name.
- **The dev seed is inert unless it is named**, exactly as everywhere else. The overlay
  is in the image; Flyway loads no overlay it is not handed, and `-configFiles` *replaces*
  the auto-loaded file, so both have to be named to get a seeded database — which is how
  a test fixture asks for one:

  ```bash
  docker run --rm … "$DOCKER_HOSTNAME"/ouroboros-db:latest \
    -configFiles=/flyway/project/flyway.toml,/flyway/project/flyway.seed.toml migrate
  ```

Build it yourself with the module as the context — nothing here installs through the
workspace lockfile, so unlike `ouroboros-ui` it needs nothing from the repository root:

```bash
docker build -t ouroboros-db ouroboros-db      # from the repo root
```

[`.dockerignore`](.dockerignore) is an allow-list: `*`, then the four paths the build
copies. That is what keeps this module's real `.env` — and `run.sh`, `tests/` and the
`clean` overlay — out of a published layer no matter what else lands in this directory.

## Configuration

Two questions, and three files: one project configuration, and two overlays that are
inert until something names them.

**[`flyway.toml`](flyway.toml) — how migrations are applied.** Where they are, that the
schema is created if absent, that a misnamed file fails the run, that `clean` is off,
and that the dev seed inserts nothing. Every path reads it: the compose stack, `run.sh`,
and the `scripts/` commands are all pointed at this directory with `-workingDirectory`,
so there is one place to change a rule and no way for `up` and a hand-run migration to
disagree.

The overlays each hold one setting, and hold it separately so that the safe
configuration is the one every command already reads. Flyway never loads either by
itself; it takes an explicit `-configFiles`, which `run.sh --config FILE` is the way to
pass:

| Overlay | Sets | Loaded by |
|---|---|---|
| [`flyway.dev.toml`](flyway.dev.toml) | `cleanDisabled = false` | `scripts/clean-dev`, and nothing else |
| [`flyway.seed.toml`](flyway.seed.toml) | `ouro_dev_seed = "true"` | the compose stack, and `scripts/migrate --config flyway.seed.toml` |

They stay two files rather than one because they are wanted in different places: the
compose stack needs the seed and must not be given a `clean` that drops the schema.
None of the three carries a url, a user or a password — those describe a machine, not a
project.

**`.env` — which database.** Development default port: **5432**.
[`.env.example`](.env.example) here is *which database the commands migrate*; the
repo-root [`../.env.example`](../.env.example) is *every `OURO_*` variable the whole
system reads*. Both carry development defaults, so the stack and the commands work with
no `.env` at all.

| Variable | Purpose |
|---|---|
| `OURO_DATABASE_URL` | Connection string used by `ouroboros-rest` |
| `OURO_DB_HOST` | Host the commands connect to, default `localhost` |
| `OURO_DB_PORT` | Port they connect to, and the one the container publishes, default `5432` |
| `OURO_DB_USER` / `OURO_DB_PASSWORD` | Credentials for the database |
| `OURO_DB_NAME` | Database name, default `ouroboros` |
| `OURO_DB_SCHEMA` | Schema Flyway owns and migrates, default `ouroboros` |

`OURO_DB_USER`, `OURO_DB_PASSWORD` and `OURO_DB_NAME` are read by PostgreSQL's own
first-boot initialisation. Changing one after the volume exists has no effect until the
volume is dropped — `docker compose down -v`, then `up`.

A local `flyway.user.toml` is Flyway's own per-developer override file and is
git-ignored; the committed project is `flyway.toml` and its overlay.

## Migration rules

These are non-negotiable. [`ci/db`](#continuous-integration) checks them on every pull
request touching this directory — first by reading the files, then by applying them to a
real PostgreSQL — and Flyway's own `validateMigrationNaming` and `validate` enforce them
again whenever the migrations are applied.

1. **Versioned migrations are immutable.** Once `V###__*.sql` has been applied
   anywhere, it is never edited — fix forward with a new version.
2. **Plain SQL only**, one concern per migration.
3. **Repeatable migrations (`R__*.sql`) are for seeds and views only** — never for
   schema that other migrations depend on.
4. **Naming:** `V###__snake_case_description.sql` / `R__snake_case_description.sql`.
   `validateMigrationNaming` fails the build on anything else.
5. **Dev seed data never runs in production** — every statement in every `R__dev_seed*.sql`
   ends `and ${ouro_dev_seed}`, which is `false` in `flyway.toml` and `true` only in
   `flyway.seed.toml`. A seed statement without that guard is the one thing
   `tests/seed.test.sh` counts.
6. **A seed that depends on another seed is named to sort after it.** Flyway orders
   repeatable migrations by description, so `R__dev_seed_dashboard.sql` runs after
   `R__dev_seed.sql` and finds the workspaces its rows hang off. `tests/seed.test.sh`
   asserts the ordering, because getting it wrong seeds nothing and says nothing.

## Layout

```
ouroboros-db/
├── flyway.toml                       # the project: locations, schema, naming, clean off, seed off
├── flyway.dev.toml                   # the overlay that re-enables clean — clean-dev only
├── flyway.seed.toml                  # the overlay that enables the dev seed — the stack, or --config
├── run.sh                            # apply migrations to a live database
├── Dockerfile                        # the published migration image — a task, not a service
├── docker-entrypoint.sh              # its front door: the OURO_ variables in, a connection out
├── .dockerignore                     # the allow-list that governs that image's build context
├── .env.example                      # which database the commands migrate
├── package.json                      # workspace adapter — `yarn dev` reaches scripts/dev
├── catalog/
│   ├── litellm-model-prices.json     # the vendored price extract, at a pinned commit — #580
│   └── LICENSE.litellm               # the MIT licence it came under
├── scripts/
│   ├── dev                           # up, healthy, migrated — the `dev` verb
│   ├── migrate                       # apply what is pending
│   ├── info                          # applied and pending versions
│   ├── validate                      # checksums and naming rules
│   ├── clean-dev                     # drop everything — gated three ways
│   ├── betterauth-schema.mjs         # what BetterAuth expects, rendered and checked — #710
│   └── price-catalog.mjs             # the extract → R__model_price_catalog.sql transform — #580
├── migrations/
│   ├── V000__bootstrap.sql           # the schema itself
│   ├── V001__tenants.sql             # tenants, tenant_domains — #20
│   ├── V002__users_membership.sql    # users, user_identities, tenant_members — #21
│   ├── V003__github_enablement.sql   # github_orgs, github_repos — #22
│   ├── V004__betterauth_core.sql     # "user", session, account, verification — #706
│   ├── V005__betterauth_organization.sql # organization, member, invitation — #707
│   ├── V006__tenancy_extensions.sql  # the cut-over: rows move, extensions re-point, V001/V002 drop — #708
│   ├── V007__user_preferences.sql    # user_preferences — the font scale — #649
│   ├── V008__dashboard_runs.sql      # runs — the loop lifecycle read-model — #64
│   ├── V009__dashboard_queue.sql     # queue_items — the ordered issue queue — #65
│   ├── V010__dashboard_usage.sql     # token_usage + token_usage_daily — the spend ledger — #66
│   ├── V011__workspace_settings.sql  # workspace_settings + …_effective — the auto-merge switch — #67
│   ├── V012__model_prices.sql        # model_prices + the lookup and import functions — #580
│   ├── V013__tenant_keys.sql         # tenant_keys — the sealed per-workspace DEKs — #222
│   ├── V014__github_issue_cache.sql  # github_issues + the per-repo sync cursor — #99
│   ├── V015__provider_connections_model_aliases.sql
│   │                                 # provider_connections + model_aliases — the routing foundation — #189
│   ├── V016__task_kinds_routes_hops.sql
│   │                                 # task_kinds + routes + ordered route_hops — the routing matrix — #190
│   ├── V017__provider_extensions_model_catalog.sql
│   │                                 # the provider cards' columns + provider_models — #221
│   ├── V018__escalation_rules.sql    # escalation_rules — structured predicates, derived display — #191
│   ├── V019__alias_lifecycle_binding_params.sql
│   │                                 # the alias switch, the unbound binding, structured params — #579
│   ├── V020__routing_usage_attribution.sql
│   │                                 # token_usage.task_kind + .latency_ms — what $/run and p50 compute from — #192
│   ├── V021__route_revisions.sql     # route_revisions — who changed the routing table, and what moved — #195
│   ├── V022__audit_events.sql        # audit_events — #26's table, landed early; append-only — #225
│   ├── V023__alias_reference_index.sql  # alias_references — what references an alias, and the delete/rename guard — #581
│   ├── R__dev_seed.sql               # the demo workspaces, dev only — #23, reshaped by #708
│   ├── R__dev_seed_audit.sql         # the credential trail the Audit log sheet draws, dev only — #225
│   ├── R__dev_seed_dashboard.sql     # mockup 02 as rows, dev only — #68 (sorts after the above)
│   ├── R__dev_seed_providers.sql     # mockup 07's connections and meters, dev only — #221
│   ├── R__dev_seed_routing.sql       # mockup 06 as rows, dev only — #192 (sorts after the above)
│   └── R__model_price_catalog.sql    # the bundled price snapshot, every environment — #580 (generated)
└── tests/
    ├── lib/
    │   ├── fixture.sh                # the synthetic module and stub runners the shell suites share
    │   └── assert.sql                # the assertion helpers the live-database suites share
    ├── rehearsal/
    │   ├── pre.sql                   # a populated V005 database, rebuilt for every run — #708
    │   └── post.sql                  # what V006 must have done to those rows — #708
    ├── run.test.sh                   # the runner
    ├── scripts.test.sh               # the four commands and the project configuration
    ├── seed.test.sh                  # every seed's guard, order, idempotency and determinism — #23, #68
    ├── betterauth-schema.test.sh     # the drift check's contract, without a database — #710
    ├── price-catalog.test.sh         # the price transform, its provenance and --check — #580
    ├── constraint-probes.test.sh     # the probe verifier's usage and refusals — #69
    ├── verify-constraint-probes.sh   # that constraints.sql goes red when a rule is dropped — #69, #221, #193
    ├── constraints.sql               # what the schema enforces, asserted against a live database
    └── seed.sql                      # what the seeds put there, asserted against a live database
```

Everything below `V000` is named for the issue that lands it. `tests/constraints.sql` is
not — it grows with every migration that adds a rule, rather than belonging to one of
them.

## Schema

What the applied migrations define. `ouroboros-rest` reads this through Kysely; nothing
outside this module alters it.

| Table | Since | Holds | Enforces |
|---|---|---|---|
| `"user"` | `V004` | The person, as BetterAuth holds them — `users`' successor, and since `V006` the only user table | `email` unique across the installation. **Quoted at every reference: `user` is a reserved word** |
| `session` | `V004` | One row per live sign-in, which is what makes sign-out revoke rather than forget | `token` unique; `userId` cascades from `"user"` |
| `account` | `V004` | How a person proves who they are: a provider, or a password | `(providerId, accountId)` unique, so one GitHub account is one person. **The one table here that holds credentials** |
| `verification` | `V004` | Short-lived one-time values — email verification, password reset | Unused until [#705](https://github.com/NobuData/ouroboros/issues/705) |
| `organization` | `V005` | The workspace, as BetterAuth's organization plugin holds it — `tenants`' successor, and since `V006` the root the extension tables cascade from | `slug` unique across the installation; `metadata` must be JSON, and carries the `personal` flag mockup 01 renders as a pill |
| `member` | `V005` | A person's role in one organization — `tenant_members`' successor | `(organizationId, userId)` unique, so a person joins an organization once; cascades from both sides |
| `invitation` | `V005` | Somebody asked to join who has not joined yet | `expiresAt` required — expiry is a timestamp, not a status. Written at the API level in MVP; [#724](https://github.com/NobuData/ouroboros/issues/724) delivers the email |
| `tenant_domains` | `V001`, re-parented `V006` | Email domains that resolve an organization at sign-in | Domain unique across *all* organizations and stored lower-cased; at most one `is_primary` per organization |
| `github_orgs` | `V003`, re-parented `V006` | GitHub orgs an organization has enabled | `login` unique *per organization*, stored lower-cased; `enabled` defaults false |
| `github_repos` | `V003`, cursor added `V014` | Repos within an org, and — since `V014` — when their issues were last polled | `name` unique per org, stored lower-cased; `enabled` defaults false; `issues_sync_cursor` is non-blank and cannot precede the `issues_synced_at` of the sync that produced it |
| `user_preferences` | `V007` | Per-person product preferences — today the font scale | One row per person, absent while every setting is at its default; `font_scale` is one of § 4's five steps; cascades from `"user"` |
| `runs` | `V008` | One run of the loop against one issue — the dashboard read-model | `status` is one of `coding\|building\|review\|merged\|needs_human\|failed`, and a terminal status carries `finished_at` exactly when it is terminal; the run's repository must belong to the run's organization |
| `queue_items` | `V009` | What the loop will do next — the ordered, estimable per-organization issue queue | `position` unique per organization and **deferrable**, so a reorder swaps inside a transaction; `(organization_id, issue_number)` unique, so an issue queues once; `effort` is one of `xs\|s\|m\|l\|xl`; the item's repository must belong to the item's organization |
| `token_usage` | `V010`, routing attribution `V020` | What the loop has spent — one append-only event per provider call, not one total per organization. Since `V020` it is also what mockup 06's routing matrix is computed from: `task_kind` says which routed kind of work a call served and `latency_ms` how long it took, so `$/run avg` and `p50 latency` are aggregates here rather than numbers stored on a route (decision **M7**) | Token counts and costs cannot go negative; `cost_cents` is nullable and null means **unpriced** ([#92](https://github.com/NobuData/ouroboros/issues/92) prices it) — never defaulted to 0; `provider` is stored folded, so the card counts providers rather than spellings; `run_id` is nullable and **sets null** rather than cascading, because deleting a run does not un-spend money; the usage's run must belong to the usage's organization. `task_kind` is shaped as `task_kinds.name` is but is deliberately **not** a foreign key (decision **F8**, as `runs.workflow_tag`): a ledger row records what happened, and retiring a kind must neither block, delete nor rewrite the history routed under it. `latency_ms` is non-negative, and **both are nullable, which is the point** — null is *not routed* and *not timed*, so an aggregate over none of either is null and the matrix renders the em-dash `M7` requires instead of a fabricated `$0.00` and `0.0s`; zero is permitted on `latency_ms` because a local daemon on loopback really answers inside a millisecond |
| `workspace_settings` | `V011` | Org-scoped typed product settings — today the auto-merge switch, the dashboard's only write | One row per organization, as a primary key, which is also what the settings upsert conflicts on; **absent while every setting is at its default** — read through `workspace_settings_effective`, never directly; `auto_merge_on_checks` is `not null default false`, so the switch has two positions and absence of the row is the only "unset"; `updated_by` references `"user"` and **sets null** rather than cascading, because deleting the person who flipped a switch must not turn it back off |
| `github_issues` | `V014` | The backlog as Ouroboros sees it — one row per mirrored GitHub issue, behind mockup 03's table and detail panel. **A cache, not a fork** (decision **K3**): GitHub owns every column but `sizing_status` | `(github_repo_id, number)` unique, which is also the sync's upsert key; `state` is `open\|closed` and `sizing_status` one of `unsized\|estimating\|sized\|needs_human`, defaulting to `unsized`; `labels` must be a JSON array of at most 100 non-empty **names** — GitHub's, not ours; `gh_url` must be `https` with a host, because it becomes an `href`; `gh_updated_at` cannot precede `gh_created_at`; the issue's repository must belong to the issue's organization |
| `provider_connections` | `V015`, cards' columns `V017` | Where a workspace's model providers are, and the sealed credential for the ones that need one — mockup 06's `.phealth` strip, and the shared foundation mockup 07 manages (decision **M2**). Since `V017` it also carries what a card *shows*: `monthly_cap_cents`, `added_by`, `last_used_at`, `capability_note` and the `enabled` switch | `kind` is one of `anthropic\|openai_compatible\|ollama\|copilot\|cursor\|custom` and `status` one of `active\|paused\|error\|unknown`, defaulting to `unknown` because a connection nothing has checked is genuinely unknown (decision **M8**); `credentials_encrypted` is **envelope-only** — an `ouro.v1.…` value or null, so a plaintext key cannot be stored by any writer — and null is legitimate, because a local provider needs none; `base_url` is `http`/`https` and required for `ollama` and `openai_compatible`, which have no public endpoint; `health` must be an object, may only carry content once `last_checked_at` exists, and a `latency_ms` must be a non-negative number — there is deliberately no defaulted `0ms`; `monthly_cap_cents` is non-negative and **nullable**, where null is *no cap* (the mockup's em-dash) and zero is the real instruction *spend nothing*; `added_by` references `"user"` and **sets null**, because deleting the person who added a provider must not delete the provider; `enabled` is `not null default true` and is **not** `status` — the switch is what a person decided, the status is what the last check measured, and a card draws both |
| `model_aliases` | `V015`, registry columns `V019` | The names a workspace's routes may use, and what each resolves to — and, since `V019`, the surface mockup 21 manages: the `enabled` switch, the unbound binding, `params`, `restrictions`, `notes` and `updated_by` | `alias` unique **per organization** and constrained to lower-case kebab, so uniqueness cannot be defeated by capitalisation; `model_id` is the raw provider model string and the **only** place one lives (decision **M1**); the connection is reached through a **composite** foreign key on `(organization_id, provider_connection_id)`, which is what holds an alias and its connection to one workspace, and it **restricts** on delete, so a provider aliases depend on cannot be removed out from under the routes that reach it. Since `V019` that binding is **nullable** — null is *unbound*, an alias created ahead of its key, admitted by the key's `MATCH SIMPLE` rather than by any change to it — and `enabled` is `not null default true` and **not** provider health: an **unbound alias can never be enabled**, by CHECK, so no service path can race past it and creating one without saying `enabled = false` is refused rather than corrected. `params` is a closed vocabulary — `thinking` (`off\|std\|max`), `token_budget`, `max_output` and `context_clamp` (whole tokens, 1 to 10000000) and `temperature` (0 to 2) — and `restrictions` a two-flag one (`review_vote_only`, `batch_ok`, boolean), because the table's chips are derived from both and a key nothing derives is a param that renders nowhere; whether a well-formed param *means* anything for the bound model is CH.2's ([#585](https://github.com/NobuData/ouroboros/issues/585)). `notes` is non-blank or absent; `updated_by` references `"user"` and **sets null**, because deleting the person who last edited an alias must not delete the alias |
| `provider_models` | `V017` | The models a connection has, as discovery reported them — the cards' chips and Ollama pull-list, mockup 21's registry, and what Y.1's aliases are validated against (decision **P6**) | `(provider_connection_id, model_id)` is unique, which is what makes discovery an **upsert** rather than a duplication; `display` is required, because a chip with no text is a chip nobody can click; `size_bytes` is positive or null — only a locally-pulled model has one, and null rather than zero is how *no size* is said; `meta` must be an object, and carries `context_tokens` under the key `model_prices.meta` already uses; cascades from the connection, which is deliberately its **only** tenancy — a discovered model is a fact about a connection, and every read enters through one |
| `task_kinds` | `V016` | The kinds of work a route can be written for — mockup 06's `8 task kinds`, and the vocabulary the WF stage catalog ([#145](https://github.com/NobuData/ouroboros/issues/145)), the estimator and the DSL's `route.task()` all read rather than each hardcode (decision **M3**) | `name` unique **per workspace** and lower-case kebab, so uniqueness cannot be defeated by capitalisation; `description` is required, because it is the matrix line that tells one row from its neighbour; `sort_order` is unique per workspace and **deferrable**, so a drag-reorder is plain SQL — and deliberately **not** dense, because nothing reads those numbers |
| `routes` | `V016` | One task kind's route: the owner of the ordered alias chain and of mockup 06's policy triple — **Allow fallback to local models**, the floor, and **Max cost per run** (decision **M4**) | **Exactly one route per task kind**, as a unique key rather than as application code, so resolution's *"the route of this kind"* has one answer; `tag` unique per workspace and its own column rather than derived, because the mockup's tags are not mechanical (`test-gen` → `testgen-primary`); `max_cost_cents_per_run` is **integer cents** — `$2.50` is `250`, never a float; `floor_hop_index` is null-permitting, at least 1 by CHECK and never past the end of the chain, which is `route_chain_intact()`; `updated_by` **sets null** rather than cascading, because deleting the person who last saved a route must not delete the route |
| `route_hops` | `V016` | The ordered fallback chain — mockup 06's numbered inspector rail, each hop naming a registry alias and carrying the hop-meta line beside it | `position` unique per route and **deferrable**, so a reorder swaps inside a transaction, and **dense from 1** by the `route_chain_intact()` constraint trigger — unlike `queue_items.position`, because these numbers are read: `floor_hop_index` counts them; a route may never be left with an empty chain; the alias is reached through a **composite** foreign key on `(organization_id, model_alias_id)` and it **restricts** on delete, so an alias a chain names cannot be retired out from under it; **there is no raw model id column here, in any of the three tables** — decision **M1** by construction |
| `escalation_rules` | `V018` | Mockup 06's *ESCALATION RULES* card — the three rules as **structured predicates that modify a route**, not as the sentences they read like (decision **M5**) | `"when"` is the WF-P8 predicate grammar scoped to routing — `effort_gte` (V009's five **F9** sizes, the same vocabulary the queue uses), `label` (GitHub's, as `V014` mirrors them) and `diff_kind` (`docs_only`), at least one, ANDed; `"then"` is **exactly one** of `{use_alias: {task_kind, alias, params?}}` — the mockup's *"(max thinking)"* is `params`, not prose — `{add_vote: {task_kind, alias}}` or `{route_local: {}}`; both are **domains**, so an unknown key is refused at the value rather than at the row; `display` is **`generated always … stored`** from the two, so a hand-written sentence is refused by PostgreSQL and an edited rule cannot keep the sentence it had; the task kind and alias a rule names must exist **in the rule's own workspace**, held by a deferred constraint trigger on all three tables; `sort_order` is unique per workspace and **deferrable**, which is what makes "which rule wins" have one answer and a drag-reorder plain SQL |
| `route_revisions` | `V021` | One row per press of mockup 06's **Save routes** — who changed the routing table, when, and exactly what moved ([#195](https://github.com/NobuData/ouroboros/issues/195)); the feed the audit log ([#26](https://github.com/NobuData/ouroboros/issues/26)) reads | `actor` references `"user"` and **sets null**, because deleting a person must not delete the record of what they changed; `diff` is CHECKed by `ouroboros.route_revision_diff_valid()` to `{routes: [{task_kind, changes: {<column>: {from, to}}}]}` — at least one route, at least one change each, every change a `{from, to}` pair — so a save that changed **nothing** is unstorable rather than merely not written; task kinds inside the document are *shaped* as `task_kinds.name` is but are deliberately **not** foreign keys, and hops are named by `model_aliases.alias`, because a revision is history a person reads months later and an id is a lookup into a row that may since have been repointed; there is **no `updated_at`** and no touch trigger, because an event that can be edited is not one; one index — `(organization_id, created_at desc, id desc)` — which is the only read this table has |
| `audit_events` | `V022` | Who did what to which credential, from where, and when — the platform audit trail ([#225](https://github.com/NobuData/ouroboros/issues/225)), in the shape [#26](https://github.com/NobuData/ouroboros/issues/26) specified and landed early because decision **P5** puts credential auditing in the MVP. `ouroboros-rest`'s audit module is the only writer; `GET /api/v1/providers/audit` is the only reader, and mockup 07's **Audit log** sheet is what it draws | **Append-only, enforced twice**: `ouroboros_app` — a role this migration creates `nologin` — holds `select` and `insert` and nothing else, and `audit_events_no_update` refuses a revision from *any* role including the owner, because a superuser bypasses every grant and a rule that is true only in production is a rule nobody can test. Both foreign keys shape that trigger: `organization_id` **cascades**, which is why the trigger covers `update` and not `delete` — a delete-refusing trigger would make removing a workspace impossible rather than protecting the trail — and `actor_id`'s `on delete set null` **is** an update, so exactly that one statement is permitted and nothing beside it (*what happened cannot be rewritten; who did it can be forgotten*). `actor_id` is nullable because a `credential.lease_granted` has no person behind it; the **subject** is `subject_type` + `subject_id` with deliberately **no** foreign key, because `provider.deleted` is exactly the row one would make unwritable; `action` and `subject_type` are CHECKed to an identifier *grammar* and not to a vocabulary, so adding an event is an application release while a misspelled one is still refused; `ip` is `inet`, which refuses a string that is not an address; `detail` must be an **object** so the secrecy grep can enumerate its keys — that it holds no secret material is enforced by the writer and by that grep, because a CHECK could only match the credential shapes somebody thought of. There is **no `updated_at`**, and one index — `(organization_id, occurred_at desc, id desc)` — which is the only read this table has; #26's BRIN is deliberately not created until something sweeps by time |
| `model_prices` | `V012` | What a model costs — the pricing catalog behind mockup 21's `$ per 1M in·out` column, and the shared price table [#92](https://github.com/NobuData/ouroboros/issues/92), [#198](https://github.com/NobuData/ouroboros/issues/198) and [#210](https://github.com/NobuData/ouroboros/issues/210) read rather than re-invent | `billing_mode` is one of `token\|seat\|usage\|free`, and the amounts follow it structurally — `token` requires both, `free` requires zero or none, `seat` and `usage` may carry none, and a `token` row that costs nothing in both directions is refused as a mislabelled `free`; `organization_id` null means a bundled catalog row and set means a workspace's override, with `source` required to agree and `catalog_version` required on bundled rows; the match key is unique **`nulls not distinct`**, without which every re-import would duplicate the whole catalog; the only wildcard is a whole `*` |

Two **functions**, both `V012`'s and both documented in
[The bundled price catalog](#the-bundled-price-catalog).
**`ouroboros.model_price(organization, provider kind, model)`** is the read: the one row
that prices that pair — override over bundled, exact model over family row — or no row at
all, which is what the registry renders as `—` rather than as `$0`. It is `language sql`
and `stable` so PostgreSQL inlines it, which is what keeps a price lookup a single indexed
query instead of an opaque function scan.
**`ouroboros.import_model_price_catalog(version, effective_at, rows)`** is the write, and
the whole of what `R__model_price_catalog.sql` does: idempotent, sweeping the previous
snapshot, and structurally unable to touch a workspace's override.

Two more **functions**, `V017`'s, and one row trigger over them.
**`ouroboros.provider_model_discovered(connection, model)`** answers *has discovery
reported this model on this connection* — the predicate behind the alias warning, exposed
on its own so a service, mockup 21's discovery-mismatch state and `tests/constraints.sql`
all read one definition. **`ouroboros.warn_undiscovered_alias_model()`** is the trigger
function on `model_aliases` that consults it and **raises a `WARNING` without refusing the
write** (decision **P6**): discovery is not yet universal — a connection exists before
anything has discovered it, and an operator may create an alias ahead of a key — so a hard
foreign key would refuse configurations that are valid during that gap. It tells a *gap*
(nothing discovered on this connection yet) from a *mismatch* (its catalog lists other
models), and becomes enforcement the day discovery covers every adapter, by raising instead
of warning. `ci/db` greps the `constraints.sql` transcript for both branches, because
nothing in SQL can catch a warning and a suite that had lost the trigger would be exactly
as green. `V019` amends it in one place: an **unbound** alias returns before either branch,
because there is no connection to have discovered anything and the gap message would
otherwise name one that does not exist.

Two more **functions**, `V019`'s, and they are the vocabularies themselves rather than
anything a caller has to remember.
**`ouroboros.model_alias_params_valid(params)`** and
**`ouroboros.model_alias_restrictions_valid(restrictions)`** answer whether a document is
inside the registry's closed key set with every value in range. `immutable`, table-free and
**total** — a document that is not an object is answered `false` rather than raised on — so
each is callable from a CHECK, and so `ouroboros-rest` can validate a payload against the
same definition the database will enforce instead of restating it. They are *shape* only,
which is the split decision **R3** draws: whether `{"thinking": "max"}` means anything for
the model an alias is bound to needs the adapter's schema and `provider_models`, and is
CH.2's ([#585](https://github.com/NobuData/ouroboros/issues/585)).

One **constraint trigger function**, `V016`'s. **`ouroboros.route_chain_intact()`** holds
the two rules that are properties of a *chain* rather than of a row — a route's hop
positions are dense from 1 and never empty, and its `floor_hop_index` points at a hop that
exists — for both `routes` and `route_hops`. Neither can be a `CHECK`, because both look at
rows other than the one being written, and both are **deferred to `commit`** so that a
reorder, a whole-chain rewrite, and an `insert route; insert hops` sequence may each be
momentarily inconsistent inside their transaction and correct when it ends. It raises class
23 naming the trigger, so each table reports its own constraint name.

Three more **functions** and a second constraint trigger function, `V018`'s.
**`ouroboros.escalation_rule_when_valid(when)`** and
**`ouroboros.escalation_rule_then_valid(then)`** are the grammar behind the two **domains**
`escalation_rule_when` and `escalation_rule_then` — a domain rather than a table `CHECK`
because a stored generated column is computed *before* any `CHECK` on the row, so the
derivation would otherwise have to defend itself against shapes its own table was about to
reject. **`ouroboros.escalation_rule_display(when, then)`** is that derivation: the card's
sentence, produced from the structure and from nothing else, `immutable` and table-free,
which is what lets `escalation_rules.display` be `generated always … stored`. Changing the
*wording* is therefore a migration that rewrites the column
(`alter table … alter column display set expression as (…)`), which is the price of a
sentence that cannot drift. **`ouroboros.escalation_rule_targets_exist()`** is the reference
this schema cannot declare: the task kind and alias a rule names live inside a jsonb
document, so a **deferred** constraint trigger on `escalation_rules`, `task_kinds` and
`model_aliases` holds all three sides — writing a rule that names neither, and retiring the
kind or alias a rule already names, are both refused.

Three **views**. **`token_usage_daily`** (`V010`) rolls `token_usage` up per organization,
UTC day and provider — the read behind mockup 02's *Token spend · today*. It is a plain
view rather than a materialized one on purpose: a stored total drifts the moment an event
is corrected or back-filled. Its `cost_cents` propagates null rather than coalescing to
zero, and `unpriced_events` is how a caller knows the total is a lower bound.

**`workspace_settings_effective`** (`V011`) is `organization LEFT JOIN
workspace_settings` with the defaults coalesced in — one row per organization whether or
not it has ever set anything. It exists because `workspace_settings` creates its rows
**lazily**: there is no creation trigger, and a workspace with no row is at every default.
This view is what keeps that decision out of every caller, so a newly created workspace
reads `auto_merge_on_checks = false` from the database rather than from an application's
memory of the default. Read settings here; write the table, with an `on conflict
(organization_id) do update` upsert. `is_explicit` is the one column that still tells a
written default from no row, for onboarding and audit lines.

**`alias_references`** (`V023`) is what references a model alias, across every storage shape
one can be referenced from — `(organization_id, alias_id, alias, kind, ref_id, ref_label,
blocking)`, one row per reference. `route` rows come from `route_hops` and are labelled with
the route's tag; `escalation` rows come from an `escalation_rules."then"` target, joined by
**name** within the workspace because that is what the rule stores, and labelled
`escalation:effort≥L` — mockup 21's chip, derived from the rule's `"when"` rather than cut
out of `display`, because a rule's `label` condition carries a GitHub label name and the
sentence therefore has no separator a substring is safe to cut at. `workflow` and `chat_pin`
are in the vocabulary and contribute no rows until their storage exists. Nothing stores a
count: the `USED BY` column is `count(*)` over this view and the `0 routes` row is a left
join from `model_aliases`. Read it through **`alias_reference_guard(organization_id,
alias_id)`** from inside the transaction that deletes or renames — selecting from the view
directly takes no lock and its answer can go stale before the next statement runs.

`V001`'s `tenants`, `V002`'s `users`, `user_identities` and `tenant_members` are **gone**:
`V006` ([#708](https://github.com/NobuData/ouroboros/issues/708)) moved their rows into
`organization`, `"user"`/`account` and `member`, re-parented the two extension tables
above onto a snake_case `organization_id`, and dropped them. `tests/constraints.sql`
asserts they *stay* gone, so a migration that recreated one fails `ci/db`.

`V005` also adds one column to an existing table: **`session."activeOrganizationId"`**, the
tenant pointer. It is a nullable foreign key to `organization` with `on delete set null`,
and both halves of that are deliberate — see
[The tenant pointer](#the-tenant-pointer) below.

### The two generations of user table

A closed chapter, kept because its reasoning still governs the shape of what remains.
`V004` ([#706](https://github.com/NobuData/ouroboros/issues/706)) landed BetterAuth's four
core tables beside the tenancy ones, which left the schema briefly holding **two tables
that described the same people**: `users` from `V002`, and `"user"` from `V004` — a
difference of one letter. `V004`'s back-fill kept them agreeing — `users` → `"user"` and
`user_identities` → `account`, **preserving ids**, so every foreign key written against
`users.id` named the same person on both sides. That id preservation is what made the
transitional state end cleanly: `V006`
([#708](https://github.com/NobuData/ouroboros/issues/708)) re-ran the back-fill one last
time (a database whose seed landed after `V004` needed it), refused to proceed past
anyone the back-fill had had to skip, moved the memberships, and dropped `users`,
`user_identities` and the back-fill function itself. There is one user table now, and it
is the quoted one.

> **`user` is a reserved word — quote it, always.** `ouroboros."user"` in every statement,
> in every migration, in every hand-typed `psql` query. Unquoted, `ouroboros.user` parses
> as the `user` keyword rather than as this table. `scripts/verify-dev-env.sh` greps every
> migration for an unquoted `user` in a table position and fails `ci/db` before PostgreSQL
> sees it.

BetterAuth's own naming is kept exactly as its CLI emits it — singular table names, quoted
camelCase columns like `"emailVerified"` and `"createdAt"` — which is roadmap decision
**A4**. These are vendor-shaped tables, and renaming their columns would put this schema at
war with every library upgrade and every plugin that reads them. The house snake_case style
still governs `V001`–`V003`. Flyway remains the only thing that issues DDL (decision
**A3**): BetterAuth ships a `migrate` command that would create these tables itself, it is
never run, and `scripts/verify-dev-env.sh` asserts that nothing in the repository wires it
up. The SQL in `V004` is a hand-port of `@better-auth/cli generate` — see
`ouroboros-rest/README.md` § Generating the auth schema for the command. `V005`
([#707](https://github.com/NobuData/ouroboros/issues/707)) is the same hand-port for the
organization plugin, and re-running `generate` against a database carrying it prints
*"Your schema is already up to date"* — which is how the port was checked rather than
trusted.

### The tenant pointer

`V005` adds `session."activeOrganizationId"`, and it is the column that changes how the
service behaves rather than merely what it stores. Before it, the tenant a request acted in
was a **header the client asserted** — `X-Ouro-Tenant`, which
[#32](https://github.com/NobuData/ouroboros/issues/32) shipped and
[#713](https://github.com/NobuData/ouroboros/issues/713) demotes to an override. After it,
the tenant is a column on the session row, which only the server writes: the plugin's
`setActiveOrganization` is the one way it changes. That is roadmap decision **A5**.

Three properties, all asserted in `tests/constraints.sql`:

- **Nullable**, because a session exists from the moment somebody signs in — which is
  before they have chosen anything in mockup 01 Step 2. Null means *signed in, acting
  nowhere*.
- **A foreign key**, which the library does not emit: it clears the pointer in application
  code instead. Written into the schema, no session can point at an organization that does
  not exist — including after a delete issued by a migration, a support script or `psql`
  rather than by the plugin.
- **`on delete set null`, never `cascade`.** This is the one worth getting right: a cascade
  here would delete the *session rows*, so deleting an organization would sign out everybody
  who happened to be acting in it. Nulling the pointer leaves them signed in with a choice
  to make.

Four conventions run through the tenancy tables, and are worth knowing before adding
another:

1. **Case-folded on the way in, not at read time.** Domains, org logins and repo names
   are stored lower-cased and held there by a check constraint. That is what lets one
   plain unique btree be both the uniqueness rule and the case-insensitive lookup index —
   query with `where domain = lower($1)` and it is an index scan. It needs no `citext`
   extension, which a managed PostgreSQL may not grant the migration role rights to
   create. All three get the folding free, because their format patterns admit no upper
   case. (`"user".email` is folded too, but by the library rather than by a constraint —
   it is BetterAuth's column.)
2. **Enablement fails closed.** Both `enabled` flags default to `false`, and they are
   independent: a repo is in scope only when its own flag *and* its org's are true, so
   suspending an org preserves the per-repo choices underneath. These two tables bound
   where Ouroboros may operate, so anything arriving by an undesigned path arrives off.
3. **`updated_at` is one shared trigger.** `ouroboros.touch_updated_at()`, defined in
   `V001` and attached by every table since, stamps from the server clock and overwrites
   whatever the statement supplied. One function means the behaviour cannot drift between
   tables.
4. **No credential is stored in the tables this module designed.** The extension tables
   record enablement and domains, never a token, refresh token or secret; a credential
   there would make every `select *` over the tenancy schema a secret-bearing query.
   `tests/constraints.sql` asserts the absence by reading `information_schema`, so a
   column added later is caught rather than merely discouraged.

   `V004`'s `account` is the deliberate exception, and the assertion is scoped to name it
   as one. It is the library's table, its `accessToken`/`refreshToken`/`password` columns
   are part of BetterAuth's contract, and the library encrypts the tokens with
   `BETTER_AUTH_SECRET` before they are written. The rule above still governs every table
   this module designed.

Deleting an organization cascades the whole way down — domains, memberships, invitations,
orgs, and the orgs' repos — so nothing is left naming a workspace that is gone. It stops
at the people: deleting an organization removes the *memberships*, not the `"user"` rows,
since a person may hold roles in organizations that remain, and it does not delete their
sessions either — the tenant pointer is nulled instead (see above). Deleting a `"user"`
is the cascade in the other direction, and takes their sessions, accounts and memberships
with them.

## Related issues

Scaffold [#19](https://github.com/NobuData/ouroboros/issues/19) ·
tenants & domains [#20](https://github.com/NobuData/ouroboros/issues/20) *(done)* ·
users & membership [#21](https://github.com/NobuData/ouroboros/issues/21) *(done)* ·
GitHub enablement [#22](https://github.com/NobuData/ouroboros/issues/22) *(done)* ·
dev seed [#23](https://github.com/NobuData/ouroboros/issues/23) *(done)* ·
migration CI [#24](https://github.com/NobuData/ouroboros/issues/24) *(done)* ·
BetterAuth core schema [#706](https://github.com/NobuData/ouroboros/issues/706) *(done)* ·
organization schema [#707](https://github.com/NobuData/ouroboros/issues/707) *(done)* ·
tenancy cut-over [#708](https://github.com/NobuData/ouroboros/issues/708) *(done)* ·
model pricing catalog [#580](https://github.com/NobuData/ouroboros/issues/580) *(done)* ·
provider connections & aliases [#189](https://github.com/NobuData/ouroboros/issues/189) *(done)* ·
provider schema extensions, discovered models & seeds [#221](https://github.com/NobuData/ouroboros/issues/221) *(done)* ·
full epic [#3](https://github.com/NobuData/ouroboros/issues/3) ·
model registry epic [#575](https://github.com/NobuData/ouroboros/issues/575) ·
auth database epic [#696](https://github.com/NobuData/ouroboros/issues/696).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
