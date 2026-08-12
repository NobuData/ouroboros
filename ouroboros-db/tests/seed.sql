-- seed.sql — what R__dev_seed.sql put in the database, as assertions.
--
-- The other half of the seed's tests. tests/seed.test.sh reads the migration and the two
-- configuration files and asserts the properties that make the seed safe — guarded,
-- idempotent, deterministic. This asserts the one thing a file read cannot: that
-- applying it to a real PostgreSQL produces exactly the demo content every mockup, and
-- every e2e test written against it, expects to find — mockup 01 Step 2's three
-- organizations, number for number.
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
-- Filed as issue #23; moved to the BetterAuth shape by #708; grown to the full
-- auth-aware demo set — three organizations, password sign-in — by #709.

\set ON_ERROR_STOP on

-- Passing assertions return void, so the only thing printed would be a screenful of
-- empty one-row tables; errors still reach stderr and still abort the script. A failure
-- is therefore the only thing this prints. Same reasoning as constraints.sql.
\o /dev/null

-- must_hold, shared with constraints.sql.
\ir lib/assert.sql

-- ---------------------------------------------------------------------------
-- The organizations and the domain.
--
-- Mockup 01 Step 2's three rows. `metadata` is asserted on all three — null on the
-- shared workspaces, `{"personal": true}` on Ken's — because the pill that column
-- renders is the visible difference between the rows, and a seed that quietly moved
-- the flag would change what that screen shows. The column is text carrying JSON;
-- the cast normalises spelling so the assertion is about content, not whitespace.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.organization
   where "id" = '5eed0001-0000-4000-8000-000000000001'
     and "slug" = 'acme-robotics'
     and "name" = 'Acme Robotics'
     and "metadata" is null),
  'the demo organization acme-robotics is seeded, exactly once, and is not personal');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.organization
   where "id" = '5eed0001-0000-4000-8000-000000000002'
     and "slug" = 'acme-labs'
     and "name" = 'Acme Labs'
     and "metadata" is null),
  'the demo organization acme-labs is seeded, exactly once, and is not personal');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.organization
   where "id" = '5eed0001-0000-4000-8000-000000000003'
     and "slug" = 'kensuenobu'
     and "name" = 'Ken Suenobu'
     and "metadata"::jsonb = '{"personal": true}'::jsonb),
  'kensuenobu is seeded, exactly once, and is the personal workspace');

-- …and no fourth: a stray organization would be a row Step 2 renders that no mockup
-- shows.
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.organization where "id" like '5eed%'),
  'the seed creates exactly three organizations');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.tenant_domains
   where id = '5eed0002-0000-4000-8000-000000000001'
     and domain = 'acme-robotics.dev'
     and is_primary
     and organization_id = '5eed0001-0000-4000-8000-000000000001'),
  'acme-robotics.dev resolves the acme-robotics organization and is its primary domain');

-- The other two organizations have no domain, so the address path resolves to exactly
-- one workspace.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.tenant_domains
   where organization_id in ('5eed0001-0000-4000-8000-000000000002',
                             '5eed0001-0000-4000-8000-000000000003')),
  'only acme-robotics carries a domain');

-- ---------------------------------------------------------------------------
-- The people, how they sign in, and their roles.
-- ---------------------------------------------------------------------------

select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros."user"
   where ("id", "email", "name") in (
     ('5eed0003-0000-4000-8000-000000000001', 'ken@acme-robotics.dev',   'Ken Suenobu'),
     ('5eed0003-0000-4000-8000-000000000002', 'maya@acme-robotics.dev',  'Maya Chen'),
     ('5eed0003-0000-4000-8000-000000000003', 'jorge@acme-robotics.dev', 'Jorge Reyes'))),
  'the three demo people are seeded with the documented ids and addresses');

-- Verified, because Ken's GitHub sign-in only completes with a verified primary
-- address, and because a false here would put a verification step no development stack
-- can send an email for in front of every password sign-in.
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros."user"
   where "id" like '5eed%' and "emailVerified"),
  'every demo person is emailVerified');

-- Null on purpose: the mockups draw monogram avatars, and null is what makes the UI take
-- that path. An assertion rather than an omission, because a seed that quietly gained an
-- image URL would change what every one of those screens renders.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros."user"
   where "id" like '5eed%' and "image" is not null),
  'no demo person carries an image URL, so the UI renders its monogram');

-- One GitHub-shaped account, Ken's — mockup 01's "Continue with GitHub" resolves to
-- the person driving the dev stack, and to nobody else.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.account acct
     join ouroboros."user" person on person."id" = acct."userId"
    where acct."providerId" = 'github'
      and acct."id" like '5eed%'
      and acct."id" = '5eed0004-0000-4000-8000-000000000001'
      and acct."accountId" = '900000001'
      and person."email" = 'ken@acme-robotics.dev'),
  'Ken holds the one GitHub-shaped account, with the documented id');

-- Three credential accounts, one per person (#705, #709): `accountId` is the user's
-- own id — what the library's credential provider writes — and `password` is a real
-- scrypt hash in the `salt:key` shape BetterAuth's verifier accepts. The hash is
-- asserted by shape rather than by value: the shape is the contract with the
-- verifier, and tests/seed.test.sh pins the exact literals.
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.account acct
     join ouroboros."user" person on person."id" = acct."userId"
    where acct."providerId" = 'credential'
      and acct."id" like '5eed%'
      and acct."accountId" = person."id"
      and acct."password" ~ '^[0-9a-f]{32}:[0-9a-f]{128}$'),
  'each demo person holds a credential account with a verifier-shaped password hash');

