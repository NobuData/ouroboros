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
> enforce. [#23](https://github.com/NobuData/ouroboros/issues/23) added the dev seed —
> [`migrations/R__dev_seed.sql`](migrations/R__dev_seed.sql), the demo tenant every
> mockup is drawn around, in a development database and nowhere else. And
> [#24](https://github.com/NobuData/ouroboros/issues/24) turned all of that into a gate:
> `ci/db` now starts a throwaway PostgreSQL on every pull request, migrates it from
> empty, validates it, and runs both `.sql` suites against the result — see
> [Continuous integration](#continuous-integration). What that pass proves is now also
> what ships: [`Dockerfile`](Dockerfile) is this module as a one-shot migration task, and
> `publish/db` pushes it once `ci/db` is green on `main` — see [The image](#the-image).

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
Flyway migrations that own it. Tenants, their domains, users and GitHub identities,
per-tenant membership roles, and GitHub org/repo enablement live here.

Flyway is the **sole owner of DDL**. No application module creates or alters tables;
`ouroboros-rest` reads and writes through Kysely against a schema this module defines.

## Stack

| Concern | Choice |
|---|---|
| Database | PostgreSQL 17 |
| Migrations | Flyway 11, run from its container — no local Java required |
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

`docker compose up` leaves a database with data in it: the demo tenant every screen in
[`../docs/mockups`](../docs/mockups) is drawn around, so a UI has something to render and
an e2e test has something to assert against by name.

| Row | Value |
|---|---|
| Tenant | `acme-robotics` — *Acme Robotics*, active |
| Domain | `acme-robotics.dev`, primary — the address domain mockup 01 resolves the tenant from |
| People | `ken@acme-robotics.dev` (owner) · `maya@acme-robotics.dev` (admin) · `jorge@acme-robotics.dev` (member) |
| Identities | one GitHub identity each, so the sign-in path has someone to resolve to |
| Org | `acme-robotics`, enabled |
| Repo | `helios-firmware`, enabled, default branch `main` |

Every seeded row carries an id beginning `5eed` —
`5eed0001-0000-4000-8000-000000000001` is the tenant — so demo data is recognisable on
sight in a log or a URL, and a test can name a row without looking it up.
[`migrations/R__dev_seed.sql`](migrations/R__dev_seed.sql) lists all ten.

**It cannot run against anything but a development database.** Each statement in the
seed ends `and ${ouro_dev_seed}`, a Flyway placeholder that is `false` in
[`flyway.toml`](flyway.toml) — the configuration `scripts/migrate`, CI and every
hand-run migration read. With it false the migration still applies and inserts nothing.
[`flyway.seed.toml`](flyway.seed.toml) is the one file that sets it `true`, the compose
stack is the one thing that loads it by itself, and this is the deliberate way to reach
it for a database the stack does not own:

```bash
ouroboros-db/scripts/migrate --config flyway.seed.toml
```

It is a repeatable migration and it is idempotent: the ids are literals and every
statement ends `on conflict do nothing`, so applying it twice writes nothing the second
time and leaves even the timestamps alone. Child rows find their parent by slug or by
email rather than by id, so a database somebody has edited by hand gets a seed that
re-creates what it can instead of failing.

> One consequence of Flyway's rules is worth knowing: a repeatable migration's checksum
> is taken of the file, *before* placeholders are substituted. A database that has
> already recorded this migration un-seeded therefore does not pick the data up merely
> by being migrated again with the overlay — reachable only by pointing both
> configurations at the same database. `scripts/clean-dev` then a seeded `migrate` fixes
> it, or `docker compose down -v && docker compose up` for the stack's own database.

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
| `docker` | the pinned `flyway/flyway:11` image | otherwise, so no local Java is needed |

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
what `R__dev_seed.sql` actually put in a development database, one assertion per row.
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

## Continuous integration

[`ci/db`](../.github/workflows/db.yml) is what runs all of the above on a pull request
that touches this directory, the compose file, `.env.example` or the workflow itself
([#11](https://github.com/NobuData/ouroboros/issues/11) set the routing;
[#24](https://github.com/NobuData/ouroboros/issues/24) added the live pass). It runs in
two halves, cheap first — a misnamed migration is worth reporting before a database is
waited on.

| Step | What it proves | Needs a database |
|---|---|---|
| `scripts/verify-dev-env.sh` | Migration naming, the pinned images and healthcheck gate, `flyway.toml`'s settings, credential hygiene, `.env.example` coverage | no |
| `scripts/run-tests.sh ouroboros-db/tests` | `run.sh` and the four commands, against stubbed runners | no |
| `scripts/migrate` | Every migration applies, in order, to a database that has never seen them | yes |
| `scripts/validate` | Checksums and the naming rule, read back from the history that pass wrote | yes |
| `tests/constraints.sql` | What the schema *enforces* — the half `validate` cannot see | yes |
| `scripts/migrate --config flyway.seed.toml` ×2 | The seed applies, and applies twice without changing anything | yes (a second one) |
| `tests/seed.sql` | The demo tenant is there, exactly once, with the ids the documentation publishes | yes (that one) |

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
  production migration does — apply `R__dev_seed.sql` and insert nothing, because
  `${ouro_dev_seed}` is `false` in `flyway.toml` — so the overlay is layered onto a
  second database instead. Migrating it twice before asserting is the idempotency
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
`flyway/flyway:11-alpine` the compose stack and `run.sh` already use — and `publish/db`
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
5. **Dev seed data never runs in production** — every statement in `R__dev_seed.sql`
   ends `and ${ouro_dev_seed}`, which is `false` in `flyway.toml` and `true` only in
   `flyway.seed.toml`. A seed statement without that guard is the one thing
   `tests/seed.test.sh` counts.

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
├── scripts/
│   ├── dev                           # up, healthy, migrated — the `dev` verb
│   ├── migrate                       # apply what is pending
│   ├── info                          # applied and pending versions
│   ├── validate                      # checksums and naming rules
│   └── clean-dev                     # drop everything — gated three ways
├── migrations/
│   ├── V000__bootstrap.sql           # the schema itself
│   ├── V001__tenants.sql             # tenants, tenant_domains — #20
│   ├── V002__users_membership.sql    # users, user_identities, tenant_members — #21
│   ├── V003__github_enablement.sql   # github_orgs, github_repos — #22
│   └── R__dev_seed.sql               # deterministic demo data, dev only — #23
└── tests/
    ├── lib/
    │   ├── fixture.sh                # the synthetic module and stub runners the shell suites share
    │   └── assert.sql                # the assertion helpers the live-database suites share
    ├── run.test.sh                   # the runner
    ├── scripts.test.sh               # the four commands and the project configuration
    ├── seed.test.sh                  # the seed's guard, idempotency and determinism — #23
    ├── constraints.sql               # what the schema enforces, asserted against a live database
    └── seed.sql                      # what the seed put there, asserted against a live database
```

Everything below `V000` is named for the issue that lands it. `tests/constraints.sql` is
not — it grows with every migration that adds a rule, rather than belonging to one of
them.

## Schema

What the applied migrations define. `ouroboros-rest` reads this through Kysely; nothing
outside this module alters it.

| Table | Since | Holds | Enforces |
|---|---|---|---|
| `tenants` | `V001` | The isolated customer workspace — the root every other table cascades from | Unique DNS-shaped `slug`; `status` limited to `active`, `suspended`, `deleted` |
| `tenant_domains` | `V001` | Email domains that resolve a tenant at sign-in | Domain unique across *all* tenants and stored lower-cased; at most one `is_primary` per tenant |
| `users` | `V002` | A person — global, not tenant-scoped, so one human holds roles in several tenants | `email` unique across the installation and stored lower-cased; `avatar_url` restricted to `http(s)` |
| `user_identities` | `V002` | External accounts a person signs in with — GitHub today | `(provider, external_id)` unique, so one identity attaches to one user; `provider` CHECK-constrained. **Holds no token, secret or credential** |
| `tenant_members` | `V002` | A person's role in one tenant — mockup 17's member list | `(tenant_id, user_id)` is the primary key, so a user cannot join a tenant twice; `role` CHECK-constrained to `owner\|admin\|member\|viewer`, with no default |
| `github_orgs` | `V003` | GitHub orgs a tenant has enabled | `login` unique *per tenant*, stored lower-cased; `enabled` defaults false |
| `github_repos` | `V003` | Repos within an org | `name` unique per org, stored lower-cased; `enabled` defaults false |

Four conventions run through these, and are worth knowing before adding a seventh:

1. **Case-folded on the way in, not at read time.** Domains, user emails, org logins and
   repo names are stored lower-cased and held there by a check constraint. That is what
   lets one plain unique btree be both the uniqueness rule and the case-insensitive
   lookup index — query with `where domain = lower($1)` and it is an index scan. It needs
   no `citext` extension, which a managed PostgreSQL may not grant the migration role
   rights to create. `users.email` needs its own `= lower(email)` constraint to enforce
   this; the other three get it free, because their format patterns admit no upper case.
2. **Enablement fails closed.** Both `enabled` flags default to `false`, and they are
   independent: a repo is in scope only when its own flag *and* its org's are true, so
   suspending an org preserves the per-repo choices underneath. These two tables bound
   where Ouroboros may operate, so anything arriving by an undesigned path arrives off.
3. **`updated_at` is one shared trigger.** `ouroboros.touch_updated_at()`, defined in
   `V001` and attached by every table since, stamps from the server clock and overwrites
   whatever the statement supplied. One function means the behaviour cannot drift between
   tables.
4. **No credential is stored in this schema.** `user_identities` records *which* external
   account a person proved control of, never a token, refresh token or secret. Obtaining
   a live GitHub session, encrypting it and revoking it is `ouroboros-rest`'s concern
   ([#33](https://github.com/NobuData/ouroboros/issues/33)); a credential here would split
   that responsibility across two modules and make every `select *` over the tenancy
   schema a secret-bearing query. `tests/constraints.sql` asserts the absence by reading
   `information_schema`, so a column added later is caught rather than merely discouraged.

Deleting a tenant cascades the whole way down — domains, memberships, orgs, and the orgs'
repos — so nothing is left naming a tenant that is gone. It stops at the people: deleting
a tenant removes the *memberships*, not the `users` rows, since a person may hold roles in
tenants that remain. Deleting a user is the cascade in the other direction, and takes
their identities and memberships with them. `status = 'deleted'` is the soft-delete marker
that leaves the rows in place; a real `delete` is what cascades.

## Related issues

Scaffold [#19](https://github.com/NobuData/ouroboros/issues/19) ·
tenants & domains [#20](https://github.com/NobuData/ouroboros/issues/20) *(done)* ·
users & membership [#21](https://github.com/NobuData/ouroboros/issues/21) *(done)* ·
GitHub enablement [#22](https://github.com/NobuData/ouroboros/issues/22) *(done)* ·
dev seed [#23](https://github.com/NobuData/ouroboros/issues/23) *(done)* ·
migration CI [#24](https://github.com/NobuData/ouroboros/issues/24) *(done)* ·
full epic [#3](https://github.com/NobuData/ouroboros/issues/3).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
