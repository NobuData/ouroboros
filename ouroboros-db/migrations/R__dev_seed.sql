-- R__dev_seed.sql — the demo tenant, in a development database and nowhere else.
--
-- Local development and the e2e smoke test both need data they can assert against by
-- name. Every screen in docs/mockups is drawn around one workspace — `acme-robotics`,
-- its people, and the `helios-firmware` repository — so that is what this puts in the
-- database: the same content the mockups show, with ids that never change between
-- machines or between runs.
--
-- Three properties make it safe to apply to a development database on every `up`, and
-- each of them is asserted by a test:
--
-- 1. **It cannot run in production.** Every statement here carries
--    `and ${ouro_dev_seed}`, and that placeholder is `false` in flyway.toml — the
--    configuration the compose stack's production counterpart, `scripts/migrate`, CI
--    and every hand-run migration read. Only flyway.seed.toml sets it to `true`, and
--    the only thing that loads flyway.seed.toml is the development compose stack (and
--    `scripts/migrate --config flyway.seed.toml`, run deliberately). With the
--    placeholder `false` every statement below is `insert … select … where false`,
--    which inserts nothing; the migration still applies, and applies as a no-op.
--    Removing the placeholder from flyway.toml does not silently enable the seed — it
--    fails the run, because Flyway refuses a migration whose placeholder has no value.
--
-- 2. **It is idempotent.** Every id is a literal, so a second application computes the
--    same rows, and every statement ends `on conflict do nothing`, so it writes none of
--    them. `migrate` twice leaves the database byte-for-byte where the first pass left
--    it — including the timestamps, which are the row's real creation time and are not
--    rewritten by a pass that inserts nothing.
--
-- 3. **It never fails on a database somebody has edited.** Child rows find their parent
--    by its natural key — the tenant by slug, a user by email — rather than by naming
--    the parent's id a second time. A developer who deleted the demo tenant by hand gets
--    a seed that quietly re-creates what it can, not a foreign-key error on every
--    subsequent `docker compose up`.
--
-- Ids are literal `5eed…` uuids, listed in the table below and repeated at each use. A
-- uuid beginning `5eed` came from this file: that is the whole convention, and it is
-- what lets a developer reading a log or a URL tell demo data from something they
-- created. They are structurally ordinary v4 uuids, so nothing has to treat them
-- specially.
--
--   | Row                                  | Id                                     |
--   |--------------------------------------|----------------------------------------|
--   | tenant `acme-robotics`               | `5eed0001-0000-4000-8000-000000000001` |
--   | domain `acme-robotics.dev`           | `5eed0002-0000-4000-8000-000000000001` |
--   | user Ken Suenobu (owner)             | `5eed0003-0000-4000-8000-000000000001` |
--   | user Maya Chen (admin)               | `5eed0003-0000-4000-8000-000000000002` |
--   | user Jorge Reyes (member)            | `5eed0003-0000-4000-8000-000000000003` |
--   | GitHub identity · Ken                | `5eed0004-0000-4000-8000-000000000001` |
--   | GitHub identity · Maya               | `5eed0004-0000-4000-8000-000000000002` |
--   | GitHub identity · Jorge              | `5eed0004-0000-4000-8000-000000000003` |
--   | org `acme-robotics`                  | `5eed0005-0000-4000-8000-000000000001` |
--   | repo `helios-firmware`               | `5eed0006-0000-4000-8000-000000000001` |
--
-- A repeatable migration rather than a versioned one, per ouroboros-db/README.md
-- § Migration rules: seeds and views are what `R__` is for, and a seed that grows with
-- the product must not become a chain of `V###` files nobody can re-run. Flyway applies
-- it after every versioned migration and re-applies it whenever this file changes.
--
-- One consequence of Flyway's own rules is worth knowing: the checksum is taken of this
-- file, before placeholders are substituted, so a database that has already recorded
-- this migration un-seeded does not pick the data up merely by being migrated again with
-- the overlay. That is only reachable by pointing both configurations at the same
-- database; the fix is `scripts/clean-dev` followed by a seeded `migrate`, and
-- `docker compose down -v && docker compose up` for the stack's own database.
--
-- Filed as issue #23.

-- ---------------------------------------------------------------------------
-- The tenant, and the domain that resolves it at sign-in.
--
-- `acme-robotics` is the workspace every mockup is drawn in; `acme-robotics.dev` is the
-- domain mockup 01 step 1 takes an email address at and turns into this tenant. It is
-- the tenant's primary domain because it is its only one — the product displays it back,
-- and a tenant with no primary would be rendering a blank.
-- ---------------------------------------------------------------------------
insert into ouroboros.tenants (id, slug, display_name, status)
select seed.id, seed.slug, seed.display_name, seed.status
  from (values
         ('5eed0001-0000-4000-8000-000000000001'::uuid,
          'acme-robotics', 'Acme Robotics', 'active')
       ) as seed (id, slug, display_name, status)
 where ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.tenant_domains (id, tenant_id, domain, is_primary)
select '5eed0002-0000-4000-8000-000000000001'::uuid, tenant.id, 'acme-robotics.dev', true
  from ouroboros.tenants tenant
 where tenant.slug = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The people.
