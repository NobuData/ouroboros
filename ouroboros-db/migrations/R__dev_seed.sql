-- R__dev_seed.sql — the demo workspaces, in a development database and nowhere else.
--
-- Local development and the e2e smoke test both need data they can assert against by
-- name. Every screen in docs/mockups is drawn around the same demo content, and mockup
-- 01 Step 2 is its census: three organizations — `acme-robotics` with four enabled
-- repositories including `helios-firmware`, `acme-labs` with none, and `kensuenobu`,
-- one person's personal workspace with two — so that is what this puts in the
-- database: the same content the mockups show, number for number, with ids that never
-- change between machines or between runs.
--
-- Since V006 (#708) the workspaces live in the BetterAuth tables: a tenant is an
-- `organization`, the people are `"user"` rows with `account` rows for how they sign
-- in, and a role is a `member` row. The extension tables (`tenant_domains`,
-- `github_orgs`, `github_repos`) kept their names and hang off `organization_id`.
--
-- The people sign in two ways, and both are seeded (#709):
--
-- * **Password.** Each person holds a `credential` account whose `password` is a real
--   scrypt hash — the format BetterAuth's verifier accepts, produced with its own
--   parameters (N=16384, r=16, p=1, dkLen=64, `salt:key` both hex) — of the one
--   documented development password, `ouroboros-dev-password` (tests/e2e/support/
--   seed.ts, the db README). The salts are fixed (the account's own id, dashes
--   removed), so the hashes are literals and the seed stays deterministic. A password
--   hash in a seed is exactly the kind of value tests/seed.test.sh exists to notice;
--   it allows precisely these, in this format, and still forbids every token. The
--   plaintext is not secret — it is a documented dev credential that #705's provider
--   only accepts on a non-production stack — but it appears in documentation, not in
--   SQL, so no grep over this file's statements answers to it.
--
-- * **GitHub, shaped.** Ken also holds one GitHub-shaped `account` row — mockup 01's
--   "Continue with GitHub" needs someone deterministic to resolve to. One rather than
--   three: the OAuth path only ever completes for whoever is driving the dev stack,
--   and Maya and Jorge exist to fill member lists and role gates, which the password
--   rows already let them do.
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
--    by its natural key — an organization by slug, a person by email — rather than by
--    naming the parent's id a second time. A developer who deleted a demo workspace
--    by hand gets a seed that quietly re-creates what it can, not a foreign-key error
--    on every subsequent `docker compose up`.
--
-- The same convergence holds for a database V006 migrated rather than this file seeded:
-- the organization, people, domain, org and repo it carried all land on their old ids,
-- so every insert here meets its own row and does nothing, and the rows #709 added —
-- the second and third organization, the credential accounts — insert cleanly beside
-- them. (The original three `member` rows are the one exception — V006 minted their
-- ids — but the (organizationId, userId) unique key is a conflict too, so those
-- inserts also do nothing.)
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
--   | organization `acme-labs`             | `5eed0001-0000-4000-8000-000000000002` |
--   | organization `kensuenobu` (personal) | `5eed0001-0000-4000-8000-000000000003` |
--   | domain `acme-robotics.dev`           | `5eed0002-0000-4000-8000-000000000001` |
--   | "user" Ken Suenobu                   | `5eed0003-0000-4000-8000-000000000001` |
--   | "user" Maya Chen                     | `5eed0003-0000-4000-8000-000000000002` |
--   | "user" Jorge Reyes                   | `5eed0003-0000-4000-8000-000000000003` |
--   | GitHub account · Ken                 | `5eed0004-0000-4000-8000-000000000001` |
--   | org `acme-robotics`                  | `5eed0005-0000-4000-8000-000000000001` |
--   | org `acme-labs`                      | `5eed0005-0000-4000-8000-000000000002` |
--   | org `kensuenobu`                     | `5eed0005-0000-4000-8000-000000000003` |
--   | repo `helios-firmware`               | `5eed0006-0000-4000-8000-000000000001` |
--   | repo `helios-console`                | `5eed0006-0000-4000-8000-000000000002` |
--   | repo `helios-telemetry`              | `5eed0006-0000-4000-8000-000000000003` |
--   | repo `atlas-scheduler`               | `5eed0006-0000-4000-8000-000000000004` |
--   | repo `dotfiles`                      | `5eed0006-0000-4000-8000-000000000005` |
--   | repo `ouroboros-playground`          | `5eed0006-0000-4000-8000-000000000006` |
--   | member · Ken owner of acme-robotics  | `5eed0007-0000-4000-8000-000000000001` |
--   | member · Maya admin of acme-robotics | `5eed0007-0000-4000-8000-000000000002` |
--   | member · Jorge member of acme-robotics | `5eed0007-0000-4000-8000-000000000003` |
--   | member · Maya owner of acme-labs     | `5eed0007-0000-4000-8000-000000000004` |
--   | member · Ken member of acme-labs     | `5eed0007-0000-4000-8000-000000000005` |
--   | member · Ken owner of kensuenobu     | `5eed0007-0000-4000-8000-000000000006` |
--   | credential account · Ken             | `5eed0008-0000-4000-8000-000000000001` |
--   | credential account · Maya            | `5eed0008-0000-4000-8000-000000000002` |
--   | credential account · Jorge           | `5eed0008-0000-4000-8000-000000000003` |
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
-- A related consequence of insert-only convergence: a development database seeded
-- before #709 keeps the two GitHub-shaped accounts that revision removed (Maya's and
-- Jorge's, `5eed0004…02` and `…03`) — a seed never deletes. tests/seed.sql counts
-- exactly the rows this file creates, so against such a database its census fails;
-- `docker compose down -v && docker compose up` is the reset that makes the two agree.
--
-- Filed as issue #23; moved to the BetterAuth shape by #708; grown into the full
-- auth-aware demo set — three organizations, password sign-in — by #709.

-- ---------------------------------------------------------------------------
-- The organizations, and the domain that resolves one of them at sign-in.
--
-- Three, because mockup 01 Step 2 renders three rows and this seed is that screen's
-- data. `acme-robotics` is the shared workspace every other mockup is drawn in;
-- `acme-labs` is a second shared workspace with nothing enabled in it, which is what
-- makes Step 2's off-switch and #714's role gate honest screens rather than
-- decorations; `kensuenobu` is Ken's personal workspace, the shape #704 creates for
-- one person at first sign-in.
--
-- `metadata` is `{"personal": true}` on `kensuenobu` — the flag the Step 2 mockup's
-- "personal" pill renders — and null on the shared two, where the claim would be
-- false. The column is text carrying JSON (V005: the library round-trips it), so the
-- value here is a JSON text literal, not a cast.
--
-- `acme-robotics.dev` is the domain mockup 01 Step 1 takes an email address at and
-- turns into the acme-robotics workspace, and it is that organization's primary
-- domain because it is its only one. The other two organizations have no domain: a
-- personal workspace is not signed into by address, and acme-labs having none is what
-- keeps the domain path resolving to exactly one workspace.
--
-- `createdAt` has no default on this table (the library always supplies it), so the
-- seed does the same; idempotency keeps it stable, because a re-run inserts nothing.
-- ---------------------------------------------------------------------------
insert into ouroboros.organization ("id", "name", "slug", "createdAt", "metadata")
select seed.id, seed.name, seed.slug, now(), seed.metadata
  from (values
         ('5eed0001-0000-4000-8000-000000000001',
          'Acme Robotics', 'acme-robotics', null),
         ('5eed0001-0000-4000-8000-000000000002',
          'Acme Labs', 'acme-labs', null),
         ('5eed0001-0000-4000-8000-000000000003',
          'Ken Suenobu', 'kensuenobu', '{"personal": true}')
       ) as seed (id, name, slug, metadata)
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
-- `emailVerified` is true for all three. For Ken it is a fact — he holds the GitHub
-- account below, and a GitHub sign-in only completes with a verified primary address,
-- the same reasoning V004's back-fill applied. For the other two it is the state a
-- completed verification would have left, and the one that keeps demo sign-ins from
-- tripping over a verification email no development stack sends.
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

-- The GitHub-shaped account — mockup 01's "Continue with GitHub", for the one person
-- driving the dev stack.
--
-- `accountId` is GitHub's immutable numeric id, not a login, and this is an invented
-- number in a range GitHub's own ids do not reach today. It exists to be *stable*, not
-- to be real: nothing in development calls GitHub with it.
--
-- Only the identity columns are written. The `account` table can hold the library's
-- encrypted OAuth values, and a null there is the honest state "recognised, has not
-- signed in yet", which the next real sign-in fills in. tests/seed.test.sh greps this
-- file to keep every token out of it.
insert into ouroboros.account ("id", "accountId", "providerId", "userId", "updatedAt")
select '5eed0004-0000-4000-8000-000000000001', '900000001', 'github', person."id", now()
  from ouroboros."user" person
 where person."email" = 'ken@acme-robotics.dev'
   and ${ouro_dev_seed}
on conflict do nothing;

-- The credential accounts — mockup 01's development-only email/password form (#705).
--
-- Each hash is scrypt over the documented development password with the library's own
-- parameters, precomputed so the seed stays a file of literals; BetterAuth's verifier
-- accepts them as written, which is what lets a developer — and the e2e gate — type
-- the documented password and get a session. `accountId` is the user's own id, which
-- is what the library's credential provider writes there.
insert into ouroboros.account ("id", "accountId", "providerId", "userId", "password", "updatedAt")
select seed.id, person."id", 'credential', person."id", seed.hash, now()
  from (values
         ('5eed0008-0000-4000-8000-000000000001', 'ken@acme-robotics.dev',
          '5eed0008000040008000000000000001:f6b4a720fbe55eb3e4d40fb0b22798442fe9758e1f9d69863bfc91ec5606196c5fbe89ec7873469940d1f8e2ebf5a3b2a0658713cab96da8bc3aa70ea57a9548'),
         ('5eed0008-0000-4000-8000-000000000002', 'maya@acme-robotics.dev',
          '5eed0008000040008000000000000002:f47c2d1dd057ef98a887e38d34b91497bb7b93c83f021ba829fd54590eaa8681d5ac4df50b1e24e4de8e4fb237dfe78e161ebdb67a2841a4abdc61b58ac86433'),
         ('5eed0008-0000-4000-8000-000000000003', 'jorge@acme-robotics.dev',
          '5eed0008000040008000000000000003:cac66e66dc6ee05f8d43cb7a07c05d5ceeb6fad90dc7bac62cb7a2e4777ed05b27ef9b6177993185c8fdfd621dbb4b1000ae6dee73a9e4196c6fba10c8584e86')
       ) as seed (id, email, hash)
  join ouroboros."user" person on person."email" = seed.email
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Who they are in each workspace.
--
-- Three of the four roles the application accepts — `owner`, `admin` and `member` —
-- spread so that every organization has exactly one owner and the role gate (#714)
-- has someone to refuse in each shared workspace: Jorge is only a member of
-- acme-robotics, and Ken — owner elsewhere — is only a member of acme-labs. Ken
-- belongs to all three, which is what makes Step 2 render three rows for the person
-- the dev stack signs in as. `viewer` — #704's custom access-control role — is
-- deliberately unseeded: a sixth person carrying it would be a row no mockup shows,
-- and the role's meaning is asserted where it is defined, in ouroboros-rest's
-- organization.roles tests.
--
-- Mockup 17 labels these Owner / Maintainer / Viewer; the labels and the stored roles
-- are reconciled by the settings work. `admin` is the stored role behind the mockup's
-- Maintainer.
-- ---------------------------------------------------------------------------
insert into ouroboros.member ("id", "organizationId", "userId", "role", "createdAt")
select seed.id, org."id", person."id", seed.role, now()
  from (values
         ('5eed0007-0000-4000-8000-000000000001',
          'acme-robotics', 'ken@acme-robotics.dev', 'owner'),
         ('5eed0007-0000-4000-8000-000000000002',
          'acme-robotics', 'maya@acme-robotics.dev', 'admin'),
         ('5eed0007-0000-4000-8000-000000000003',
          'acme-robotics', 'jorge@acme-robotics.dev', 'member'),
         ('5eed0007-0000-4000-8000-000000000004',
          'acme-labs', 'maya@acme-robotics.dev', 'owner'),
         ('5eed0007-0000-4000-8000-000000000005',
          'acme-labs', 'ken@acme-robotics.dev', 'member'),
         ('5eed0007-0000-4000-8000-000000000006',
          'kensuenobu', 'ken@acme-robotics.dev', 'owner')
       ) as seed (id, slug, email, role)
  join ouroboros."user" person on person."email" = seed.email
  join ouroboros.organization org on org."slug" = seed.slug
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Where the loop may run.
--
-- Mockup 01 Step 2, number for number: `acme-robotics` on, with four repositories
-- enabled, `helios-firmware` among them; `acme-labs` off, with none; `kensuenobu` on,
-- with two. The org flags differ on purpose — acme-labs is the row whose switch the
-- mockup draws off — and every repository row is enabled, so each org's repo count is
-- the number the screen shows. The demo GitHub logins happen to equal their
-- workspace's slug, which is why one value serves both joins below.
--
-- `installed_at` stays null: no GitHub App has been installed on anything, and a
-- timestamp here would assert an installation that never happened. `default_branch` is
-- `main`, which for invented demo data is a choice rather than the unverified claim
-- V003 declines to make about a real repository.
-- ---------------------------------------------------------------------------
insert into ouroboros.github_orgs (id, organization_id, login, enabled)
select seed.id::uuid, org."id", seed.login, seed.enabled
  from (values
         ('5eed0005-0000-4000-8000-000000000001', 'acme-robotics', true),
         ('5eed0005-0000-4000-8000-000000000002', 'acme-labs', false),
         ('5eed0005-0000-4000-8000-000000000003', 'kensuenobu', true)
       ) as seed (id, login, enabled)
  join ouroboros.organization org on org."slug" = seed.login
 where ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.github_repos (id, org_id, name, enabled, default_branch)
select seed.id::uuid, gh.id, seed.name, true, 'main'
  from (values
         ('5eed0006-0000-4000-8000-000000000001', 'acme-robotics', 'helios-firmware'),
         ('5eed0006-0000-4000-8000-000000000002', 'acme-robotics', 'helios-console'),
         ('5eed0006-0000-4000-8000-000000000003', 'acme-robotics', 'helios-telemetry'),
         ('5eed0006-0000-4000-8000-000000000004', 'acme-robotics', 'atlas-scheduler'),
         ('5eed0006-0000-4000-8000-000000000005', 'kensuenobu', 'dotfiles'),
         ('5eed0006-0000-4000-8000-000000000006', 'kensuenobu', 'ouroboros-playground')
       ) as seed (id, login, name)
  join ouroboros.organization org on org."slug" = seed.login
  join ouroboros.github_orgs gh on gh.organization_id = org."id" and gh.login = seed.login
 where ${ouro_dev_seed}
on conflict do nothing;
