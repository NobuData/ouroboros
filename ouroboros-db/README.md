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
> enforce. The dev seed ([#23](https://github.com/NobuData/ouroboros/issues/23)) is still
> to come.

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
second `up` reports "no migration necessary". No `.env` file is needed: every value has
a development default. Copy the repo-root `.env.example` to `.env` to change any of them.

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

[`tests/constraints.sql`](tests/constraints.sql) is the other half, and it is separate
because it needs the one thing that suite deliberately does without: a database with the
migrations applied. It asserts what the schema *enforces* — every uniqueness rule, check
constraint, cascade, trigger and index the migrations claim — because `validate` compares
checksums rather than behaviour, and a `unique` on the wrong columns passes it. Run it
against a migrated database:

```bash
PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros \
  -v ON_ERROR_STOP=1 -f ouroboros-db/tests/constraints.sql
```

It creates its own fixtures inside a transaction and rolls back, so it leaves no rows
behind and is safe to repeat against a database that is already in use. A passing run
prints one line; a failure names the rule and exits non-zero, which is what makes it a CI
step — [#24](https://github.com/NobuData/ouroboros/issues/24) wires it into `ci/db`. A
migration that adds a rule adds its assertion here in the same change.

## Configuration

Two files, because they answer two different questions.

**[`flyway.toml`](flyway.toml) — how migrations are applied.** Where they are, that the
schema is created if absent, that a misnamed file fails the run, and that `clean` is
off. Every path reads it: the compose stack, `run.sh`, and the `scripts/` commands are
all pointed at this directory with `-workingDirectory`, so there is one place to change
a rule and no way for `up` and a hand-run migration to disagree.
[`flyway.dev.toml`](flyway.dev.toml) is a one-setting overlay that only `clean-dev`
loads. Neither carries a url, a user or a password — those describe a machine, not a
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

These are non-negotiable. `ci/db` checks them on every pull request touching this
directory, and Flyway's own `validateMigrationNaming` and `validate` enforce them again
whenever the migrations are applied — see [conventions](../docs/CONVENTIONS.md#9-ci) for
what `ci/db` covers today and what
[#24](https://github.com/NobuData/ouroboros/issues/24) adds to it.

1. **Versioned migrations are immutable.** Once `V###__*.sql` has been applied
   anywhere, it is never edited — fix forward with a new version.
2. **Plain SQL only**, one concern per migration.
3. **Repeatable migrations (`R__*.sql`) are for seeds and views only** — never for
   schema that other migrations depend on.
4. **Naming:** `V###__snake_case_description.sql` / `R__snake_case_description.sql`.
   `validateMigrationNaming` fails the build on anything else.
5. **Dev seed data never runs in production** — it is gated by the dev Flyway config.

## Layout

```
ouroboros-db/
├── flyway.toml                       # the project: locations, schema, naming, clean off
├── flyway.dev.toml                   # the overlay that re-enables clean — dev only
├── run.sh                            # apply migrations to a live database
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
│   └── R__dev_seed.sql               # deterministic demo data, dev only — #23, pending
└── tests/
    ├── run.test.sh                   # the runner
    ├── scripts.test.sh               # the four commands and the project configuration
    └── constraints.sql               # what the schema enforces, asserted against a live database
```

Everything below `V000` is named for the issue that lands it; the one marked *pending* is
the version that issue will take. `tests/constraints.sql` is not — it grows with every
migration that adds a rule, rather than belonging to one of them.

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
dev seed [#23](https://github.com/NobuData/ouroboros/issues/23) ·
migration CI [#24](https://github.com/NobuData/ouroboros/issues/24) ·
full epic [#3](https://github.com/NobuData/ouroboros/issues/3).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