-- Nothing but identity and the documented dev credential came across: no token,
-- because a null there is the honest state "recognised, has not signed in yet" — and a
-- password hash on anything but a credential account would be a row no provider
-- writes.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.account
   where "id" like '5eed%'
     and ("accessToken" is not null or "refreshToken" is not null)),
  'no demo account carries a token');

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.account
   where "id" like '5eed%'
     and "providerId" <> 'credential'
     and "password" is not null),
  'only credential accounts carry a password hash');

-- ---------------------------------------------------------------------------
-- Who they are in each workspace.
--
-- The roles spread so every organization has exactly one owner and the role gate has
-- someone to refuse in each shared workspace; Ken belongs to all three, which is what
-- makes Step 2 render three rows for the person the dev stack signs in as.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.member membership
     join ouroboros."user" person on person."id" = membership."userId"
    where membership."organizationId" = '5eed0001-0000-4000-8000-000000000001'
      and (person."email", membership."role") in (
        ('ken@acme-robotics.dev',   'owner'),
        ('maya@acme-robotics.dev',  'admin'),
        ('jorge@acme-robotics.dev', 'member'))),
  'the three demo people hold owner, admin and member in acme-robotics');

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.member membership
     join ouroboros."user" person on person."id" = membership."userId"
    where membership."organizationId" = '5eed0001-0000-4000-8000-000000000002'
      and (person."email", membership."role") in (
        ('maya@acme-robotics.dev', 'owner'),
        ('ken@acme-robotics.dev',  'member'))),
  'acme-labs is Maya''s: she owns it, and Ken is only a member there');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.member membership
     join ouroboros."user" person on person."id" = membership."userId"
    where membership."organizationId" = '5eed0001-0000-4000-8000-000000000003'
      and person."email" = 'ken@acme-robotics.dev'
      and membership."role" = 'owner'),
  'Ken owns his personal workspace');

-- Each organization has one owner and no more: the invariant the schema leaves to the
-- application is at least satisfied by the data every developer starts from.
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.member
   where "organizationId" like '5eed%' and "role" = 'owner'),
  'each demo organization has exactly one owner');

-- …and exactly the six memberships above — a seventh row would be invisible to the
-- pair assertions and would put a stranger into every member list the mockups render.
select pg_temp.must_hold(
  (select count(*) = 6 from ouroboros.member
   where "organizationId" like '5eed%'),
  'the demo organizations have exactly six memberships between them');

-- ---------------------------------------------------------------------------
-- Where the loop may run.
--
-- Step 2's numbers: acme-robotics on with four repositories, acme-labs off with none,
-- kensuenobu on with two.
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
  (select count(*) = 1 from ouroboros.github_orgs
   where id = '5eed0005-0000-4000-8000-000000000002'
     and organization_id = '5eed0001-0000-4000-8000-000000000002'
     and login = 'acme-labs'
     and not enabled
     and installed_at is null),
  'the org acme-labs is seeded and disabled — the row whose switch Step 2 draws off');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.github_orgs
   where id = '5eed0005-0000-4000-8000-000000000003'
     and organization_id = '5eed0001-0000-4000-8000-000000000003'
     and login = 'kensuenobu'
     and enabled
     and installed_at is null),
  'the org kensuenobu is seeded and enabled, with no GitHub App installation claimed');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.github_repos
   where id = '5eed0006-0000-4000-8000-000000000001'
     and org_id = '5eed0005-0000-4000-8000-000000000001'
     and name = 'helios-firmware'
     and enabled
     and default_branch = 'main'),
  'the repo helios-firmware is seeded under acme-robotics and enabled');

-- The counts the screen shows are counts of *enabled* repositories, and every seeded
-- repository is enabled — so these are also counts of rows.
select pg_temp.must_hold(
  (select count(*) = 4 from ouroboros.github_repos
   where org_id = '5eed0005-0000-4000-8000-000000000001' and enabled),
  'acme-robotics holds four enabled repositories — the count Step 2 renders');

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.github_repos
   where org_id = '5eed0005-0000-4000-8000-000000000002'),
  'acme-labs holds no repositories at all');

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.github_repos
   where org_id = '5eed0005-0000-4000-8000-000000000003' and enabled),
  'kensuenobu holds two enabled repositories — the count Step 2 renders');

-- Scope is the conjunction of the two flags (V003), so what is *in scope* is a
-- different statement from any row count: acme-labs's org flag is off, and the six
-- runnable repositories all belong to the two enabled orgs.
select pg_temp.must_hold(
  (select count(*) = 6 from ouroboros.github_repos repo
     join ouroboros.github_orgs org on org.id = repo.org_id
    where org.organization_id like '5eed%'
      and repo.enabled and org.enabled),
  'six repositories are in scope across the demo organizations: both flags true');

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
-- `member` is deliberately not in the union. On a database seeded from empty its six
-- rows carry `5eed0007…` ids; on a database V006 *migrated*, the three memberships
-- that predate #709 exist under ids the migration minted — the pair was the old
-- primary key, so there was no id to preserve — and the seed's inserts land on the
-- (organizationId, userId) conflict and change nothing. Both are correct states, the
-- membership content itself is pinned by the assertions above, and an id-shape
-- assertion here would fail every developer whose database was migrated rather than
-- recreated.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 20 from (
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
  'the seed created its twenty fixed-id rows and no twenty-first');

\o
\echo 'seed.sql: all assertions passed'
