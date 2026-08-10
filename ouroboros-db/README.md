# ouroboros-db

> **Status:** directory reserved — the Flyway project scaffold lands in
> [#19](https://github.com/NobuData/ouroboros/issues/19) (epic
> [#3](https://github.com/NobuData/ouroboros/issues/3)). Until then this README is the
> contract the scaffold must satisfy.

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

The database itself comes from the repo-root compose file
([#10](https://github.com/NobuData/ouroboros/issues/10)):

```bash
docker compose up db          # PostgreSQL 17 on :5432, migrations applied
docker compose down -v        # reset — drops the volume and all data
```

Migration operations are wrapped in dependency-free scripts:

```bash
scripts/migrate               # apply pending migrations
scripts/info                  # migration history and pending versions
scripts/validate              # verify checksums and naming rules
scripts/clean-dev             # drop everything — refuses to run outside dev
```

## Configuration

Development default port: **5432**.

| Variable | Purpose |
|---|---|
| `OURO_DATABASE_URL` | Connection string used by the scripts and by `ouroboros-rest` |
| `OURO_DB_USER` / `OURO_DB_PASSWORD` | Credentials for the local compose database |
| `OURO_DB_NAME` | Database name, default `ouroboros` |

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
