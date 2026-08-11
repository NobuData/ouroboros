-- seed.sql — what R__dev_seed.sql put in the database, as assertions.
--
-- The other half of the seed's tests. tests/seed.test.sh reads the migration and the two
-- configuration files and asserts the properties that make the seed safe — guarded,
-- idempotent, deterministic. This asserts the one thing a file read cannot: that
-- applying it to a real PostgreSQL produces exactly the demo tenant every mockup, and
-- every e2e test written against it, expects to find.
--
-- Run it against a database migrated **with the seed enabled** — the compose stack, or
-- `scripts/migrate --config flyway.seed.toml`:
--
--   PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros \
--     -v ON_ERROR_STOP=1 -f ouroboros-db/tests/seed.sql
--
-- Run against a database migrated the production way it fails on the first assertion,
-- which is the correct answer rather than a shortcoming: a seeded database is what this
-- file describes, and #24's `ci/db` pass is where both configurations get their run.
--
-- **Running it after two `migrate` passes is the idempotency test.** Every assertion
-- below says "exactly one", so a seed that inserted its rows a second time fails here.
-- That is the acceptance criterion "running migrate twice changes nothing", stated in
-- the only place it can be observed.
--
-- Read-only: it opens no transaction, creates no fixture, and writes nothing. Safe
-- against a database somebody is working in.
--
-- Filed as issue #23.

\set ON_ERROR_STOP on

-- Passing assertions return void, so the only thing printed would be a screenful of
-- empty one-row tables; errors still reach stderr and still abort the script. A failure
-- is therefore the only thing this prints. Same reasoning as constraints.sql.
\o /dev/null

-- must_hold, shared with constraints.sql.
\ir lib/assert.sql

-- ---------------------------------------------------------------------------
-- The tenant and its domain.
-- ---------------------------------------------------------------------------

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.tenants
   where id = '5eed0001-0000-4000-8000-000000000001'
     and slug = 'acme-robotics'
     and display_name = 'Acme Robotics'
     and status = 'active'),
  'the demo tenant acme-robotics is seeded, exactly once, and is active');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.tenant_domains
   where id = '5eed0002-0000-4000-8000-000000000001'
     and domain = 'acme-robotics.dev'
     and is_primary
     and tenant_id = '5eed0001-0000-4000-8000-000000000001'),
  'acme-robotics.dev resolves the demo tenant and is its primary domain');

-- ---------------------------------------------------------------------------
-- The people, their GitHub identities, and their roles.
-- ---------------------------------------------------------------------------

select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.users
   where (id, email, display_name) in (
     ('5eed0003-0000-4000-8000-000000000001'::uuid, 'ken@acme-robotics.dev',   'Ken Suenobu'),
     ('5eed0003-0000-4000-8000-000000000002'::uuid, 'maya@acme-robotics.dev',  'Maya Chen'),
     ('5eed0003-0000-4000-8000-000000000003'::uuid, 'jorge@acme-robotics.dev', 'Jorge Reyes'))),
  'the three demo people are seeded with the documented ids and addresses');

-- Null on purpose: the mockups draw monogram avatars, and null is what makes the UI take
-- that path. An assertion rather than an omission, because a seed that quietly gained an
-- avatar URL would change what every one of those screens renders.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.users
   where id::text like '5eed%' and avatar_url is not null),
  'no demo person carries an avatar URL, so the UI renders its monogram');

select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.user_identities identity
     join ouroboros.users person on person.id = identity.user_id
    where identity.provider = 'github'
      and (identity.id, person.email, identity.external_id) in (
        ('5eed0004-0000-4000-8000-000000000001'::uuid, 'ken@acme-robotics.dev',   '900000001'),
        ('5eed0004-0000-4000-8000-000000000002'::uuid, 'maya@acme-robotics.dev',  '900000002'),
        ('5eed0004-0000-4000-8000-000000000003'::uuid, 'jorge@acme-robotics.dev', '900000003'))),
  'each demo person has the GitHub identity they sign in with');

select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.tenant_members membership
     join ouroboros.users person on person.id = membership.user_id
    where membership.tenant_id = '5eed0001-0000-4000-8000-000000000001'
      and membership.joined_at is not null
      and (person.email, membership.role) in (
        ('ken@acme-robotics.dev',   'owner'),
        ('maya@acme-robotics.dev',  'admin'),
        ('jorge@acme-robotics.dev', 'member'))),
  'the three demo people hold owner, admin and member, and all have joined');

-- The tenant has one owner and no more: the invariant V002 leaves to the tenancy API is
-- at least satisfied by the data every developer starts from.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.tenant_members
   where tenant_id = '5eed0001-0000-4000-8000-000000000001' and role = 'owner'),
  'the demo tenant has exactly one owner');

-- ---------------------------------------------------------------------------
-- Where the loop may run.
-- ---------------------------------------------------------------------------

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.github_orgs
   where id = '5eed0005-0000-4000-8000-000000000001'
     and tenant_id = '5eed0001-0000-4000-8000-000000000001'
     and login = 'acme-robotics'
     and enabled
     and installed_at is null),
  'the org acme-robotics is seeded and enabled, with no GitHub App installation claimed');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.github_repos
   where id = '5eed0006-0000-4000-8000-000000000001'
     and org_id = '5eed0005-0000-4000-8000-000000000001'
     and name = 'helios-firmware'
     and enabled
     and default_branch = 'main'),
  'the repo helios-firmware is seeded under that org and enabled');

-- Scope is the conjunction of the two flags (V003), so the demo repo being *in scope* is
-- a different statement from either flag being true, and it is the one the seed exists
-- to make true.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.github_repos repo
     join ouroboros.github_orgs org on org.id = repo.org_id
    where org.tenant_id = '5eed0001-0000-4000-8000-000000000001'
      and repo.enabled and org.enabled),
  'exactly one repository is in scope for the demo tenant: both flags true');

-- ---------------------------------------------------------------------------
-- The id convention.
--
-- Every row this seed creates carries a `5eed…` id, and that is what lets a developer
-- reading a log or a URL tell demo data from something they made. Asserted per table
-- rather than trusted, because a row added to the seed with a generated id would be
-- invisible to every assertion above and would break the convention silently.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 10 from (
     select id from ouroboros.tenants
      where id = '5eed0001-0000-4000-8000-000000000001'
     union all
     select id from ouroboros.tenant_domains where id::text like '5eed%'
     union all
     select id from ouroboros.users where id::text like '5eed%'
     union all
     select id from ouroboros.user_identities where id::text like '5eed%'
     union all
     select id from ouroboros.github_orgs where id::text like '5eed%'
     union all
     select id from ouroboros.github_repos where id::text like '5eed%'
   ) as seeded),
  'the seed created ten 5eed… rows and no eleventh');

\o
\echo 'seed.sql: all assertions passed'
