# ouroboros-db

> **Status:** migrations run. [#10](https://github.com/NobuData/ouroboros/issues/10)
> added `migrations/`, the repo-root compose stack that applies it, and
> [`run.sh`](run.sh) for applying it to a database that is already up — so
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

### Migrating a running database — `run.sh`

`docker compose up` migrates on the way up, which covers most days. `run.sh` is for
everything else: a migration you just wrote against a database already running, a
PostgreSQL installed on your machine, a server across the network.

```bash
cp ouroboros-db/.env.example ouroboros-db/.env   # point it at your database
ouroboros-db/run.sh                              # migrate — apply what is pending
ouroboros-db/run.sh info                         # applied and pending versions
ouroboros-db/run.sh validate                     # checksums and naming rules
ouroboros-db/run.sh --dry-run                    # print the command, run nothing
```

It connects by host and port like any other client, so **nothing has to be
containerised**. Out of the box it points at `localhost:5432`, which is both a default
PostgreSQL install and — with the port the compose stack publishes — the compose
database.

Flyway itself comes from whichever is available, and `--runner` overrides the choice:

| Runner | What it uses | When it is chosen |
|---|---|---|
| `flyway` | the `flyway` on your PATH | automatically, if you have one — no Docker at all |
| `docker` | the pinned `flyway/flyway:11` image | otherwise, so no local Java is needed |

```bash
ouroboros-db/run.sh --runner docker    # ignore the local install
ouroboros-db/run.sh --runner flyway    # insist on it
```

When the container runs against a database on this machine it is given host networking,
because a server bound to loopback — which both a default PostgreSQL install and the
compose stack are — is not otherwise reachable from inside a container.

Parameters come from `ouroboros-db/.env`, then the repo-root `.env`, then the defaults,
and anything already in the environment beats all three. So a one-off needs no file:

```bash
OURO_DB_PORT=45432 OURO_DB_SCHEMA=scratch ouroboros-db/run.sh info
```

Any argument it does not recognise goes to Flyway untouched, and the password is never
printed — not in the progress line, not by `--dry-run`.

> `run.sh` migrates whatever `OURO_DB_HOST`/`OURO_DB_PORT` resolve to, and the default
> is `localhost:5432`. If you have a PostgreSQL of your own there, that is the one it
> will migrate. `--dry-run` prints the target without touching it.

The fuller set of wrappers is still to come *(pending #19)*:

```bash
scripts/migrate               # apply pending migrations
scripts/info                  # migration history and pending versions
scripts/validate              # verify checksums and naming rules
scripts/clean-dev             # drop everything — refuses to run outside dev
```

## Configuration

Development default port: **5432**. Two templates, because they answer two questions:
[`.env.example`](.env.example) here is *which database `run.sh` migrates*, and the
repo-root [`../.env.example`](../.env.example) is *every `OURO_*` variable the whole
system reads*. Both carry development defaults, so the stack and the runner work with
no `.env` at all.

| Variable | Purpose |
|---|---|
| `OURO_DATABASE_URL` | Connection string used by `ouroboros-rest` |
| `OURO_DB_HOST` | Host `run.sh` connects to, default `localhost` |
| `OURO_DB_PORT` | Port it connects to, and the one the container publishes, default `5432` |
| `OURO_DB_USER` / `OURO_DB_PASSWORD` | Credentials for the database |
| `OURO_DB_NAME` | Database name, default `ouroboros` |
| `OURO_DB_SCHEMA` | Schema Flyway owns and migrates, default `ouroboros` |

`OURO_DB_USER`, `OURO_DB_PASSWORD` and `OURO_DB_NAME` are read by PostgreSQL's own
first-boot initialisation. Changing one after the volume exists has no effect until the
volume is dropped — `docker compose down -v`, then `up`.

## Migration rules

These are non-negotiable. `ci/db` checks the naming rule on every pull request touching
this directory, and Flyway's own `validateMigrationNaming` and `validate` enforce the
rest whenever the migrations are applied — see [conventions](../docs/CONVENTIONS.md#9-ci)
for what `ci/db` covers today and what
[#24](https://github.com/NobuData/ouroboros/issues/24) adds to it.

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
├── run.sh                            # apply migrations to a live database — #10
├── .env.example                      # which database run.sh migrates — #10
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
