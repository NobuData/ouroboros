-- R__dev_seed.sql — the demo workspace, in a development database and nowhere else.
--
-- Local development and the e2e smoke test both need data they can assert against by
-- name. Every screen in docs/mockups is drawn around one workspace — `acme-robotics`,
-- its people, and the `helios-firmware` repository — so that is what this puts in the
-- database: the same content the mockups show, with ids that never change between
-- machines or between runs.
--
-- Since V006 (#708) the workspace lives in the BetterAuth tables: the tenant is an
-- `organization`, the people are `"user"` rows with `account` rows for their GitHub
-- sign-in, and a role is a `member` row. The extension tables (`tenant_domains`,
-- `github_orgs`, `github_repos`) kept their names and hang off `organization_id`. The
-- content is unchanged from the pre-V006 seed; only the tables it lands in moved.
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
--    by its natural key — the organization by slug, a person by email — rather than by
--    naming the parent's id a second time. A developer who deleted the demo workspace
--    by hand gets a seed that quietly re-creates what it can, not a foreign-key error
--    on every subsequent `docker compose up`.
--
-- The same convergence holds for a database V006 migrated rather than this file seeded:
-- the organization, people, accounts, domain, org and repo all land on their old ids,
-- so every insert here meets its own row and does nothing. (The `member` rows are the
-- one exception — V006 minted their ids — but the (organizationId, userId) unique key
-- is a conflict too, so those inserts also do nothing.)
--
-- Ids are literal `5eed…` values, listed in the table below and repeated at each use. An
-- id beginning `5eed` came from this file: that is the whole convention, and it is what
-- lets a developer reading a log or a URL tell demo data from something they created.
-- They are structurally ordinary v4 uuids; the BetterAuth tables hold them as `text`,
-- which is the same spelling V006 gave the rows it migrated.
--
--   | Row                                  | Id                                     |
--   |--------------------------------------|----------------------------------------|
--   | organization `acme-robotics`         | `5eed0001-0000-4000-8000-000000000001` |
--   | domain `acme-robotics.dev`           | `5eed0002-0000-4000-8000-000000000001` |
--   | "user" Ken Suenobu                   | `5eed0003-0000-4000-8000-000000000001` |
--   | "user" Maya Chen                     | `5eed0003-0000-4000-8000-000000000002` |
--   | "user" Jorge Reyes                   | `5eed0003-0000-4000-8000-000000000003` |
--   | GitHub account · Ken                 | `5eed0004-0000-4000-8000-000000000001` |
--   | GitHub account · Maya                | `5eed0004-0000-4000-8000-000000000002` |
--   | GitHub account · Jorge               | `5eed0004-0000-4000-8000-000000000003` |
--   | org `acme-robotics`                  | `5eed0005-0000-4000-8000-000000000001` |
--   | repo `helios-firmware`               | `5eed0006-0000-4000-8000-000000000001` |
--   | member · Ken (owner)                 | `5eed0007-0000-4000-8000-000000000001` |
--   | member · Maya (admin)                | `5eed0007-0000-4000-8000-000000000002` |
--   | member · Jorge (member)              | `5eed0007-0000-4000-8000-000000000003` |
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
-- Filed as issue #23; moved to the BetterAuth shape by #708. #709 is what grows it into
-- the full auth-aware demo set (a second org, a personal organization, password rows).

-- ---------------------------------------------------------------------------
-- The organization, and the domain that resolves it at sign-in.
--
-- `acme-robotics` is the workspace every mockup is drawn in; `acme-robotics.dev` is the
-- domain mockup 01 step 1 takes an email address at and turns into this workspace. It
-- is the organization's primary domain because it is its only one — the product
-- displays it back, and a workspace with no primary would be rendering a blank.
--
-- `metadata` is left null: this is a shared workspace, and `{"personal": true}` is the
-- flag #704 writes on the organization it creates for one person at first sign-in —
-- a claim that would be false here. `createdAt` has no default on this table (the
-- library always supplies it), so the seed does the same; idempotency keeps it stable,
-- because a re-run inserts nothing.
-- ---------------------------------------------------------------------------
insert into ouroboros.organization ("id", "name", "slug", "createdAt")
select seed.id, seed.name, seed.slug, now()
  from (values
         ('5eed0001-0000-4000-8000-000000000001',
          'Acme Robotics', 'acme-robotics')
       ) as seed (id, name, slug)
 where ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.tenant_domains (id, organization_id, domain, is_primary)
select '5eed0002-0000-4000-8000-000000000001'::uuid, org."id", 'acme-robotics.dev', true
  from ouroboros.organization org
 where org."slug" = 'acme-robotics'
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
-- `image` is left null on purpose. The mockups draw monogram avatars — `KS`, `MC`,
-- `JR` — and null is what makes the UI take that path; a plausible-looking URL here
-- would be an image that 404s on every developer's machine and an assertion no e2e test
-- could make.
--
-- `emailVerified` is true for all three, and that is a fact rather than a convenience:
-- each of them holds the GitHub account below, and a GitHub sign-in only completes with
-- a verified primary address — the same reasoning V004's back-fill applied.
-- ---------------------------------------------------------------------------
insert into ouroboros."user" ("id", "name", "email", "emailVerified")
select seed.id, seed.name, seed.email, true
  from (values
         ('5eed0003-0000-4000-8000-000000000001',
          'Ken Suenobu', 'ken@acme-robotics.dev'),
         ('5eed0003-0000-4000-8000-000000000002',
          'Maya Chen', 'maya@acme-robotics.dev'),
         ('5eed0003-0000-4000-8000-000000000003',
          'Jorge Reyes', 'jorge@acme-robotics.dev')
       ) as seed (id, name, email)
 where ${ouro_dev_seed}
on conflict do nothing;

-- The GitHub account each of them signs in with — mockup 01's "Continue with GitHub".
-- Without these the demo workspace has people who cannot authenticate, and the sign-in
-- path has nothing deterministic to resolve to.
--
-- `accountId` is GitHub's immutable numeric id, not a login, and these are invented
-- numbers in a range GitHub's own ids do not reach today. They exist to be *stable*, not
-- to be real: nothing in development calls GitHub with them.
--
-- Only the identity columns are written. The `account` table can hold the library's
-- encrypted OAuth values, but a seed is exactly where such a value would be most
-- tempting to put and least noticed — and a null there is the honest state "recognised,
-- has not signed in yet", which the next real sign-in fills in. tests/seed.test.sh
-- greps this file to keep it that way.
insert into ouroboros.account ("id", "accountId", "providerId", "userId", "updatedAt")
select seed.id, seed.github_id, 'github', person."id", now()
  from (values
         ('5eed0004-0000-4000-8000-000000000001',
          'ken@acme-robotics.dev', '900000001'),
         ('5eed0004-0000-4000-8000-000000000002',
          'maya@acme-robotics.dev', '900000002'),
         ('5eed0004-0000-4000-8000-000000000003',
          'jorge@acme-robotics.dev', '900000003')
       ) as seed (id, email, github_id)
  join ouroboros."user" person on person."email" = seed.email
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Who they are in the workspace.
--
-- Three of the four roles the application accepts: `owner`, `admin` and `member`.
-- `viewer` — #704's custom access-control role — is deliberately unseeded: a fourth
-- person carrying it would be a row no mockup shows, and the role's meaning is asserted
-- where it is defined, in ouroboros-rest's organization.roles tests.
--
-- Mockup 17 labels these Owner / Maintainer / Viewer; the labels and the stored roles
-- are reconciled by the settings work. `admin` is the stored role behind the mockup's
-- Maintainer.
-- ---------------------------------------------------------------------------
insert into ouroboros.member ("id", "organizationId", "userId", "role", "createdAt")
select seed.id, org."id", person."id", seed.role, now()
  from (values
         ('5eed0007-0000-4000-8000-000000000001',
          'ken@acme-robotics.dev', 'owner'),
         ('5eed0007-0000-4000-8000-000000000002',
          'maya@acme-robotics.dev', 'admin'),
         ('5eed0007-0000-4000-8000-000000000003',
          'jorge@acme-robotics.dev', 'member')
       ) as seed (id, email, role)
  join ouroboros."user" person on person."email" = seed.email
 cross join ouroboros.organization org
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Where the loop may run.
--
-- Mockup 01 step 2 offers three orgs and this seeds the one the ticket names: the org
-- `acme-robotics`, enabled, holding the repository `helios-firmware`, enabled. Both
-- flags are set explicitly rather than left to their `false` defaults — an enablement
-- table whose rows are all off is a demo workspace in which nothing can happen.
--
-- `installed_at` stays null: no GitHub App has been installed on anything, and a
-- timestamp here would assert an installation that never happened. `default_branch` is
-- `main`, which for invented demo data is a choice rather than the unverified claim
-- V003 declines to make about a real repository.
-- ---------------------------------------------------------------------------
insert into ouroboros.github_orgs (id, organization_id, login, enabled)
select '5eed0005-0000-4000-8000-000000000001'::uuid, org."id", 'acme-robotics', true
  from ouroboros.organization org
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.github_repos (id, org_id, name, enabled, default_branch)
select '5eed0006-0000-4000-8000-000000000001'::uuid, gh.id, 'helios-firmware', true, 'main'
  from ouroboros.github_orgs gh
  join ouroboros.organization org on org."id" = gh.organization_id
 where org."slug" = 'acme-robotics'
   and gh.login = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;