--
-- Three, which is the smallest set that makes a member list worth rendering and a
-- permission check worth writing: one of them may do everything, one may administer,
-- one may only take part. Mockup 17's member table is these three rows joined to their
-- memberships below.
--
-- `avatar_url` is left null on purpose. The mockups draw monogram avatars — `KS`, `MC`,
-- `JR` — and null is what makes the UI take that path; a plausible-looking URL here
-- would be an image that 404s on every developer's machine and an assertion no e2e test
-- could make.
--
-- The mockups show two further rows this seed does not create: a `devops-bot` service
-- account and a pending invitation. Neither is a `users` row in this schema — a service
-- account has no person behind it, and an outstanding invitation is a membership with
-- `joined_at` null whose user does not exist yet — so both belong with the settings work
-- that models them rather than here.
-- ---------------------------------------------------------------------------
insert into ouroboros.users (id, email, display_name)
select seed.id, seed.email, seed.display_name
  from (values
         ('5eed0003-0000-4000-8000-000000000001'::uuid,
          'ken@acme-robotics.dev', 'Ken Suenobu'),
         ('5eed0003-0000-4000-8000-000000000002'::uuid,
          'maya@acme-robotics.dev', 'Maya Chen'),
         ('5eed0003-0000-4000-8000-000000000003'::uuid,
          'jorge@acme-robotics.dev', 'Jorge Reyes')
       ) as seed (id, email, display_name)
 where ${ouro_dev_seed}
on conflict do nothing;

-- The GitHub account each of them signs in with — mockup 01's "Continue with GitHub".
-- Without these the demo tenant has people who cannot authenticate, and the sign-in path
-- has nothing deterministic to resolve to.
--
-- `external_id` is GitHub's immutable numeric id, not a login, and these are invented
-- numbers in a range GitHub's own ids do not reach today. They exist to be *stable*, not
-- to be real: nothing in development calls GitHub with them.
--
-- No token, refresh token or secret is seeded, because the schema holds none — see
-- V002's header. A seed is exactly where a credential would be most tempting to put and
-- least noticed.
insert into ouroboros.user_identities (id, user_id, provider, external_id)
select seed.id, person.id, 'github', seed.external_id
  from (values
         ('5eed0004-0000-4000-8000-000000000001'::uuid,
          'ken@acme-robotics.dev', '900000001'),
         ('5eed0004-0000-4000-8000-000000000002'::uuid,
          'maya@acme-robotics.dev', '900000002'),
         ('5eed0004-0000-4000-8000-000000000003'::uuid,
          'jorge@acme-robotics.dev', '900000003')
       ) as seed (id, email, external_id)
  join ouroboros.users person on person.email = seed.email
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Who they are in the tenant.
--
-- Three of the four roles the schema accepts: `owner`, `admin` and `member`. `viewer` is
-- deliberately unseeded — a fourth person carrying it would be a row no mockup shows,
-- and the role is exercised by tests/constraints.sql, which is where a check constraint
-- belongs.
--
-- Mockup 17 labels these Owner / Maintainer / Viewer; the labels and the stored roles
-- are reconciled by the settings work, per V002's note on the column. `admin` is the
-- stored role behind the mockup's Maintainer.
--
-- Every membership is accepted — `joined_at` set, not null. An outstanding invitation is
-- a real state the member list renders, but it is a state, not demo *content*, and the
-- screens that need one create it.
-- ---------------------------------------------------------------------------
insert into ouroboros.tenant_members (tenant_id, user_id, role, invited_at, joined_at)
select tenant.id, person.id, seed.role, now(), now()
  from (values
         ('ken@acme-robotics.dev', 'owner'),
         ('maya@acme-robotics.dev', 'admin'),
         ('jorge@acme-robotics.dev', 'member')
       ) as seed (email, role)
  join ouroboros.users person on person.email = seed.email
 cross join ouroboros.tenants tenant
 where tenant.slug = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Where the loop may run.
--
-- Mockup 01 step 2 offers three orgs and this seeds the one the ticket names: the org
-- `acme-robotics`, enabled, holding the repository `helios-firmware`, enabled. Both
-- flags are set explicitly rather than left to their `false` defaults — an enablement
-- table whose rows are all off is a demo tenant in which nothing can happen.
--
-- `installed_at` stays null: no GitHub App has been installed on anything, and a
-- timestamp here would assert an installation that never happened. `default_branch` is
-- `main`, which for invented demo data is a choice rather than the unverified claim
-- V003 declines to make about a real repository.
-- ---------------------------------------------------------------------------
insert into ouroboros.github_orgs (id, tenant_id, login, enabled)
select '5eed0005-0000-4000-8000-000000000001'::uuid, tenant.id, 'acme-robotics', true
  from ouroboros.tenants tenant
 where tenant.slug = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.github_repos (id, org_id, name, enabled, default_branch)
select '5eed0006-0000-4000-8000-000000000001'::uuid, org.id, 'helios-firmware', true, 'main'
  from ouroboros.github_orgs org
  join ouroboros.tenants tenant on tenant.id = org.tenant_id
 where tenant.slug = 'acme-robotics'
   and org.login = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;
