# ouroboros-db

> **Status:** migrations run. [#10](https://github.com/NobuData/ouroboros/issues/10)
> added `migrations/` and the repo-root compose stack that applies it, so
> `docker compose up` gives you a live, migrated database today. The rest of the Flyway
> project — `flyway.toml`, the `scripts/` wrappers, `tests/` — lands in
> [#19](https://github.com/NobuData/ouroboros/issues/19) (epic
> [#3](https://github.com/NobuData/ouroboros/issues/3)); until then the sections below
> marked *(pending #19)* are the contract that scaffold must satisfy.

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
| CI | `flyway migrate` + `validate` against a throwaway PostgreSQL |

## Run

The database comes from the repo-root compose file
([#10](https://github.com/NobuData/ouroboros/issues/10)). Run these from the **repo
root**, not from this directory:

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
from scratch. Use it whenever a migration has been edited or the data has drifted.

If `up` fails with `bind: address already in use`, something else on the machine already
holds 5432 — a system PostgreSQL, or another project's stack. Publish this one somewhere
else instead of stopping that:

```bash
OURO_DB_PORT=45432 docker compose up
```

The port only changes where the database is published on the host; inside the compose
network it is always `db:5432`, and it is only ever published on `127.0.0.1`.

Migration operations are wrapped in dependency-free scripts *(pending #19)*:

```bash
scripts/migrate               # apply pending migrations
scripts/info                  # migration history and pending versions
scripts/validate              # verify checksums and naming rules
scripts/clean-dev             # drop everything — refuses to run outside dev
```

## Configuration

Development default port: **5432**. Every variable is declared with its development
default in the repo-root [`.env.example`](../.env.example); the compose stack falls back
to those defaults when no `.env` exists.

| Variable | Purpose |
|---|---|
| `OURO_DATABASE_URL` | Connection string used by the scripts and by `ouroboros-rest` |
| `OURO_DB_USER` / `OURO_DB_PASSWORD` | Credentials for the local compose database |
| `OURO_DB_NAME` | Database name, default `ouroboros` |
| `OURO_DB_SCHEMA` | Schema Flyway owns and migrates, default `ouroboros` |
| `OURO_DB_PORT` | Host port the container publishes, default `5432` |

`OURO_DB_USER`, `OURO_DB_PASSWORD` and `OURO_DB_NAME` are read by PostgreSQL's own
first-boot initialisation. Changing one after the volume exists has no effect until the
volume is dropped — `docker compose down -v`, then `up`.

## Migration rules

These are non-negotiable and enforced by `flyway validate` in CI:

1. **Versioned migrations are immutable.** Once `V###__*.sql` has been applied
   anywhere, it is never edited — fix forward with a new version.
2. **Plain SQL only**, one concern per migration.
3. **Repeatable migrations (`R__*.sql`) are for seeds and views only** — never for
   schema that other migrations depend on.
4. **Naming:** `V###__snake_case_description.sql` / `R__snake_case_description.sql`.
   `validateMigrationNaming` fails the build on anything else.
5. **Dev seed data never runs in production** — it is gated by the dev Flyway config.

## Layout (target)

```
ouroboros-db/
├── flyway.toml
├── migrations/
│   ├── V000__bootstrap.sql           # the schema itself — landed by #10
│   ├── V001__tenants.sql             # tenants, tenant_domains
│   ├── V002__users_membership.sql    # users, user_identities, tenant_members
│   ├── V003__github_enablement.sql   # github_orgs, github_repos
│   └── R__dev_seed.sql               # deterministic demo data, dev only
├── scripts/{migrate,info,validate,clean-dev}
└── tests/constraints.sql             # assertion queries run in CI
```

## Related issues

Scaffold [#19](https://github.com/NobuData/ouroboros/issues/19) ·
tenants & domains [#20](https://github.com/NobuData/ouroboros/issues/20) ·
users & membership [#21](https://github.com/NobuData/ouroboros/issues/21) ·
GitHub enablement [#22](https://github.com/NobuData/ouroboros/issues/22) ·
dev seed [#23](https://github.com/NobuData/ouroboros/issues/23) ·
migration CI [#24](https://github.com/NobuData/ouroboros/issues/24) ·
full epic [#3](https://github.com/NobuData/ouroboros/issues/3).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
