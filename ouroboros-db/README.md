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
(decision **K3**).

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

It is **two migrations**, because they answer two questions and change on different days:

| File | Holds | Issue |
|---|---|---|
| [`R__dev_seed.sql`](migrations/R__dev_seed.sql) | *Who exists* — the workspaces, the people, and where the loop may run | [#23](https://github.com/NobuData/ouroboros/issues/23) |
| [`R__dev_seed_dashboard.sql`](migrations/R__dev_seed_dashboard.sql) | *What the loop has done* — runs, queue, spend, and the auto-merge switch | [#68](https://github.com/NobuData/ouroboros/issues/68) |

> **The names are load-bearing.** Flyway applies repeatable migrations in the order of
> their *descriptions*, and every row the dashboard seed writes finds its parent by
> natural key — so `dev_seed_dashboard` has to sort after `dev_seed`, and does.
> `tests/seed.test.sh` asserts it, because the failure mode is silent: applied in the
> wrong order, every join finds nothing, every insert inserts nothing, and a second
> `migrate` does not put it right (Flyway re-applies a repeatable migration only when its
> checksum changes).

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

**`kensuenobu` and `acme-labs` get no dashboard rows at all.** That is not an omission: the
personal workspace is the *empty-state fixture* the zero-state cards
([#86](https://github.com/NobuData/ouroboros/issues/86)) are rendered against, so switching
the active organization to it is how a developer sees the empty dashboard. Neither gets a
`workspace_settings` row either, which keeps "answered no" and "never asked" distinguishable
— `workspace_settings_effective` resolves both to `false`, and only it says which.

Every seeded row carries an id beginning `5eed` —
`5eed0001-0000-4000-8000-000000000001` is the acme-robotics organization,
`5eed0009-…-000000000482` the run against issue `#482` — so demo data is recognisable on
sight in a log or a URL, and a test can name a row without looking it up. The workspace
seed lists all of its ids; the dashboard seed builds its seventy-seven from three
documented prefixes (`5eed0009…` runs, `5eed000a…` queue items, `5eed000b…` usage events)
and the issue number or ordinal of the row, which is as deterministic and rather more
readable than seventy-seven literals.

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
what the two `R__dev_seed*.sql` migrations actually put in a development database, one
assertion per row — the workspaces, and mockup 02's dashboard number for number.
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

### Proving the assertions are load-bearing

A green `constraints.sql` does not prove its assertions are doing anything. A file that
asserted nothing at all would be exactly as green, and so would one whose probes had
drifted off the constraints they were written for — the two are indistinguishable from the
outside. The only way to tell them apart is to break a rule on purpose and check that the
right probe goes red for the right reason.

[`tests/verify-constraint-probes.sh`](tests/verify-constraint-probes.sh) is that check for
the dashboard read-model ([#69](https://github.com/NobuData/ouroboros/issues/69)). It drops
one rule at a time — the `runs.status` and `queue_items.effort` vocabularies, the
terminal-run rule, the queue's position and issue keys, the `workspace_settings` primary
key — and rewrites the two expressions `token_usage_daily` computes its sums from, since
that bullet is arithmetic rather than a constraint and no drop can falsify it. For each, it
requires the suite to fail **and** to name the assertion that caught it: a bare non-zero
status would also be produced by a mutation that broke on its own statement.

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
| `tests/verify-constraint-probes.sh` | That those assertions are load-bearing — each goes red when the rule it watches is dropped | yes (copies of its own) |
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
│   ├── R__dev_seed.sql               # the demo workspaces, dev only — #23, reshaped by #708
│   ├── R__dev_seed_dashboard.sql     # mockup 02 as rows, dev only — #68 (sorts after the above)
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
    ├── seed.test.sh                  # both seeds' guard, order, idempotency and determinism — #23, #68
    ├── betterauth-schema.test.sh     # the drift check's contract, without a database — #710
    ├── price-catalog.test.sh         # the price transform, its provenance and --check — #580
    ├── constraint-probes.test.sh     # the probe verifier's usage and refusals — #69
    ├── verify-constraint-probes.sh   # that constraints.sql goes red when a rule is dropped — #69
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
| `token_usage` | `V010` | What the loop has spent — one append-only event per provider call, not one total per organization | Token counts and costs cannot go negative; `cost_cents` is nullable and null means **unpriced** ([#92](https://github.com/NobuData/ouroboros/issues/92) prices it) — never defaulted to 0; `provider` is stored folded, so the card counts providers rather than spellings; `run_id` is nullable and **sets null** rather than cascading, because deleting a run does not un-spend money; the usage's run must belong to the usage's organization |
| `workspace_settings` | `V011` | Org-scoped typed product settings — today the auto-merge switch, the dashboard's only write | One row per organization, as a primary key, which is also what the settings upsert conflicts on; **absent while every setting is at its default** — read through `workspace_settings_effective`, never directly; `auto_merge_on_checks` is `not null default false`, so the switch has two positions and absence of the row is the only "unset"; `updated_by` references `"user"` and **sets null** rather than cascading, because deleting the person who flipped a switch must not turn it back off |
| `github_issues` | `V014` | The backlog as Ouroboros sees it — one row per mirrored GitHub issue, behind mockup 03's table and detail panel. **A cache, not a fork** (decision **K3**): GitHub owns every column but `sizing_status` | `(github_repo_id, number)` unique, which is also the sync's upsert key; `state` is `open\|closed` and `sizing_status` one of `unsized\|estimating\|sized\|needs_human`, defaulting to `unsized`; `labels` must be a JSON array of at most 100 non-empty **names** — GitHub's, not ours; `gh_url` must be `https` with a host, because it becomes an `href`; `gh_updated_at` cannot precede `gh_created_at`; the issue's repository must belong to the issue's organization |
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

Two **views**. **`token_usage_daily`** (`V010`) rolls `token_usage` up per organization,
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
full epic [#3](https://github.com/NobuData/ouroboros/issues/3) ·
model registry epic [#575](https://github.com/NobuData/ouroboros/issues/575) ·
auth database epic [#696](https://github.com/NobuData/ouroboros/issues/696).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
