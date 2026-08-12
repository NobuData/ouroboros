-- seed.sql — what R__dev_seed.sql put in the database, as assertions.
--
-- The other half of the seed's tests. tests/seed.test.sh reads the migration and the two
-- configuration files and asserts the properties that make the seed safe — guarded,
-- idempotent, deterministic. This asserts the one thing a file read cannot: that
-- applying it to a real PostgreSQL produces exactly the demo workspace every mockup, and
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
-- Filed as issue #23; moved to the BetterAuth shape by #708.

\set ON_ERROR_STOP on

-- Passing assertions return void, so the only thing printed would be a screenful of
-- empty one-row tables; errors still reach stderr and still abort the script. A failure
-- is therefore the only thing this prints. Same reasoning as constraints.sql.
\o /dev/null

-- must_hold, shared with constraints.sql.
\ir lib/assert.sql

-- ---------------------------------------------------------------------------
-- The organization and its domain.
-- ---------------------------------------------------------------------------

-- `metadata` null is asserted, not skipped: `{"personal": true}` is the pill mockup 01
-- Step 2 renders on somebody's personal workspace, and the demo workspace is shared —
-- a seed that quietly gained the flag would change what that screen shows.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.organization
   where "id" = '5eed0001-0000-4000-8000-000000000001'
     and "slug" = 'acme-robotics'
     and "name" = 'Acme Robotics'
     and "metadata" is null),
  'the demo organization acme-robotics is seeded, exactly once, and is not personal');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.tenant_domains
   where id = '5eed0002-0000-4000-8000-000000000001'
     and domain = 'acme-robotics.dev'
     and is_primary
     and organization_id = '5eed0001-0000-4000-8000-000000000001'),
  'acme-robotics.dev resolves the demo organization and is its primary domain');

-- ---------------------------------------------------------------------------
-- The people, their GitHub accounts, and their roles.
-- ---------------------------------------------------------------------------

select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros."user"
   where ("id", "email", "name") in (
     ('5eed0003-0000-4000-8000-000000000001', 'ken@acme-robotics.dev',   'Ken Suenobu'),
     ('5eed0003-0000-4000-8000-000000000002', 'maya@acme-robotics.dev',  'Maya Chen'),
     ('5eed0003-0000-4000-8000-000000000003', 'jorge@acme-robotics.dev', 'Jorge Reyes'))),
  'the three demo people are seeded with the documented ids and addresses');

-- Verified, because each of them holds a GitHub account and a GitHub sign-in only
-- completes with a verified primary address. BetterAuth's account linking consults this
-- column, so a false here would change how a real sign-in against demo data behaves.
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros."user"
   where "id" like '5eed%' and "emailVerified"),
  'every demo person is emailVerified — they arrive through a verifying provider');

-- Null on purpose: the mockups draw monogram avatars, and null is what makes the UI take
-- that path. An assertion rather than an omission, because a seed that quietly gained an
-- image URL would change what every one of those screens renders.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros."user"
   where "id" like '5eed%' and "image" is not null),
  'no demo person carries an image URL, so the UI renders its monogram');

select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.account acct
     join ouroboros."user" person on person."id" = acct."userId"
    where acct."providerId" = 'github'
      and (acct."id", person."email", acct."accountId") in (
        ('5eed0004-0000-4000-8000-000000000001', 'ken@acme-robotics.dev',   '900000001'),
        ('5eed0004-0000-4000-8000-000000000002', 'maya@acme-robotics.dev',  '900000002'),
        ('5eed0004-0000-4000-8000-000000000003', 'jorge@acme-robotics.dev', '900000003'))),
  'each demo person has the GitHub account they sign in with');

-- Nothing but the identity came across: no token and no password hash, because a null
-- there is the honest state "recognised, has not signed in yet" — and a seed is exactly
-- where a credential would be most tempting to put and least noticed.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.account
   where "id" like '5eed%'
     and ("accessToken" is not null or "refreshToken" is not null or "password" is not null)),
  'no demo account carries a token or a password hash');

select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.member membership
     join ouroboros."user" person on person."id" = membership."userId"
    where membership."organizationId" = '5eed0001-0000-4000-8000-000000000001'
      and (person."email", membership."role") in (
        ('ken@acme-robotics.dev',   'owner'),
        ('maya@acme-robotics.dev',  'admin'),
        ('jorge@acme-robotics.dev', 'member'))),
  'the three demo people hold owner, admin and member in the demo organization');

-- The organization has one owner and no more: the invariant the schema leaves to the
-- application is at least satisfied by the data every developer starts from.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.member
   where "organizationId" = '5eed0001-0000-4000-8000-000000000001' and "role" = 'owner'),
  'the demo organization has exactly one owner');

-- …and exactly the three members above — a fourth row would be invisible to the pair
-- assertions and would put a stranger into every member list the mockups render.
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.member
   where "organizationId" = '5eed0001-0000-4000-8000-000000000001'),
  'the demo organization has exactly three members');

-- ---------------------------------------------------------------------------
-- Where the loop may run.
-- ---------------------------------------------------------------------------

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.github_orgs
   where id = '5eed0005-0000-4000-8000-000000000001'
     and organization_id = '5eed0001-0000-4000-8000-000000000001'
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
    where org.organization_id = '5eed0001-0000-4000-8000-000000000001'
      and repo.enabled and org.enabled),
  'exactly one repository is in scope for the demo organization: both flags true');

-- ---------------------------------------------------------------------------
-- The id convention.
--
-- Every row this seed creates carries a `5eed…` id, and that is what lets a developer
-- reading a log or a URL tell demo data from something they made. Asserted per table
-- rather than trusted, because a row added to the seed with a generated id would be
-- invisible to every assertion above and would break the convention silently.
--
-- The BetterAuth tables hold their ids as text, the extension tables as uuids; casting
-- the latter makes the union one type.
--
-- `member` is deliberately not in the union. On a database seeded from empty its three
-- rows carry `5eed0007…` ids; on a database V006 *migrated*, the same three memberships
-- exist under ids the migration minted — the pair was the old primary key, so there was
-- no id to preserve — and the seed's inserts land on the (organizationId, userId)
-- conflict and change nothing. Both are correct states, the membership content itself
-- is pinned by the assertions above, and an id-shape assertion here would fail every
-- developer whose database was migrated rather than recreated.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 10 from (
     select "id" from ouroboros.organization where "id" like '5eed%'
     union all
     select "id" from ouroboros."user" where "id" like '5eed%'
     union all
     select "id" from ouroboros.account where "id" like '5eed%'
     union all
     select id::text from ouroboros.tenant_domains where id::text like '5eed%'
     union all
     select id::text from ouroboros.github_orgs where id::text like '5eed%'
     union all
     select id::text from ouroboros.github_repos where id::text like '5eed%'
   ) as seeded),
  'the seed created its ten fixed-id rows and no eleventh');

\o
\echo 'seed.sql: all assertions passed'
