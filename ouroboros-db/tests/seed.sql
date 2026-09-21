-- seed.sql — what the development seeds put in the database, as assertions.
--
-- The other half of the seeds' tests. tests/seed.test.sh reads the two migrations and the
-- two configuration files and asserts the properties that make them safe — guarded,
-- idempotent, deterministic. This asserts the one thing a file read cannot: that
-- applying them to a real PostgreSQL produces exactly the demo content every mockup, and
-- every e2e test written against it, expects to find — mockup 01 Step 2's three
-- organizations and mockup 02's dashboard, number for number.
--
-- Six migrations, one suite, because they describe one database: R__dev_seed.sql (#23)
-- is *who exists*, R__dev_seed_dashboard.sql (#68) is *what the loop has done*,
-- R__dev_seed_intake.sql (#103) is *what it has an opinion about next*,
-- R__dev_seed_providers.sql (#221) is *what it is allowed to call*,
-- R__dev_seed_routing.sql (#192) is *where the calls go*, and R__dev_seed_audit.sql (#225)
-- is *who touched the keys* — and a dashboard assertion that could not name `acme-robotics`
-- would be asserting nothing. Two of them share a table: a provider card's monthly meter is
-- the dashboard seed's spend of today plus the providers seed's spend of earlier this month,
-- so the figures below are asserted over the sum rather than over either file's rows. Two
-- more share a *fact*: the intake seed's estimates and the dashboard seed's queue rows have
-- to agree about how long the same issue takes, and the assertion that they do is the
-- intake block's rather than either seed's.
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
-- auth-aware demo set — three organizations, password sign-in — by #709; extended with
-- the dashboard read-model — mockup 02, number for number — by #68, with mockup 07's
-- five provider cards by #221, with the credential trail behind that page's **Audit
-- log** button by #225, with mockup 21's registry over the routing rows — eight
-- aliases with their params, a price override and run #482's resolution snapshot — by
-- #582, with mockup 03's backlog — nine mirrored issues and the estimates behind
-- their chips — by #103, and with mockup 09's planning page — the canonical backlog, the
-- roadmap lanes and the OTA draft batch — by #275, and with mockup 08's build farm — two
-- pools, six runners of which one is removed, forty-eight builds and the live log's chunks —
-- by #249.

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

-- ===========================================================================
-- R__dev_seed_dashboard.sql — mockup 02, number for number.
--
-- Every assertion below is scoped to the ids the dashboard seed creates
-- (`5eed0009…` runs, `5eed000a…` queue items, `5eed000b…` usage events) rather than to
-- the tables at large. A developer who inserted a run of their own to try something must
-- not fail this suite, and an aggregate over "every row in `runs`" would be an assertion
-- about their afternoon rather than about the seed.
--
-- The counts are exact, which is what makes this file the idempotency test for the
-- dashboard seed as well: applying it twice would double every one of them.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Active loops — the `c-8` card and the *Loops live* stat.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.runs run
     join ouroboros.organization org on org."id" = run.organization_id
    where org."slug" = 'acme-robotics'
      and run.id::text like '5eed0009%'
      and run.finished_at is null),
  'three loops are live in acme-robotics — the Loops live stat');

-- Row for row, with the stage meter and the model pill the card renders. `finished_at` is
-- null on all three (runs_terminal_finished_at), which is what puts them in this card and
-- not the completions one.
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.runs run
    where run.id::text like '5eed0009%'
      and (run.issue_number, run.workflow_tag, run.model, run.status,
           run.stage_label, run.stage_index, run.stage_total) in (
        (482, 'standard-fix', 'claude-fable-5',     'coding',   'Implementing', 4, 6),
        (479, 'feature-loop', 'claude-sonnet-5',    'building', 'Build farm',   5, 7),
        (476, 'deps-refresh', 'ollama/qwen3-coder', 'review',   'Self-review',  6, 6))),
  'the three live runs are #482 coding, #479 building and #476 in review, as the mockup draws them');

-- No pull request on a live run: the active table has no PR column, and a number here
-- would be a number outside the mockup.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.runs run
    where run.id::text like '5eed0009%'
      and run.finished_at is null
      and (run.pr_number is not null or run.checks_total is not null)),
  'no live run claims a pull request or a check count');

-- ---------------------------------------------------------------------------
-- Recently closed by the loop — the four rows of the `c-7` card.
--
-- The card is `order by finished_at desc limit 4`, so this asserts both the content and
-- that these four are the newest terminal runs in the workspace — a fifth, newer row
-- would render in their place.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 4 from (
     select run.issue_number, run.pr_number, run.model, run.status,
            run.checks_passed, run.checks_total,
            (run.finished_at - run.started_at) as cycle
       from ouroboros.runs run
       join ouroboros.organization org on org."id" = run.organization_id
      where org."slug" = 'acme-robotics'
        and run.id::text like '5eed0009%'
        and run.finished_at is not null
      order by run.finished_at desc
      limit 4) as newest
   where (newest.issue_number, newest.pr_number, newest.model, newest.status,
          newest.checks_passed, newest.checks_total, newest.cycle) in (
     (474, 512, 'claude-fable-5',      'merged',      14, 14, interval '11 minutes'),
     (471, 509, 'copilot/gpt-5-codex', 'merged',      14, 14, interval '19 minutes'),
     (468, 507, 'ollama/qwen3-coder',  'merged',      12, 12, interval  '6 minutes'),
     (465, 504, 'claude-sonnet-5',     'needs_human', 13, 14, interval '42 minutes'))),
  'the four newest closed runs are #474→PR#512 … #465→PR#504, with the mockup''s cycles and checks');

-- ---------------------------------------------------------------------------
-- The stat row's history, and the loop-pulse metrics.
--
-- These are the numbers #70 computes; asserting them here is what makes "the aggregate
-- endpoint reproduces every mockup number" a property of the data rather than a hope
-- about the query.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 27 from ouroboros.runs run
     join ouroboros.organization org on org."id" = run.organization_id
    where org."slug" = 'acme-robotics'
      and run.id::text like '5eed0009%'
      and run.status = 'merged'
      and run.finished_at >= now() - interval '7 days'),
  'twenty-seven runs merged in the trailing seven days — PRs merged · 7d');

-- `▲ 8 vs last week` is a comparison, so the week before has to hold nineteen.
select pg_temp.must_hold(
  (select count(*) = 19 from ouroboros.runs run
     join ouroboros.organization org on org."id" = run.organization_id
    where org."slug" = 'acme-robotics'
      and run.id::text like '5eed0009%'
      and run.status = 'merged'
      and run.finished_at >= now() - interval '14 days'
      and run.finished_at <  now() - interval  '7 days'),
  'nineteen merged in the week before that, which is what makes the delta ▲ 8');

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.runs run
     join ouroboros.organization org on org."id" = run.organization_id
    where org."slug" = 'acme-robotics'
      and run.id::text like '5eed0009%'
      and run.status = 'needs_human'
      and run.finished_at >= now() - interval '7 days'),
  'two runs stopped for a human this week — Human interventions');

-- *Avg. cycle time* — over every run that closed in the window, including the two that
-- stopped for a human. Exact rather than approximate: the seed's cycle spread is built to
-- sum to 29 × 860s, and a row added or removed without re-doing that arithmetic fails
-- here rather than quietly rendering 14m 19s.
select pg_temp.must_hold(
  (select avg(run.finished_at - run.started_at) = interval '14 minutes 20 seconds'
     from ouroboros.runs run
     join ouroboros.organization org on org."id" = run.organization_id
    where org."slug" = 'acme-robotics'
      and run.id::text like '5eed0009%'
      and run.finished_at >= now() - interval '7 days'),
  'the twenty-nine runs closed this week average exactly 14m 20s — Avg. cycle time');

-- *Autonomous merge rate* — 46 merged of 50 closed across the whole seeded history, which
-- is 92% with no rounding. See R__dev_seed_dashboard.sql's header for why the population
-- is the seeded history and not the trailing week: 27 merged of *any* integer number of
-- closed runs cannot be 92%.
select pg_temp.must_hold(
  (select count(*) filter (where run.status = 'merged') = 46 and count(*) = 50
     from ouroboros.runs run
     join ouroboros.organization org on org."id" = run.organization_id
    where org."slug" = 'acme-robotics'
      and run.id::text like '5eed0009%'
      and run.finished_at is not null),
  'forty-six of the fifty closed runs merged — 92% exactly, the Autonomous merge rate');

-- Every status the CHECK admits is exercised, `failed` included — the one outcome no card
-- on mockup 02 draws, and the one a fixture is otherwise least likely to have.
select pg_temp.must_hold(
  (select count(distinct run.status) = 6 from ouroboros.runs run
    where run.id::text like '5eed0009%'),
  'the seeded runs exercise all six statuses, including failed');

-- The failed run is the one with no pull request — a run can fail before it opens one,
-- which is the case runs_merged_has_pr deliberately permits and runs_checks_paired
-- requires to be both-null rather than 0/0.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.runs run
    where run.id::text like '5eed0009%'
      and run.status = 'failed'
      and run.pr_number is null
      and run.checks_passed is null and run.checks_total is null),
  'the one failed run carries no pull request and no checks');

select pg_temp.must_hold(
  (select count(*) = 53 from ouroboros.runs run
    where run.id::text like '5eed0009%'),
  'the dashboard seed created fifty-three runs and no fifty-fourth');

-- ---------------------------------------------------------------------------
-- Up next in queue — the `c-5` card and the *Queued issues* stat.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 12 and sum(item.est_minutes) = 580
     from ouroboros.queue_items item
     join ouroboros.organization org on org."id" = item.organization_id
    where org."slug" = 'acme-robotics'
      and item.id::text like '5eed000a%'),
  'twelve issues are queued and their estimates total 580 minutes — 12, est. 9h 40m');

-- The five the card draws, in the order it draws them.
select pg_temp.must_hold(
  (select count(*) = 5 from ouroboros.queue_items item
    where item.id::text like '5eed000a%'
      and (item.position, item.issue_number, item.effort, item.workflow_tag) in (
        (1, 485, 'm',  'standard-fix'),
        (2, 486, 'l',  'feature-loop'),
        (3, 488, 'xs', 'docs-loop'),
        (4, 490, 'xl', 'deps-refresh'),
        (5, 491, 's',  'standard-fix'))),
  'the queue head is #485 M, #486 L, #488 XS, #490 XL, #491 S — the five rows the card draws');

-- Dense from 1, which is the writer's convention rather than a constraint (V009 leaves
-- density to the writer so a reorder can defer). The seed is that writer, so it keeps it.
select pg_temp.must_hold(
  (select min(item.position) = 1 and max(item.position) = 12
          and count(distinct item.position) = 12
     from ouroboros.queue_items item
    where item.id::text like '5eed000a%'),
  'the queue is densely ordered from 1 to 12, with no position claimed twice');

-- All five chips, which is what makes the card's styling and #73's filters honest.
select pg_temp.must_hold(
  (select count(distinct item.effort) = 5 from ouroboros.queue_items item
    where item.id::text like '5eed000a%'),
  'the queue exercises all five effort chips');

-- One item is deliberately unestimated — null is *not estimated*, which is not zero, and
-- `sum` skipping it is what the 580 above already depends on.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.queue_items item
    where item.id::text like '5eed000a%' and item.est_minutes is null),
  'exactly one queued issue carries no estimate, so the null path has a fixture');

-- ---------------------------------------------------------------------------
-- Token spend · today — the ledger behind the fourth stat.
--
-- The day is UTC, fixed by `token_usage_daily` rather than by the session (V010), so this
-- reads the view rather than the table and gets the same answer from any connection.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select sum(day.tokens_total) = 4200000 and count(*) = 4 and sum(day.events) = 12
     from ouroboros.token_usage_daily day
     join ouroboros.organization org on org."id" = day.organization_id
    where org."slug" = 'acme-robotics'
      and day.day = (now() at time zone 'utc')::date),
  'today holds 4.2M tokens across four providers, in twelve events — Token spend · today');

-- `≈ $18.60`, and the `≈` itself: the priced events total 1 860 cents, and the three
-- unpriced ones (local inference on the workstation) are why the figure is a lower bound.
select pg_temp.must_hold(
  (select sum(day.cost_cents) = 1860 and sum(day.unpriced_events) = 3
     from ouroboros.token_usage_daily day
     join ouroboros.organization org on org."id" = day.organization_id
    where org."slug" = 'acme-robotics'
      and day.day = (now() at time zone 'utc')::date),
  'the priced events total $18.60 and three are unpriced — which is what the card''s ≈ means');

-- Every event is today's, whatever hour the stack came up at. An event that fell into
-- yesterday would silently shrink the card rather than fail anything.
select pg_temp.must_hold(
  (select count(*) = 12 from ouroboros.token_usage usage
    where usage.id::text like '5eed000b%'
      and (usage.occurred_at at time zone 'utc')::date = (now() at time zone 'utc')::date
      and usage.occurred_at <= now()),
  'all twelve usage events fall inside the current UTC day, and none is in the future');

-- Attribution follows the model, and the events no run caused are the ordinary case V010
-- made `run_id` nullable for.
select pg_temp.must_hold(
  (select count(*) filter (where usage.run_id is not null) = 5
      and count(*) filter (where usage.run_id is null)     = 7
     from ouroboros.token_usage usage
    where usage.id::text like '5eed000b%'),
  'five usage events are attributed to a run and seven are not');

-- ---------------------------------------------------------------------------
-- Auto-merge when checks pass — the page's only write.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.workspace_settings settings
     join ouroboros.organization org on org."id" = settings.organization_id
     join ouroboros."user" person   on person."id" = settings.updated_by
    where org."slug" = 'acme-robotics'
      and settings.auto_merge_on_checks
      and person."email" = 'ken@acme-robotics.dev'),
  'acme-robotics has auto-merge on, attributed to the person who owns it');

-- ---------------------------------------------------------------------------
-- The empty-state fixture.
--
-- `kensuenobu` is the personal workspace #86 renders the zero-state cards against, and
-- `acme-labs` is empty for the same reason. This is the acceptance criterion "switching
-- the active organization to kensuenobu yields all-empty cards", stated where it can be
-- observed: the seed puts nothing in any of the four tables for either of them.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.runs run
     join ouroboros.organization org on org."id" = run.organization_id
    where org."slug" in ('kensuenobu', 'acme-labs')),
  'neither the personal workspace nor acme-labs has a run');

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.queue_items item
     join ouroboros.organization org on org."id" = item.organization_id
    where org."slug" in ('kensuenobu', 'acme-labs')),
  'neither the personal workspace nor acme-labs has a queued issue');

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.token_usage usage
     join ouroboros.organization org on org."id" = usage.organization_id
    where org."slug" in ('kensuenobu', 'acme-labs')),
  'neither the personal workspace nor acme-labs has spent a token');

-- No settings *row*, which is not the same as a row saying false — and the difference is
-- what V011's lazy creation is about. The view is what resolves it, so both halves are
-- asserted: no row, and a `false` that is not explicit.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.workspace_settings settings
     join ouroboros.organization org on org."id" = settings.organization_id
    where org."slug" in ('kensuenobu', 'acme-labs')),
  'neither the personal workspace nor acme-labs has a settings row');

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.workspace_settings_effective effective
     join ouroboros.organization org on org."id" = effective.organization_id
    where org."slug" in ('kensuenobu', 'acme-labs')
      and not effective.auto_merge_on_checks
      and not effective.is_explicit),
  'both empty workspaces read auto-merge off, and read it as a default rather than a choice');

-- ---------------------------------------------------------------------------
-- The id convention, for the dashboard seed's own rows.
--
-- Seventy-seven rows, seventy-seven `5eed…` ids, each under the prefix its table was
-- given — so a run, a queue item and a usage event are told apart on sight in a log or a
-- URL, and a row added later with a generated id is caught here rather than by nobody.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 77 from (
     select id from ouroboros.runs        where id::text like '5eed0009-0000-4000-8000-%'
     union all
     select id from ouroboros.queue_items where id::text like '5eed000a-0000-4000-8000-%'
     union all
     select id from ouroboros.token_usage where id::text like '5eed000b-0000-4000-8000-%'
   ) as seeded),
  'the dashboard seed created its seventy-seven prefixed rows and no seventy-eighth');

-- ===========================================================================
-- R__dev_seed_providers.sql — mockup 07, card for card.
--
-- The third seed's rows: five `provider_connections` (`5eed000c…`), eleven
-- `provider_models` (`5eed000d…`) and the eleven `token_usage` events (`5eed000e…`) that
-- make the meters read what the mockup prints. Scoped to those ids and to `acme-robotics`,
-- for the reason the dashboard's assertions are: a developer who added a provider of their
-- own must not fail this suite.
--
-- The counts are exact, so this is the providers seed's idempotency test as well.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The five cards.
--
-- One assertion per card, naming everything on it that is not a live API call: the kind
-- and name in its head, the status pill, the switch, the cap field, the capability line,
-- and the meta row's date and person. A seed that moved any of them would change what
-- mockup 07 renders, and this is where that is noticed.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.provider_connections conn
     join ouroboros.organization org  on org."id" = conn.organization_id
     join ouroboros."user" person     on person."id" = conn.added_by
    where conn.id = '5eed000c-0000-4000-8000-000000000001'
      and org."slug" = 'acme-robotics'
      and person."email" = 'ken@acme-robotics.dev'
      and conn.kind = 'anthropic'
      and conn.display_name = 'Anthropic Claude'
      and conn.status = 'active'
      and conn.enabled
      and conn.monthly_cap_cents = 60000
      and conn.capability_note = 'api.anthropic.com · primary coding lane'
      and (conn.created_at at time zone 'utc')::date = date '2026-06-12'
      and conn.credentials_encrypted like 'ouro.v1.%'),
  'the Anthropic card is seeded — connected, on, $600 cap, added by Ken on 2026-06-12');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.provider_connections conn
    where conn.id = '5eed000c-0000-4000-8000-000000000002'
      and conn.kind = 'cursor'
      and conn.display_name = 'Cursor'
      and conn.status = 'active'
      and conn.enabled
      and conn.monthly_cap_cents = 12000
      and conn.capability_note = 'api.cursor.com · used for second-opinion reviews'
      and (conn.created_at at time zone 'utc')::date = date '2026-07-02'
      and conn.credentials_encrypted like 'ouro.v1.%'),
  'the Cursor card is seeded — connected, on, $120 cap');

-- The one card that is not green. `status = 'error'` is what AC.1's taxonomy coarsens an
-- upstream failure to (#216), and `health` is what the last check measured — which #192
-- corrected to the `.phealth` chip mockup 06 draws, *degraded · elevated latency*. Mockup
-- 07's `△ 503 upstream · retrying` sits beside its *Test connection* button and is the reply
-- to a probe somebody clicked, not a stored snapshot; see the seed's header.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.provider_connections conn
    where conn.id = '5eed000c-0000-4000-8000-000000000003'
      and conn.kind = 'copilot'
      and conn.display_name = 'GitHub Copilot'
      and conn.status = 'error'
      and conn.enabled
      and conn.monthly_cap_cents = 9500
      and conn.health ->> 'detail' = 'elevated latency'
      and conn.capability_note = 'billed through GitHub org acme-robotics'
      and (conn.created_at at time zone 'utc')::date = date '2026-06-18'),
  'the Copilot card is seeded — degraded upstream, still switched on, $95 cap');

-- The two local providers: an address, no cap, and no credential. Their cards are the ones
-- that render the mockup's em-dash where a cap would be.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.provider_connections conn
    where conn.id = '5eed000c-0000-4000-8000-000000000004'
      and conn.kind = 'openai_compatible'
      and conn.display_name = 'OpenAI-compatible · local vLLM'
      and conn.base_url = 'http://10.0.4.20:8000/v1'
      and conn.status = 'active'
      and conn.enabled
      and conn.monthly_cap_cents is null
      and conn.credentials_encrypted is null
      and conn.capability_note = 'self-hosted · A100 ×2'),
  'the local vLLM card is seeded — an address, no cap, no key configured');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.provider_connections conn
    where conn.id = '5eed000c-0000-4000-8000-000000000005'
      and conn.kind = 'ollama'
      and conn.display_name = 'Ollama · workstation'
      and conn.base_url = 'http://ken-station.local:11434'
      and conn.status = 'active'
      and conn.enabled
      and conn.monthly_cap_cents is null
      and conn.credentials_encrypted is null
      and conn.capability_note = 'zero-cost lane — used for docs & commit messages'),
  'the Ollama card is seeded — a host, no cap, and no credential to hold');

-- …and no sixth, which would be a card mockup 07 does not draw.
select pg_temp.must_hold(
  (select count(*) = 5 from ouroboros.provider_connections conn
     join ouroboros.organization org on org."id" = conn.organization_id
    where org."slug" = 'acme-robotics'),
  'acme-robotics has exactly the mockup''s five connections');

-- The meta row's second half. *last used 3m ago* is only true measured from now, so these
-- are relative — and every one of them is in the past and recent, whatever hour the stack
-- came up at.
select pg_temp.must_hold(
  (select count(*) = 5 from ouroboros.provider_connections conn
    where conn.id::text like '5eed000c%'
      and conn.last_used_at <= now()
      and conn.last_used_at > now() - interval '2 hours'
      and conn.last_checked_at <= now()),
  'every seeded connection was used minutes ago and checked minutes ago');

-- ---------------------------------------------------------------------------
-- What discovery found — the chips and the pull-list.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 11 from ouroboros.provider_models model
    where model.id::text like '5eed000d%'),
  'the seed discovered eleven models across the five connections');

select pg_temp.must_hold(
  (select count(*) = 5
     from (select conn.kind, count(model.id) as chips
             from ouroboros.provider_connections conn
             left join ouroboros.provider_models model
               on model.provider_connection_id = conn.id
            where conn.id::text like '5eed000c%'
            group by conn.kind) as card
    where (card.kind, card.chips) in (('anthropic', 4), ('cursor', 1), ('copilot', 1),
                                      ('openai_compatible', 2), ('ollama', 3))),
  'each card lists what the mockup shows: four Anthropic chips, one each for Cursor and Copilot, two vLLM and three Ollama');

-- The pull-list's three tags, in bytes. `19 GB`, `63 GB` and `9.1 GB` are what AE.4 (#230)
-- formats these into — base ten, which is the unit Ollama itself prints.
select pg_temp.must_hold(
  (select array_agg(model.size_bytes order by model.size_bytes desc)
            = array[63000000000, 19000000000, 9100000000]::bigint[]
     from ouroboros.provider_models model
     join ouroboros.provider_connections conn on conn.id = model.provider_connection_id
    where conn.kind = 'ollama' and conn.id::text like '5eed000c%'),
  'the workstation''s three models carry the sizes the pull-list renders as 63 GB, 19 GB and 9.1 GB');

-- Only a locally-pulled model has a size. A cloud chip with a byte count would be a tag
-- claiming something nobody downloaded.
select pg_temp.must_hold(
  (select count(*) = 8 from ouroboros.provider_models model
     join ouroboros.provider_connections conn on conn.id = model.provider_connection_id
    where model.id::text like '5eed000d%'
      and conn.kind <> 'ollama'
      and model.size_bytes is null),
  'every model that is not on the workstation carries no size at all');

-- The chips print `display`, which is why the local ones differ from their model ids —
-- `llama-4-maverick` is served as `local/llama-4-maverick`.
select pg_temp.must_hold(
  (select array_agg(model.display order by model.display)
            = array['local/deepseek-v3.2', 'local/llama-4-maverick']
     from ouroboros.provider_models model
     join ouroboros.provider_connections conn on conn.id = model.provider_connection_id
    where conn.kind = 'openai_compatible' and conn.id::text like '5eed000c%'),
  'the vLLM chips print the namespaced display, not the raw model id');

-- The `priority tier` pill's *real signal* (AE.2): it is on the discovered models rather
-- than invented by the card, and no other connection claims one.
select pg_temp.must_hold(
  (select count(*) = 4 from ouroboros.provider_models model
     join ouroboros.provider_connections conn on conn.id = model.provider_connection_id
    where conn.kind = 'anthropic'
      and conn.id::text like '5eed000c%'
      and model.meta ->> 'tier' = 'priority')
   and (select count(*) = 0 from ouroboros.provider_models model
          join ouroboros.provider_connections conn on conn.id = model.provider_connection_id
         where conn.kind <> 'anthropic'
           and model.id::text like '5eed000d%'
           and model.meta ? 'tier'),
  'the priority-tier pill has four rows behind it, and no other card claims a tier');

-- Every chip carries the context length CH.2 (#585) merges with an adapter's param schema,
-- under the key `model_prices.meta` already uses.
select pg_temp.must_hold(
  (select count(*) = 11 from ouroboros.provider_models model
    where model.id::text like '5eed000d%'
      and (model.meta -> 'context_tokens') is not null
      and jsonb_typeof(model.meta -> 'context_tokens') = 'number'),
  'every discovered model reports a context length, spelled the way the price catalog spells it');

-- ---------------------------------------------------------------------------
-- The meters — the arithmetic three seeds share.
--
-- A card's *This month* figure is calendar-month spend over `token_usage`, summed for the
-- connection's kind, and it is **two seeds added together**: #68's twelve events of today
-- and this seed's eleven from earlier in the month. The query below is the one V017's
-- header documents, so what is asserted is the meter itself rather than a restatement of
-- the seed.
--
-- **On the first of a month there is no "earlier this month"**, and the providers seed says
-- so: its rows fall on the last day of the previous one, and the meters read the day's
-- spend alone. Both branches are asserted, because a fixture that quietly meant something
-- else for one day in thirty is worse than one that says which day it is.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select coalesce(sum(usage.cost_cents), 0)
            = case when date_trunc('day', now() at time zone 'utc')
                        = date_trunc('month', now() at time zone 'utc')
                   then 1140 else 41280 end
     from ouroboros.token_usage usage
     join ouroboros.organization org on org."id" = usage.organization_id
    where org."slug" = 'acme-robotics'
      and usage.provider = 'anthropic'
      and usage.occurred_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'),
  'the Anthropic meter reads $412.80 of its $600 cap — or the day''s $11.40 alone, on the first of a month');

select pg_temp.must_hold(
  (select coalesce(sum(usage.cost_cents), 0)
            = case when date_trunc('day', now() at time zone 'utc')
                        = date_trunc('month', now() at time zone 'utc')
                   then 180 else 6410 end
     from ouroboros.token_usage usage
     join ouroboros.organization org on org."id" = usage.organization_id
    where org."slug" = 'acme-robotics'
      and usage.provider = 'cursor'
      and usage.occurred_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'),
  'the Cursor meter reads $64.10 of its $120 cap — or the day''s $1.80 alone, on the first of a month');

select pg_temp.must_hold(
  (select coalesce(sum(usage.cost_cents), 0)
            = case when date_trunc('day', now() at time zone 'utc')
                        = date_trunc('month', now() at time zone 'utc')
                   then 540 else 7600 end
     from ouroboros.token_usage usage
     join ouroboros.organization org on org."id" = usage.organization_id
    where org."slug" = 'acme-robotics'
      and usage.provider = 'copilot'
      and usage.occurred_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'),
  'the Copilot meter reads $76.00 of its $95 cap, which is the 80% the mockup draws as a warning');

-- The two zero meters, and they are zero for different reasons — which is the whole of
-- DASH-J.4's (#92) distinction, seeded in one workspace so it can be tested rather than
-- promised. Ollama's `$0.00 · 2.1M tokens on-box` is `null` costs: calls **nobody priced**.
-- vLLM's `$0.00 · no metered spend` is `cost_cents = 0`: calls that were priced, at nothing,
-- which is the only honest route to the `$0.00` mockup 06's `commit-msg` row prints
-- (decision M7). Until #192 it had no rows at all and its zero was an absence; a matrix that
-- has to compute an average cannot be given an absence to average.
select pg_temp.must_hold(
  (select coalesce(sum(usage.cost_cents), 0) = 0
      and sum(usage.tokens_in + usage.tokens_out)
            = case when date_trunc('day', now() at time zone 'utc')
                        = date_trunc('month', now() at time zone 'utc')
                   then 500000 else 2100000 end
     from ouroboros.token_usage usage
     join ouroboros.organization org on org."id" = usage.organization_id
    where org."slug" = 'acme-robotics'
      and usage.provider = 'ollama'
      and usage.occurred_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'),
  'the Ollama meter costs nothing and counts 2.1M on-box tokens — unpriced is not free of charge');

select pg_temp.must_hold(
  (select count(*) > 0
      and count(*) filter (where usage.cost_cents is null) = 0
      and sum(usage.cost_cents) = 0
     from ouroboros.token_usage usage
     join ouroboros.organization org on org."id" = usage.organization_id
    where org."slug" = 'acme-robotics'
      and usage.provider = 'openai_compatible'),
  'the local vLLM meter is zero because every call was priced at nothing, not because none was priced');

-- The other half of the same rule, stated the way a re-pricing pass would ask it: the
-- workspace holds **both** states, so a service that conflated them fails one assertion or
-- the other rather than passing both by accident.
select pg_temp.must_hold(
  (select count(*) filter (where usage.cost_cents is null) > 0
      and count(*) filter (where usage.cost_cents = 0)     > 0
     from ouroboros.token_usage usage
     join ouroboros.organization org on org."id" = usage.organization_id
    where org."slug" = 'acme-robotics'
      and usage.provider in ('ollama', 'openai_compatible')),
  'the local providers hold unpriced rows and zero-priced rows at once — the two are not the same state');

-- **Nothing this seed wrote lands on today**, which is what keeps mockup 02's *Token spend
-- · today* card exactly #68's twelve events. The dashboard section above asserts that
-- number; this asserts the rule that protects it.
select pg_temp.must_hold(
  (select count(*) = 11 from ouroboros.token_usage usage
    where usage.id::text like '5eed000e%'
      and usage.occurred_at < date_trunc('day', now() at time zone 'utc') at time zone 'utc'
      and usage.occurred_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
                                - interval '14 days'),
  'all eleven provider-spend events fall before today and inside the fortnight behind it');

-- ---------------------------------------------------------------------------
-- The empty workspaces, again — this time as the providers guidance fixture.
--
-- AE.6 (#233) renders the *connect your first provider* path against a workspace with no
-- connections, and `kensuenobu` is it. `acme-labs` is empty for the same reason the
-- dashboard seed leaves it empty.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.provider_connections conn
     join ouroboros.organization org on org."id" = conn.organization_id
    where org."slug" in ('kensuenobu', 'acme-labs')),
  'neither the personal workspace nor acme-labs has a provider connection — AE.6''s guidance fixture');

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.provider_models model
     join ouroboros.provider_connections conn on conn.id = model.provider_connection_id
     join ouroboros.organization org on org."id" = conn.organization_id
    where org."slug" in ('kensuenobu', 'acme-labs')),
  'and neither has a discovered model, because neither has a connection to discover one on');

-- ---------------------------------------------------------------------------
-- The id convention, for the providers seed's own rows.
--
-- Twenty-seven rows under three prefixes — `5eed000c…` a connection, `5eed000d…` a
-- discovered model, `5eed000e…` a spend event — so a row added later with a generated id is
-- caught here rather than by nobody.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 27 from (
     select id from ouroboros.provider_connections where id::text like '5eed000c-0000-4000-8000-%'
     union all
     select id from ouroboros.provider_models      where id::text like '5eed000d-0000-4000-8000-%'
     union all
     select id from ouroboros.token_usage          where id::text like '5eed000e-0000-4000-8000-%'
   ) as seeded),
  'the providers seed created its twenty-seven prefixed rows and no twenty-eighth');

-- ===========================================================================
-- R__dev_seed_routing.sql — mockup 06, surface for surface.
--
-- The fourth seed's rows: seven `model_aliases` (`5eed000f…`), eight `task_kinds`
-- (`5eed0010…`), their eight `routes` (`5eed0011…`), seventeen ordered `route_hops`
-- (`5eed0012…`), three `escalation_rules` (`5eed0013…`) and the 370 routed `token_usage`
-- calls (`5eed0014…`) every number on the screen is aggregated out of.
--
-- **What this section is really testing is decision M7.** Every assertion below that names a
-- figure computes it — `avg`, `percentile_cont`, `sum` — because that is the only way to
-- prove the figure was not stored. An assertion that read a `dollars_per_run` column would
-- pass against a seed that had defeated the point of the ticket.
--
-- The counts are exact, so this is the routing seed's idempotency test as well.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The eight aliases — seven bound, and what each resolves to; one unbound.
--
-- The matrix's pills and their grey resolution lines — `coder-max` → `claude-fable-5 ·
-- Anthropic`. Asserted through the join rather than against `model_id` alone, because the
-- line prints both halves and decision M1's whole point is that the second half lives in
-- exactly one place. The eighth row cannot join: it is mockup 21's `gpt5-experiments`, and
-- the assertions after this one are about it.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 7 from (
     select alias.alias
       from (values
              ('coder-max',      'claude-fable-5',   'Anthropic Claude'),
              ('coder-std',      'claude-sonnet-5',  'Anthropic Claude'),
              ('sizer',          'claude-haiku-4-5', 'Anthropic Claude'),
              ('coder-fallback', 'gpt-5-codex',      'GitHub Copilot'),
              ('local-docs',     'qwen3-coder:32b',  'Ollama · workstation'),
              ('local-free',     'llama-4-maverick', 'OpenAI-compatible · local vLLM'),
              ('second-opinion', 'composer-2',       'Cursor')
            ) as expected (alias, model_id, connection)
       join ouroboros.organization org on org."slug" = 'acme-robotics'
       join ouroboros.model_aliases alias
         on alias.organization_id = org."id"
        and alias.alias = expected.alias
        and alias.model_id = expected.model_id
        and alias.enabled
       join ouroboros.provider_connections conn
         on conn.id = alias.provider_connection_id
        and conn.display_name = expected.connection
   ) as resolved),
  'the seven bound aliases resolve to the models and connections the matrix prints under them');

-- The eighth is unbound — no connection, `enabled = false` as V019 requires of it, naming a
-- model no provider here serves. It is the registry's `✗ no key — connect a provider` row
-- (CG.4, #582; decision R2), and the one alias the matrix never draws.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.model_aliases alias
     join ouroboros.organization org on org."id" = alias.organization_id
    where org."slug" = 'acme-robotics'
      and alias.alias = 'gpt5-experiments'
      and alias.provider_connection_id is null
      and alias.model_id = 'gpt-5.2-preview'
      and not alias.enabled),
  'gpt5-experiments is seeded unbound, disabled, and naming gpt-5.2-preview — the registry''s no-key row');

select pg_temp.must_hold(
  (select count(*) = 8 from ouroboros.model_aliases alias
     join ouroboros.organization org on org."id" = alias.organization_id
    where org."slug" = 'acme-robotics'),
  'acme-robotics has exactly eight aliases — mockup 21''s ALLOWED MODELS · 8 ALIASES — and no ninth');

-- ---------------------------------------------------------------------------
-- Params and restrictions — mockup 21's chips, as the structure CH.2 (#585) derives them from.
--
-- Eight documents, asserted exactly, because the chips are a *derivation* and a derivation is
-- only tested if its inputs are known: `(max thinking)(400k budget)` is `{"thinking": "max",
-- "token_budget": 400000}`, `(8k out)` is `8192` and `(ctx 32k)` is `32768` — the powers of
-- two the chips abbreviate — and the two `—` cells are two empty documents. No display
-- string is stored anywhere, which tests/seed.test.sh asserts over the file itself.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 8 from (
     select alias.alias
       from (values
              ('coder-max',        '{"thinking": "max", "token_budget": 400000}', '{}'),
              ('coder-std',        '{"thinking": "std"}',                         '{}'),
              ('sizer',            '{"temperature": 0, "max_output": 8192}',      '{}'),
              ('coder-fallback',   '{}',                                          '{}'),
              ('second-opinion',   '{}',                   '{"review_vote_only": true}'),
              ('local-docs',       '{"context_clamp": 32768}',                    '{}'),
              ('local-free',       '{}',                          '{"batch_ok": true}'),
              ('gpt5-experiments', '{}',                                          '{}')
            ) as expected (alias, params, restrictions)
       join ouroboros.organization org on org."slug" = 'acme-robotics'
       join ouroboros.model_aliases alias
         on alias.organization_id = org."id"
        and alias.alias = expected.alias
        and alias.params = expected.params::jsonb
        and alias.restrictions = expected.restrictions::jsonb
   ) as chipped),
  'all eight aliases carry exactly the params and restrictions mockup 21''s chips derive from, and the two dash cells carry nothing');

-- `second-opinion`'s restriction is the one a rule relies on: the review escalation adds it
-- as a vote, which is exactly what `review_vote_only` says this workspace allows (V019, R3).
-- And the effort ≥ L rule's `thinking: max` now sits on `coder-max` too — a *merge* at
-- resolution rather than a no-op, because the rule's document names `thinking` alone and
-- the merged result still carries the alias's budget.
select pg_temp.must_hold(
  (select (alias.params || (rule."then" #> '{use_alias,params}'))
            = '{"thinking": "max", "token_budget": 400000}'::jsonb
     from ouroboros.model_aliases alias
     join ouroboros.organization org on org."id" = alias.organization_id
     join ouroboros.escalation_rules rule
       on rule.organization_id = org."id" and rule.sort_order = 1
    where org."slug" = 'acme-robotics' and alias.alias = 'coder-max'),
  'the effort ≥ L rule merged over coder-max keeps the alias''s token budget — a merge, not a swap');

-- ---------------------------------------------------------------------------
-- The matrix — eight kinds, their descriptions, and the first two hops of each chain.
--
-- One assertion for the whole table, because the table is one thing: a row is its mono name,
-- the grey line under it, its route's tag pill, and the two alias pills to the right. Eight
-- rows match or this fails.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 8 from (
     select kind.name
       from (values
              (1, 'analyze',    'Read the issue, map the affected code paths',
                  'analyze-primary',   'coder-std',      'local-docs'),
              (2, 'estimate',   'Size effort XS–XL before queueing',
                  'estimate-primary',  'sizer',          'local-free'),
              (3, 'plan',       'Decompose into steps, pick a workflow',
                  'plan-primary',      'coder-max',      'coder-std'),
              (4, 'implement',  'Write the change, run tests, iterate to green',
                  'implement-primary', 'coder-max',      'coder-fallback'),
              (5, 'test-gen',   'Generate unit and regression tests for the diff',
                  'testgen-primary',   'coder-fallback', 'coder-std'),
              (6, 'review',     'Self-review the PR against the acceptance criteria',
                  'review-primary',    'coder-max',      'coder-std'),
              (7, 'docs',       'Update READMEs, changelogs, operator manual',
                  'docs-primary',      'local-docs',     'sizer'),
              (8, 'commit-msg', 'Conventional-commit message from the staged diff',
                  'commitmsg-primary', 'local-free',     'sizer')
            ) as expected (sort_order, name, description, tag, primary_alias, fallback_alias)
       join ouroboros.organization org on org."slug" = 'acme-robotics'
       join ouroboros.task_kinds kind
         on kind.organization_id = org."id"
        and kind.name = expected.name
        and kind.description = expected.description
        and kind.sort_order = expected.sort_order
       join ouroboros.routes route
         on route.task_kind_id = kind.id and route.tag = expected.tag
       join ouroboros.route_hops first_hop
         on first_hop.route_id = route.id and first_hop.position = 1
       join ouroboros.model_aliases primary_alias
         on primary_alias.id = first_hop.model_alias_id
        and primary_alias.alias = expected.primary_alias
       join ouroboros.route_hops second_hop
         on second_hop.route_id = route.id and second_hop.position = 2
       join ouroboros.model_aliases fallback_alias
         on fallback_alias.id = second_hop.model_alias_id
        and fallback_alias.alias = expected.fallback_alias
   ) as rows_of_the_matrix),
  'the eight matrix rows are seeded in order, with the task, tag, primary and fallback each renders');

-- Every route has exactly one chain and every chain is dense from 1, which V016 makes a
-- correctness rule rather than a convention: `floor_hop_index` is a statement about a hop
-- *number*, and a chain numbered 1, 2, 5 makes "below fallback 2" mean nothing.
select pg_temp.must_hold(
  (select count(*) = 8 from (
     select route.id
       from ouroboros.routes route
       join ouroboros.organization org on org."id" = route.organization_id
       join ouroboros.route_hops hop on hop.route_id = route.id
      where org."slug" = 'acme-robotics'
      group by route.id
     having count(*) = max(hop.position) and min(hop.position) = 1
   ) as dense_chains),
  'every seeded chain numbers its hops densely from 1, which is what a floor index can mean');

-- ---------------------------------------------------------------------------
-- The route inspector — `implement-primary`, its three hops, and its three policies.
--
-- The one route the mockup opens. Hop 2 and hop 3 carry the sentences it prints; hop 1
-- carries **none**, because *"Primary · API key valid, 42ms to us-east"* is composed from
-- the position, the connection's status and a latency measured minutes ago. A note holding
-- that sentence would freeze the latency and make the hop disagree with the health chip.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 3 from (
     select hop.position
       from (values
              (1, 'coder-max',      null),
              (2, 'coder-fallback', 'Fallback on 5xx / timeouts'),
              (3, 'local-docs',     'Offline mode — keeps the loop turning without a network')
            ) as expected (position, alias, note)
       join ouroboros.organization org on org."slug" = 'acme-robotics'
       join ouroboros.routes route
         on route.organization_id = org."id" and route.tag = 'implement-primary'
       join ouroboros.route_hops hop
         on hop.route_id = route.id
        and hop.position = expected.position
        and hop.note is not distinct from expected.note
       join ouroboros.model_aliases alias
         on alias.id = hop.model_alias_id and alias.alias = expected.alias
   ) as inspector_chain),
  'the implement chain is coder-max → coder-fallback → local-docs, with the mockup''s two hop notes');

-- Local fallback **on**, the floor switch **off**, and `$2.50` — and the cap is this route's
-- alone. Null on the other seven is *no cap configured*, which is not the same as a default
-- of 250 quietly applied everywhere.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.routes route
     join ouroboros.organization org on org."id" = route.organization_id
    where org."slug" = 'acme-robotics'
      and route.tag = 'implement-primary'
      and route.allow_local_fallback
      and route.floor_hop_index is null
      and route.max_cost_cents_per_run = 250),
  'implement-primary allows local fallback, sets no floor, and caps a run at $2.50');

select pg_temp.must_hold(
  (select count(*) = 7 from ouroboros.routes route
     join ouroboros.organization org on org."id" = route.organization_id
    where org."slug" = 'acme-robotics'
      and route.tag <> 'implement-primary'
      and route.allow_local_fallback
      and route.floor_hop_index is null
      and route.max_cost_cents_per_run is null),
  'the other seven routes allow local fallback and set neither a floor nor a cap');

-- ---------------------------------------------------------------------------
-- The escalation rules — `3 active`, and their sentences character for character.
--
-- `display` is generated by V018 from `"when"` and `"then"`, so what this asserts is that the
-- seeded *structure* renders the card. tests/constraints.sql asserts the same three strings
-- against hand-made fixtures; this asserts the workspace a developer actually opens has them.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 3 from (
     select rule.sort_order
       from (values
              (1, 'effort ≥ L → implement uses coder-max (max thinking)'),
              (2, 'security label → review adds second-opinion vote'),
              (3, 'docs-only diff → everything routes local')
            ) as expected (sort_order, display)
       join ouroboros.organization org on org."slug" = 'acme-robotics'
       join ouroboros.escalation_rules rule
         on rule.organization_id = org."id"
        and rule.sort_order = expected.sort_order
        and rule.display = expected.display
        and rule.enabled
   ) as active_rules),
  'the three escalation rules are enabled and render the card''s three sentences exactly');

-- The names inside those documents are names this workspace has, which is what V018's
-- deferred trigger enforces at write time — asserted here as the state it produced, because a
-- rule naming an alias nobody seeded would be a card pointing at nothing.
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.escalation_rules rule
     join ouroboros.organization org on org."id" = rule.organization_id
     join ouroboros.task_kinds kind
       on kind.organization_id = org."id"
      and kind.name = coalesce(rule."then" #>> '{use_alias,task_kind}',
                               rule."then" #>> '{add_vote,task_kind}')
     join ouroboros.model_aliases alias
       on alias.organization_id = org."id"
      and alias.alias = coalesce(rule."then" #>> '{use_alias,alias}',
                                 rule."then" #>> '{add_vote,alias}')
    where org."slug" = 'acme-robotics'),
  'both rules that name a kind and an alias name ones this workspace has — the third names neither');

-- ---------------------------------------------------------------------------
-- `$/run avg` and `p50 latency` — computed, which is the whole of decision M7.
--
-- Eight rows, eight pairs, and every one of them an aggregate: `avg(cost_cents)` over the
-- kind's calls in the trailing thirty days, and `percentile_cont(0.5)` over their latencies.
-- Nothing on a route, an alias or a connection holds either figure, and this assertion could
-- not pass if anything did — it never reads such a column.
--
-- The `having` is exact equality with no rounding anywhere: the seed spreads each kind's
-- calls symmetrically around the mockup's figure, so the mean *is* the centre and the median
-- *is* the row at it.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 8 from (
     select expected.task_kind
       from (values
              ('analyze',     4.0000,  3100.0),
              ('estimate',    1.0000,  1200.0),
              ('plan',       31.0000,  9800.0),
              ('implement',  87.0000, 41000.0),
              ('test-gen',   12.0000, 17400.0),
              ('review',     22.0000, 12600.0),
              ('docs',        0.0000,  6300.0),
              ('commit-msg',  0.0000,   800.0)
            ) as expected (task_kind, cost_cents, latency_ms)
       join ouroboros.organization org on org."slug" = 'acme-robotics'
       join ouroboros.token_usage usage
         on usage.organization_id = org."id"
        and usage.task_kind = expected.task_kind
        and usage.occurred_at >= now() - interval '30 days'
      group by expected.task_kind, expected.cost_cents, expected.latency_ms
     having avg(usage.cost_cents) = expected.cost_cents
        and percentile_cont(0.5) within group (order by usage.latency_ms)
              = expected.latency_ms
   ) as computed_rows),
  'all eight matrix rows compute the mockup''s $/run avg and p50 latency out of usage alone');

-- ---------------------------------------------------------------------------
-- Spend by provider · 30d, and the local share.
--
-- Every seeded row falls inside the trailing thirty days, so this card is the calendar-month
-- meters mockup 07 draws — on every day of the month, including the first, when the month
-- window collapses and this one does not.
--
-- **Two of the four are not the mockup's**, and cannot be: thirty days is a superset of
-- month-to-date, so mockup 06's Cursor figure of $54.10 is $10.00 *below* a month total
-- mockup 07 pins at $64.10 over the same rows, and no seed can make a superset smaller than
-- what it contains. Copilot's $96.40 would need spend dated before the month began, in a
-- window that is empty on the last day of a 31-day month. The seed lands on the reading both
-- screens can hold at once and #192 asks for the design to be amended; what is asserted here
-- is that the figures are *computed*, and which four they are.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 4 from (
     select expected.provider
       from (values
              ('anthropic',         41280.0000),
              ('copilot',            7600.0000),
              ('cursor',             6410.0000),
              ('openai_compatible',     0.0000)
            ) as expected (provider, cost_cents)
       join ouroboros.organization org on org."slug" = 'acme-robotics'
       join ouroboros.token_usage usage
         on usage.organization_id = org."id"
        and usage.provider = expected.provider
        and usage.occurred_at >= now() - interval '30 days'
      group by expected.provider, expected.cost_cents
     having sum(usage.cost_cents) = expected.cost_cents
   ) as metered),
  'the 30-day spend card computes $412.80 Anthropic, $76.00 Copilot, $64.10 Cursor and $0.00 local');

-- *"Local models served 31% of all tokens."* — `tokens on the two local kinds / all tokens`,
-- over the same window, and it is exactly 31 rather than 31-ish.
select pg_temp.must_hold(
  (select 100 * sum(usage.tokens_in + usage.tokens_out)
                  filter (where usage.provider in ('ollama', 'openai_compatible'))
              = 31 * sum(usage.tokens_in + usage.tokens_out)
     from ouroboros.token_usage usage
     join ouroboros.organization org on org."id" = usage.organization_id
    where org."slug" = 'acme-robotics'
      and usage.occurred_at >= now() - interval '30 days'),
  'local models served exactly 31% of the workspace''s tokens over thirty days');

-- ---------------------------------------------------------------------------
-- The window, and the two figures this seed must not move.
--
-- Nothing lands on today, because mockup 02's *Token spend · today* card is #68's twelve
-- events and nothing else — the dashboard section above pins that number, and this is the
-- rule that protects it. Everything is inside thirty days, because the card and the matrix
-- both read that window and a row outside it would be a call the screen cannot see.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 370 from ouroboros.token_usage usage
    where usage.id::text like '5eed0014%'
      and usage.occurred_at < date_trunc('day', now() at time zone 'utc') at time zone 'utc'
      and usage.occurred_at >= now() - interval '30 days'
      and usage.task_kind is not null
      and usage.latency_ms is not null
      and usage.run_id is null),
  'all 370 routed calls fall before today and inside thirty days, each with a kind and a latency');

-- The rows the other two seeds wrote are the em-dash fixture from the other side: they are
-- spend, and they are not *routed* spend, so they contribute to the card and to no matrix row.
select pg_temp.must_hold(
  (select count(*) = 23 from ouroboros.token_usage usage
     join ouroboros.organization org on org."id" = usage.organization_id
    where org."slug" = 'acme-robotics'
      and usage.task_kind is null
      and usage.latency_ms is null),
  'the twenty-three earlier usage events carry no task kind and no latency, and no matrix row counts them');

-- ---------------------------------------------------------------------------
-- The empty workspace, again — this time as AA.6's routing-guidance fixture, and as the
-- only place M7's em-dash can actually be observed.
--
-- A workspace with no usage has nothing to average and nothing to take a median of, so both
-- aggregates are **null** — which is what the screen must render as `—` rather than as
-- `$0.00` and `0.0s`, both of which are excellent figures for work nobody has done.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 0 from (
     select 1 from ouroboros.model_aliases a
       join ouroboros.organization o on o."id" = a.organization_id
      where o."slug" in ('kensuenobu', 'acme-labs')
     union all
     select 1 from ouroboros.task_kinds k
       join ouroboros.organization o on o."id" = k.organization_id
      where o."slug" in ('kensuenobu', 'acme-labs')
     union all
     select 1 from ouroboros.routes r
       join ouroboros.organization o on o."id" = r.organization_id
      where o."slug" in ('kensuenobu', 'acme-labs')
     union all
     select 1 from ouroboros.route_hops h
       join ouroboros.organization o on o."id" = h.organization_id
      where o."slug" in ('kensuenobu', 'acme-labs')
     union all
     select 1 from ouroboros.escalation_rules e
       join ouroboros.organization o on o."id" = e.organization_id
      where o."slug" in ('kensuenobu', 'acme-labs')
     union all
     select 1 from ouroboros.model_prices p
       join ouroboros.organization o on o."id" = p.organization_id
      where o."slug" in ('kensuenobu', 'acme-labs')
     union all
     select 1 from ouroboros.resolution_snapshots s
       join ouroboros.organization o on o."id" = s.organization_id
      where o."slug" in ('kensuenobu', 'acme-labs')
   ) as routing_rows),
  'neither the personal workspace nor acme-labs has an alias, a kind, a route, a hop, a rule, a price override or a resolution — the empty registry CI.6 renders its guidance against');

select pg_temp.must_hold(
  (select avg(usage.cost_cents) is null
      and percentile_cont(0.5) within group (order by usage.latency_ms) is null
     from ouroboros.token_usage usage
     join ouroboros.organization org on org."id" = usage.organization_id
    where org."slug" = 'kensuenobu'),
  'the personal workspace computes neither a $/run nor a p50 — the em-dash M7 requires, not a zero');

-- ---------------------------------------------------------------------------
-- The health strip — five chips, and two of them measured nothing.
--
-- #221 owns these rows; #192 corrected what `health` holds to the snapshot mockup 06's strip
-- prints, and this is the strip read back. Cursor's empty document is the load-bearing one:
-- *no latency was taken* is said by leaving the key out, never by a zero (V015, decision M8).
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 5 from (
     select conn.id
       from (values
              ('Anthropic Claude',               'active', '{"latency_ms": 42}'),
              ('Cursor',                         'active', '{}'),
              ('GitHub Copilot',                 'error',  '{"detail": "elevated latency"}'),
              ('OpenAI-compatible · local vLLM', 'active', '{"detail": "vLLM local"}'),
              ('Ollama · workstation',           'active',
               '{"detail": "workstation", "models": 3}')
            ) as expected (display_name, status, health)
       join ouroboros.organization org on org."slug" = 'acme-robotics'
       join ouroboros.provider_connections conn
         on conn.organization_id = org."id"
        and conn.display_name = expected.display_name
        and conn.status = expected.status
        and conn.health = expected.health::jsonb
   ) as chips),
  'the five health chips are seeded as mockup 06 draws them — 42ms, nothing, elevated latency, vLLM local, workstation · 3 models');

-- The registry's `⚠ degraded` cell is a provider fact, not a stored word: `coder-fallback`
-- binds to the one connection in `error`, with the detail the chip prints beside it, and
-- the word CH.5 (#588) derives from that appears in no row (tests/seed.test.sh holds the
-- file to it too). Decision R8 — alias health is derived, never probed and never typed.
select pg_temp.must_hold(
  (select conn.status = 'error' and conn.health ->> 'detail' = 'elevated latency'
     from ouroboros.model_aliases alias
     join ouroboros.organization org on org."id" = alias.organization_id
     join ouroboros.provider_connections conn on conn.id = alias.provider_connection_id
    where org."slug" = 'acme-robotics' and alias.alias = 'coder-fallback'),
  'coder-fallback binds to the Copilot connection in error with its note — what the registry derives ⚠ degraded from');

-- ---------------------------------------------------------------------------
-- `$ per 1M in·out` — four shapes and an absence, read through V012's lookup (#582).
--
-- The column is `ouroboros.model_price(workspace, kind, model)` per row, and six of the eight
-- answers come out of the bundled catalog without the seed's help: three `token` rows for
-- the Anthropic trio, `seat` for the Copilot kind, `usage` for the Cursor kind and `free`
-- for the Ollama kind. The seventh priced cell is the one override the routing seed writes —
-- `openai_compatible` is deliberately not free by kind (V012's header) — and the eighth is
-- **no row at all**: `gpt5-experiments` has no provider to look up by, `gpt-5.2-preview` is
-- in no catalog, and the cell renders `—` because R4 forbids inventing the number.
--
-- **The Anthropic figures are the catalog's, not the drawing's.** Mockup 21 reads `$15 · $75`
-- and `$3 · $15`; the vendored snapshot prices claude-fable-5 at $10 · $50 and claude-sonnet-5
-- at $2 · $10, and CG.2 (#580) settled that the catalog is the truth source. What is asserted
-- is that the seven priced cells are *computed* through the lookup, and which shape each is.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 7 from (
     select alias.alias
       from (values
              ('coder-max',      'token', 'bundled',  1000.0000, 5000.0000),
              ('coder-std',      'token', 'bundled',   200.0000, 1000.0000),
              ('sizer',          'token', 'bundled',   100.0000,  500.0000),
              ('coder-fallback', 'seat',  'bundled',  null,      null),
              ('second-opinion', 'usage', 'bundled',  null,      null),
              ('local-docs',     'free',  'bundled',  null,      null),
              ('local-free',     'free',  'override', null,      null)
            ) as expected (alias, billing_mode, source, input_cents, output_cents)
       join ouroboros.organization org on org."slug" = 'acme-robotics'
       join ouroboros.model_aliases alias
         on alias.organization_id = org."id" and alias.alias = expected.alias
       join ouroboros.provider_connections conn
         on conn.id = alias.provider_connection_id
       cross join lateral ouroboros.model_price(org."id", conn.kind, alias.model_id) as price
      where price.billing_mode = expected.billing_mode
        and price.source = expected.source
        and price.input_cents_per_1m is not distinct from expected.input_cents
        and price.output_cents_per_1m is not distinct from expected.output_cents
   ) as priced),
  'the seven bound aliases price through model_price() as three token rows, a seat, a usage and two free — one of them the seeded override');

-- The override is one row, in one workspace, for the model `local-free` binds — both halves
-- of its match are read from the alias and the connection rather than typed, so it cannot
-- drift from the row it prices.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.model_prices price
     join ouroboros.organization org on org."id" = price.organization_id
     join ouroboros.model_aliases alias
       on alias.organization_id = org."id" and alias.alias = 'local-free'
     join ouroboros.provider_connections conn on conn.id = alias.provider_connection_id
    where org."slug" = 'acme-robotics'
      and price.source = 'override'
      and price.match_provider_kind = conn.kind
      and price.match_model = alias.model_id
      and price.billing_mode = 'free'
      and price.id::text like '5eed0016-0000-4000-8000-%')
   and (select count(*) = 1 from ouroboros.model_prices where source = 'override'),
  'exactly one price override exists, and it is acme-robotics'' free vLLM row for the model local-free binds');

-- The absence, asserted: no row anywhere prices the unbound alias's model, so its cell is an
-- honest em-dash and not a zero.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.model_prices where match_model = 'gpt-5.2-preview'),
  'gpt-5.2-preview has no price row, bundled or override — the registry''s dash is unpriced, not free');

-- ---------------------------------------------------------------------------
-- `Used by`, computed out of these rows and stored in none of them (#581).
--
-- CG.3's `alias_references` is the one definition mockup 21's count column, chip list and
-- delete guard all read (decision **R5**), and the seed is where it meets rows somebody
-- else wrote. `coder-max` is the assertion the ticket names: the inspector draws four chips
-- beside it, and three of them are routes whose chains this file seeds while the fourth is
-- the escalation rule that names it. Nothing stores that four.
--
-- **Eight aliases, and four of the counts are not the drawing's.** Mockup 21 reads
-- `3 routes` beside `coder-std`, `1 route` beside `sizer`, `2 routes` beside `local-docs`
-- and `1 route` beside `local-free`; the chains mockup 06 draws — and #192 seeds, hop for
-- hop — reference them 4, 3, 3 and 2 times. Both drawings cannot be right about the same
-- rows, and R5 settles which one moves: the column is *computed*, so the routing matrix is
-- the truth and the registry's four figures are a layout. #582's PR asks for the design to
-- be amended to these; what is asserted is that every count, the unbound row's zero
-- included, falls out of the view and is stored nowhere.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select array_agg(refs.ref_label order by refs.kind, refs.ref_label)
            = array['escalation:effort≥L', 'implement-primary', 'plan-primary', 'review-primary']
     from ouroboros.alias_references refs
     join ouroboros.organization org on org."id" = refs.organization_id
    where org."slug" = 'acme-robotics' and refs.alias = 'coder-max'),
  'the seeded coder-max reads back mockup 21''s four inspector chips — three route tags and the rule — and no fifth');

select pg_temp.must_hold(
  (select array_agg(counted.line order by counted.line) = array[
            'coder-fallback=2', 'coder-max=4', 'coder-std=4', 'gpt5-experiments=0',
            'local-docs=3', 'local-free=2', 'second-opinion=1', 'sizer=3']
     from (select alias.alias || '=' || count(refs.ref_id) as line
             from ouroboros.model_aliases alias
             join ouroboros.organization org on org."id" = alias.organization_id
             left join ouroboros.alias_references refs on refs.alias_id = alias.id
            where org."slug" = 'acme-robotics'
            group by alias.alias) counted),
  'every seeded alias has a Used by count computed by a left join over the view, and none of them stores one');

-- The one the routing seed's own header argues about: `second-opinion` is in no chain at
-- all, and its count is real because the security-label rule names it. A reference index
-- that only followed foreign keys would report it as unreferenced and offer to delete it —
-- which V018 would then refuse, from a screen that had just said it was safe.
select pg_temp.must_hold(
  (select refs.kind = 'escalation' and refs.ref_label = 'escalation:security label'
     from ouroboros.alias_references refs
     join ouroboros.organization org on org."id" = refs.organization_id
    where org."slug" = 'acme-robotics' and refs.alias = 'second-opinion'),
  'second-opinion''s single reference is the rule that votes with it, and not a route');

-- ---------------------------------------------------------------------------
-- Run #482's resolution — the chain card as a stored row (#582, V024, decision R9).
--
-- One snapshot, for the run the dashboard seed already has, in the shape CH.6 (#589) reads
-- back: `implement` → `implement-primary` → `coder-max` → Anthropic (…Xq4A) →
-- `claude-fable-5`, resolved, 42ms. The card's nouns are asserted through the row's columns
-- and its first hop; the run number through the foreign key, because "run #482" is
-- `runs.issue_number` and not a label anybody typed.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.resolution_snapshots snap
     join ouroboros.organization org on org."id" = snap.organization_id
     join ouroboros.runs run on run.id = snap.run_id and run.organization_id = org."id"
    where org."slug" = 'acme-robotics'
      and run.issue_number = 482
      and snap.shape_version = 1
      and snap.task_kind = 'implement'
      and snap.route_tag = 'implement-primary'
      and snap.outcome = 'resolved'
      and snap.duration_ms = 42
      and snap.rules = '[]'::jsonb
      and snap.chain -> 0 ->> 'alias' = 'coder-max'
      and snap.chain -> 0 ->> 'model_id' = 'claude-fable-5'
      and snap.chain -> 0 -> 'provider' ->> 'kind' = 'anthropic'
      and snap.chain -> 0 -> 'provider' ->> 'key_suffix' = 'Xq4A'
      and snap.chain -> 0 -> 'provider' ->> 'status' = 'active'
      and (snap.chain -> 0 -> 'provider' ->> 'latency_ms')::int = 42
      and snap.chain -> 0 ->> 'decision' = 'kept'
      and snap.chain -> 0 ->> 'code' = 'provider_healthy'
      and snap.chain -> 0 ->> 'explanation' = 'Primary · healthy · 42ms'
      and (snap.chain -> 0 ->> 'duration_ms')::int = 42),
  'run #482''s snapshot reads back the chain card verbatim — implement → implement-primary → coder-max → Anthropic (…Xq4A) → claude-fable-5, resolved in 42ms');

-- The chain is the whole of `implement-primary` as Z.1 would have walked it, not the card's
-- one hop: the Copilot fallback is *dropped* because that connection is seeded in `error`,
-- with the sentence resolve() writes for it and no timing, and the local hop is kept in
-- reserve. That is the run console's transcript, and the caption's promise.
select pg_temp.must_hold(
  (select jsonb_array_length(snap.chain) = 3
      and snap.chain -> 1 ->> 'alias' = 'coder-fallback'
      and snap.chain -> 1 ->> 'decision' = 'dropped'
      and snap.chain -> 1 ->> 'code' = 'provider_error'
      and snap.chain -> 1 ->> 'explanation'
            = 'Fallback 1 dropped — GitHub Copilot is unreachable (elevated latency).'
      and snap.chain -> 1 -> 'provider' -> 'key_suffix' = 'null'::jsonb
      and snap.chain -> 1 -> 'duration_ms' = 'null'::jsonb
      and snap.chain -> 1 ->> 'note' = 'Fallback on 5xx / timeouts'
      and snap.chain -> 2 ->> 'alias' = 'local-docs'
      and snap.chain -> 2 ->> 'decision' = 'kept'
      and snap.chain -> 2 ->> 'code' = 'provider_healthy'
      and snap.chain -> 2 ->> 'explanation' = 'Fallback 2 · healthy · workstation'
      and snap.chain -> 2 ->> 'note' = 'Offline mode — keeps the loop turning without a network'
     from ouroboros.resolution_snapshots snap
    where snap.id::text like '5eed0017-0000-4000-8000-%'),
  'the stored chain is all three hops of implement-primary, with the Copilot fallback dropped for the error its connection is seeded in');

-- Every hop copies what its rows say rather than restating it: the chain's params are the
-- aliases' params, its provider names and states are the connections', and the first hop's
-- latency is the Anthropic connection's measured 42ms — the number the inspector prints.
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.resolution_snapshots snap
     cross join lateral jsonb_array_elements(snap.chain) as hop
     join ouroboros.model_aliases alias
       on alias.organization_id = snap.organization_id
      and alias.alias = hop ->> 'alias'
      and alias.model_id = hop ->> 'model_id'
      and alias.params = hop -> 'params'
     join ouroboros.provider_connections conn
       on conn.id = alias.provider_connection_id
      and conn.kind = hop -> 'provider' ->> 'kind'
      and conn.display_name = hop -> 'provider' ->> 'display_name'
      and conn.status = hop -> 'provider' ->> 'status'
      and conn.health -> 'latency_ms'
            is not distinct from nullif(hop -> 'provider' -> 'latency_ms', 'null'::jsonb)
    where snap.id::text like '5eed0017-0000-4000-8000-%'),
  'every stored hop agrees with the alias and connection rows it was copied from');

-- The read the chain card makes — the latest snapshot touching an alias — finds it by
-- containment, and the unbound alias, which no chain can contain, is found by nothing.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.resolution_snapshots
    where chain @> '[{"alias": "coder-max"}]'::jsonb)
   and (select count(*) = 0 from ouroboros.resolution_snapshots
         where chain @> '[{"alias": "gpt5-experiments"}]'::jsonb),
  'the chain card''s containment read finds run #482 by coder-max and finds nothing for the unbound alias');

-- It happened inside the run: after the run started, and before now.
select pg_temp.must_hold(
  (select snap.resolved_at > run.started_at and snap.resolved_at < now()
     from ouroboros.resolution_snapshots snap
     join ouroboros.runs run on run.id = snap.run_id
    where snap.id::text like '5eed0017-0000-4000-8000-%'),
  'the snapshot is stamped inside the run it belongs to, and moves with now() as the run does');

-- ---------------------------------------------------------------------------
-- The id convention, for the routing seed's own rows.
--
-- 416 rows under eight prefixes — an alias, a kind, a route, a hop, a rule, a routed call, a
-- price override and a resolution are each recognisable on sight in a log or a URL — so a
-- row added later with a generated id is caught here rather than by nobody.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 416 from (
     select id from ouroboros.model_aliases    where id::text like '5eed000f-0000-4000-8000-%'
     union all
     select id from ouroboros.task_kinds       where id::text like '5eed0010-0000-4000-8000-%'
     union all
     select id from ouroboros.routes           where id::text like '5eed0011-0000-4000-8000-%'
     union all
     select id from ouroboros.route_hops       where id::text like '5eed0012-0000-4000-8000-%'
     union all
     select id from ouroboros.escalation_rules where id::text like '5eed0013-0000-4000-8000-%'
     union all
     select id from ouroboros.token_usage      where id::text like '5eed0014-0000-4000-8000-%'
     union all
     select id from ouroboros.model_prices     where id::text like '5eed0016-0000-4000-8000-%'
     union all
     select id from ouroboros.resolution_snapshots
                                               where id::text like '5eed0017-0000-4000-8000-%'
   ) as seeded),
  'the routing seed created its 416 prefixed rows and no 417th');


-- ===========================================================================
-- R__dev_seed_audit.sql — the credential trail the Audit log button opens.
--
-- The fifth seed's rows: fourteen `audit_events` (`5eed0015…`), which are what mockup 07's
-- **Audit log** sheet renders and the only fixture any test of that sheet has.
--
-- **The assertions here are about coverage rather than about figures**, which is the
-- difference between this section and the four above it. A dashboard number is right or
-- wrong; a trail is *useful or not*, and what makes it useful is that it contains the rows a
-- renderer would otherwise meet for the first time in production — an event with no actor, an
-- operation that failed, a payload with no secret in it. Each of those is asserted below
-- because each is a fixture the UI is entitled to assume exists.
--
-- The counts are exact, so this is the audit seed's idempotency test as well.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Fourteen events, all in the workspace every mockup is drawn in.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 14 from ouroboros.audit_events event
     join ouroboros.organization org on org."id" = event.organization_id
    where org."slug" = 'acme-robotics'),
  'the audit seed put its fourteen events in acme-robotics');

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.audit_events event
     join ouroboros.organization org on org."id" = event.organization_id
    where org."slug" in ('kensuenobu', 'acme-labs')),
  'and nowhere else — the trail endpoint is organization-scoped, so a second workspace with events would hide a scoping bug rather than expose it');

-- ---------------------------------------------------------------------------
-- Every action AD.4 defines appears, which is what makes this the sheet's fixture.
--
-- Nine names: eight `provider.*` and AD.3's `credential.lease_granted`. A renderer that
-- switches on the action has a row for every branch here, so a branch that renders badly is
-- found by looking rather than by waiting.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select array_agg(distinct event.action order by event.action) =
          array['credential.lease_granted', 'provider.added', 'provider.cap_changed',
                'provider.disabled', 'provider.enabled', 'provider.revealed',
                'provider.rotated', 'provider.tested']
     from ouroboros.audit_events event
     join ouroboros.organization org on org."id" = event.organization_id
    where org."slug" = 'acme-robotics'),
  'the seeded trail exercises every action the vocabulary has a renderer for');

-- ---------------------------------------------------------------------------
-- The three rows a fixture exists to carry.
-- ---------------------------------------------------------------------------

-- A failed rotation is still an event. AD.4's first criterion covers the failure paths, so a
-- trail with nothing but successes in it would leave the row that renders a failure untested.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.audit_events event
     join ouroboros.organization org on org."id" = event.organization_id
    where org."slug" = 'acme-robotics'
      and event.action = 'provider.rotated'
      and event.detail ->> 'outcome' = 'failure'),
  'one rotation in the seeded history failed, so the sheet is drawn against a trail in which something went wrong');

-- A lease grant has no person behind it, and a sheet that assumed one would render nothing
-- sensible against the one event class that never has an actor.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.audit_events event
     join ouroboros.organization org on org."id" = event.organization_id
    where org."slug" = 'acme-robotics'
      and event.action = 'credential.lease_granted'
      and event.actor_id is null),
  'the lease grant has no actor, because a worker authenticates with a service key rather than as a person');

-- Every other event does have one, and it is a real person — so the sheet's join has
-- something to find and the trail names two different people rather than one.
select pg_temp.must_hold(
  (select count(*) = 13 from ouroboros.audit_events event
     join ouroboros.organization org on org."id" = event.organization_id
     join ouroboros."user" person on person."id" = event.actor_id
    where org."slug" = 'acme-robotics')
   and (select count(distinct event.actor_id) = 2 from ouroboros.audit_events event
          join ouroboros.organization org on org."id" = event.organization_id
         where org."slug" = 'acme-robotics' and event.actor_id is not null),
  'the other thirteen name a seeded person, and two different ones, so an actor column is worth rendering');

-- ---------------------------------------------------------------------------
-- The invariant, over the rows rather than over the writer.
--
-- `ouroboros-rest`'s `audit.secrecy.spec.ts` greps what the service writes. This greps what
-- the *seed* writes, which is the other place a credential could reach the trail — a fixture
-- carrying a plausible-looking key would be copied into a test, and from there into an
-- expectation that a key in a payload is normal.
--
-- **Three assertions rather than one keyword sweep**, because a single `~* 'password|token'`
-- over the rendered document is the check that looks strictest and is worth least: it fires
-- on `{"step_up": "password"}`, which is the *name of a re-authentication method* and is
-- exactly the field an audit of a reveal exists to carry. A check that has to be weakened the
-- first time it is right about nothing gets weakened until it is right about nothing at all.
--
-- So the three are separated by what they are actually about:
--
--   * **no value that is shaped like a credential** — the vault's own `ouro.v1.` envelope
--     prefix and the recognisable vendor key forms;
--   * **no field named as a credential field**, whatever it holds, checked against the *keys*
--     rather than the rendered text, which is where `step_up` and `password` stop being the
--     same string;
--   * **and every payload flat and scalar**, which is what makes the first two exhaustive
--     rather than top-level-only.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.audit_events event
    where event.detail::text ~* '(ouro\.v1\.|\msk-[a-z0-9]{8}|\mghp_|\mgho_|\mbearer\M)'),
  'no seeded audit payload holds anything shaped like a credential — no envelope, and no vendor key form');

select pg_temp.must_hold(
  (select count(*) = 0
     from ouroboros.audit_events event,
          lateral jsonb_object_keys(event.detail) as payload_key
    where payload_key ~* '(api[-_]?key|secret|password|credential|authorization|\mtoken\M)'),
  'no seeded audit payload has a field named as a credential field, which is the check that survives step_up meaning password');

select pg_temp.must_hold(
  (select count(*) = 0
     from ouroboros.audit_events event,
          lateral jsonb_each(event.detail) as payload (key, value)
    where jsonb_typeof(payload.value) in ('object', 'array')),
  'every seeded payload is flat and scalar, so enumerating its keys is the whole of reading it');

-- The five arrival events agree with the cards about when each provider arrived, which is the
-- one place this seed and the providers seed have to say the same thing.
select pg_temp.must_hold(
  (select count(*) = 5 from ouroboros.audit_events event
     join ouroboros.provider_connections conn on conn.id::text = event.subject_id
    where event.action = 'provider.added'
      and conn.created_at = event.occurred_at),
  'each provider.added is stamped with the moment its card says the connection was created');

-- ---------------------------------------------------------------------------
-- The id convention, for the audit seed's own rows.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 14 from ouroboros.audit_events
    where id::text like '5eed0015-0000-4000-8000-%'),
  'the audit seed created its fourteen prefixed rows and no fifteenth');

-- ===========================================================================
-- R__dev_seed_intake.sql — mockup 03's backlog, row for row.
--
-- The sixth seed's rows: nine `github_issues` (`5eed0018…`) in
-- `acme-robotics / helios-firmware`, and the nine `issue_estimates` (`5eed0019…`) that
-- size eight of them. Scoped to those ids and to that repository, for the reason every
-- other seed's assertions are scoped: a developer who mirrored a repository of their own
-- must not fail this suite.
--
-- The counts are exact, so this is the intake seed's idempotency test as well — and it is
-- a sharper one than the others', because `issue_estimates` carries a BEFORE INSERT
-- trigger that would *raise* on a second application rather than quietly duplicate. A
-- second `migrate` that reached it at all would fail the run before it reached this file.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The nine issues, and the page head's two counts.
--
-- *"9 open issues. 7 already sized."* — the acceptance criterion, and the whole of what
-- M.1's `meta` computes. The mockup prints 42/38; those are design copy over a backlog
-- forty-two issues deep, and the seed's truth is nine (the migration's header says why at
-- length). Asserted as counts rather than as a stored figure, because counting them is
-- exactly what the endpoint does.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 9
     from ouroboros.github_issues issue
     join ouroboros.github_repos  repo on repo.id = issue.github_repo_id
     join ouroboros.github_orgs   gh   on gh.id = repo.org_id
     join ouroboros.organization  org  on org."id" = issue.organization_id
    where org."slug" = 'acme-robotics'
      and gh.login = 'acme-robotics'
      and repo.name = 'helios-firmware'),
  'the nine mockup-03 issues are mirrored into acme-robotics/helios-firmware, exactly once');

select pg_temp.must_hold(
  (select array_agg(issue.number order by issue.number) = array[483, 484, 485, 486, 487, 488, 489, 490, 491]
     from ouroboros.github_issues issue
     join ouroboros.github_repos repo on repo.id = issue.github_repo_id
    where repo.name = 'helios-firmware'),
  'they are #483 through #491, with no tenth and no gap');

select pg_temp.must_hold(
  (select count(*) = 9 and count(*) filter (where issue.sizing_status = 'sized') = 7
     from ouroboros.github_issues issue
     join ouroboros.github_repos repo on repo.id = issue.github_repo_id
    where repo.name = 'helios-firmware'
      and issue.state = 'open'),
  'the page head computes to "9 open issues. 7 already sized." over the seeded rows');

-- The other two of the nine, and they are the two the status pill has a colour for:
-- `#483` is mid-flight and `#490` came back for a human.
select pg_temp.must_hold(
  (select count(*) = 2
     from ouroboros.github_issues issue
     join ouroboros.github_repos repo on repo.id = issue.github_repo_id
    where repo.name = 'helios-firmware'
      and (issue.number, issue.sizing_status) in ((483, 'estimating'), (490, 'needs_human'))),
  '#483 is estimating and #490 needs a human — the two rows that are not sized');

-- One poll confirmed all nine at once, which is what `synced_at` records and what makes
-- `max(synced_at)` over the mirror the freshness tag mockup 03 prints. The repository's
-- own watermark stays null: it is the sync's record of itself, and K.4 is what stamps it.
select pg_temp.must_hold(
  (select count(distinct issue.synced_at) = 1
     from ouroboros.github_issues issue
     join ouroboros.github_repos repo on repo.id = issue.github_repo_id
    where repo.name = 'helios-firmware'),
  'all nine carry the same synced_at, because one poll is what would have confirmed them');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.github_repos
    where name = 'helios-firmware'
      and issues_synced_at is null
      and issues_sync_cursor is null),
  'the seed stamps no sync watermark on the repository — that is K.4''s to write, not a fixture''s');

-- The authors, including the one the panel names and the one V028 exists for.
select pg_temp.must_hold(
  (select count(*) = 9 and count(*) filter (where issue.author_login = 'renovate[bot]') = 1
     from ouroboros.github_issues issue
     join ouroboros.github_repos repo on repo.id = issue.github_repo_id
    where repo.name = 'helios-firmware'
      and issue.author_login is not null),
  'every mirrored issue has an author, and exactly one of them is a GitHub App (V028''s [bot] suffix)');

-- `#488` was opened with a title and no description, which is a null body rather than an
-- empty one — V014 makes the column nullable so the panel can render the absence.
select pg_temp.must_hold(
  (select count(*) = 1
     from ouroboros.github_issues issue
     join ouroboros.github_repos repo on repo.id = issue.github_repo_id
    where repo.name = 'helios-firmware'
      and issue.body is null
      and issue.number = 488),
  '#488 alone has no body — the issue opened with a title and nothing else');

-- ---------------------------------------------------------------------------
-- `#485`, field for field — the detail panel's fixture.
--
-- Acceptance criterion: *the detail panel for #485 matches the mockup content field for
-- field*. Everything the panel prints is below — the meta line's author, the heading, the
-- four tags (the table cell draws three of them; the row has one label set), the body it
-- excerpts, and the href behind *Open on GitHub ↗*.
--
-- `opened 2d ago` is asserted as a window rather than as an instant, because the seed's
-- clock is `now()` and the assertion runs some seconds after the insert did.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 1
     from ouroboros.github_issues issue
     join ouroboros.github_repos repo on repo.id = issue.github_repo_id
    where repo.name = 'helios-firmware'
      and issue.id = '5eed0018-0000-4000-8000-000000000485'
      and issue.number = 485
      and issue.title = 'Watchdog reset on I²C bus lockup'
      and issue.state = 'open'
      and issue.sizing_status = 'sized'
      and issue.author_login = 'field-support'
      and issue.labels = '["bug", "i2c", "watchdog", "priority-high"]'::jsonb
      and issue.gh_url = 'https://github.com/acme-robotics/helios-firmware/issues/485'
      and issue.gh_created_at between now() - interval '49 hours' and now() - interval '47 hours'),
  '#485 is the panel''s issue: its title, its four tags, field-support, its link, and opened 2d ago');

select pg_temp.must_hold(
  (select issue.body = 'Unit 07 in the Fremont pilot rebooted 14 times overnight. Logs show '
                    || 'the IMU holding SDA low after a burst read; the bus never recovers '
                    || 'and the hardware watchdog fires ~2 s later. We need a bus-recovery '
                    || 'sequence (9 clock pulses + re-init) before the watchdog trips.'
     from ouroboros.github_issues issue
    where issue.id = '5eed0018-0000-4000-8000-000000000485'),
  '#485''s body is the text the panel excerpts, without the quotation marks the blockquote adds');

select pg_temp.must_hold(
  (select count(*) = 1
     from ouroboros.issue_estimates est
    where est.github_issue_id = '5eed0018-0000-4000-8000-000000000485'
      and est.version = 1
      and est.effort = 'm'
      and est.confidence = 92
      and est.suggested_workflow = 'standard-fix'
      and est.routed_model = 'claude-fable-5'
      and est.risk = 'low'
      and est.risk_note = 'Isolated to the I²C driver path; full HIL coverage exists for bus recovery.'
      and est.breakdown->'files' = '["drivers/i2c_recovery.c", "drivers/imu_bmi270.c", "tests/unit/test_i2c_lockup.c"]'::jsonb
      and est.breakdown->>'est_tokens' = '180000'
      and est.breakdown->>'cycle_min' = '12'
      and est.breakdown->>'cycle_max' = '18'
      and est.breakdown->>'est_minutes' = '45'),
  '#485''s AI Work Breakdown is the mockup''s: M at 92%, three files, ~180k tokens, a 12-18 min cycle, low risk');

-- ---------------------------------------------------------------------------
-- The table's other seven sized rows.
--
-- The *Effort*, *Suggested workflow* and *Routed model* columns of mockup 03, asserted as
-- one set: a row is its chip, its confidence, its tag and its pill, and asserting them
-- separately would let a seed that paired the right values with the wrong issue pass.
-- `#487`'s is the estimate **in force**, which is version 2 — see the latest-wins block
-- below.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 8
     from ouroboros.github_issues issue
     join ouroboros.github_repos repo on repo.id = issue.github_repo_id
     join lateral (select est.*
                     from ouroboros.issue_estimates est
                    where est.github_issue_id = issue.id
                    order by est.version desc
                    limit 1) latest on true
    where repo.name = 'helios-firmware'
      and (issue.number, latest.effort, latest.confidence,
           latest.suggested_workflow, latest.routed_model) in (
        (484, 'm',  88, 'standard-fix', 'cursor/composer-2'),
        (485, 'm',  92, 'standard-fix', 'claude-fable-5'),
        (486, 'l',  84, 'feature-loop', 'claude-sonnet-5'),
        (487, 'l',  71, 'feature-loop', 'claude-fable-5'),
        (488, 'xs', 98, 'docs-loop',    'ollama/qwen3-coder'),
        (489, 'm',  78, 'standard-fix', 'claude-sonnet-5'),
        (490, 'xl', 61, 'deps-refresh', 'claude-fable-5'),
        (491, 's',  95, 'standard-fix', 'copilot/gpt-5-codex'))),
  'the eight sized rows carry the mockup''s effort, confidence, workflow and model, issue by issue');

-- `#483` has no estimate at all, which is what `estimating` means: `issue_estimates` has
-- no partial row, because effort and confidence are not null and an estimate is one
-- answer rather than four fields that arrive separately.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.issue_estimates
    where github_issue_id = '5eed0018-0000-4000-8000-000000000483'),
  '#483 is mid-flight, so it has no estimate row rather than an empty one');

-- The sort M.1 documents is **total** over these rows: no two issues share an
-- (effort, confidence) pair, so `effort` ascending with `confidence` descending has
-- exactly one answer and a parity test cannot flake on a tie the planner broke.
select pg_temp.must_hold(
  (select count(*) = count(distinct (latest.effort, latest.confidence))
     from ouroboros.github_issues issue
     join ouroboros.github_repos repo on repo.id = issue.github_repo_id
     join lateral (select est.effort, est.confidence
                     from ouroboros.issue_estimates est
                    where est.github_issue_id = issue.id
                    order by est.version desc
                    limit 1) latest on true
    where repo.name = 'helios-firmware'),
  'no two issues share an effort and a confidence, so sort=effort is total over the fixture');

-- All five effort chips and all three risk levels appear, which is what makes the CHECKs
-- on both columns something the fixture exercises rather than something only
-- tests/constraints.sql has ever seen.
select pg_temp.must_hold(
  (select array_agg(distinct effort order by effort) = array['l', 'm', 's', 'xl', 'xs']
      and array_agg(distinct risk   order by risk)   = array['high', 'low', 'medium']
     from ouroboros.issue_estimates
    where id::text like '5eed0019-0000-4000-8000-%'),
  'the seeded estimates exercise all five efforts and all three risk levels');

-- ---------------------------------------------------------------------------
-- Latest wins — `#487`, the one issue estimated twice.
--
-- Decision K4: re-estimation is a new row and the highest version is in force. Against a
-- fixture where every issue has exactly one estimate, a latest-wins join, a min(version)
-- join and a join that takes an arbitrary row all pass; this is the row that separates
-- them, and every visible field differs between the two versions so the failure is
-- legible rather than subtle.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.issue_estimates
    where github_issue_id = '5eed0018-0000-4000-8000-000000000487'),
  '#487 carries two estimates, which is what makes latest-wins observable');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.issue_estimates
    where github_issue_id = '5eed0018-0000-4000-8000-000000000487'
      and version = 1
      and effort = 's'
      and confidence = 55
      and suggested_workflow = 'standard-fix'
      and routed_model = 'ollama/qwen3-coder'
      and risk = 'low'),
  'the superseded estimate differs from the one in force in every field a screen renders');

-- ---------------------------------------------------------------------------
-- Decision K10 — every estimate says what produced it, and says nothing it cannot.
--
-- `heuristic-v0` on all nine, `tokens_used` 0 because a rule engine called no model, and
-- `signals` empty because there is no knowledge layer yet to have retrieved anything. The
-- mockup's trace line — *sized by claude-sonnet-5 · 2m ago · 41k tokens*, over three
-- named signals — is design copy for a component O.4 will write, and seeding it would be
-- a screen showing a provenance nothing produced.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 9
     from ouroboros.issue_estimates
    where id::text like '5eed0019-0000-4000-8000-%'
      and trace->>'estimator' = 'heuristic-v0'
      and trace->>'tokens_used' = '0'
      and trace->'signals' = '[]'::jsonb),
  'every seeded estimate is heuristic-v0''s, cost no tokens, and claims no signal (decision K10)');

-- `sized_at` is the estimator's clock and `created_at` is the row's, and for a synchronous
-- estimator they are the same instant — which is what makes them worth asserting together:
-- a seed that let them drift would make the panel's "2m ago" disagree with the row.
select pg_temp.must_hold(
  (select count(*) = 9
     from ouroboros.issue_estimates
    where id::text like '5eed0019-0000-4000-8000-%'
      and date_trunc('second', (trace->>'sized_at')::timestamptz)
            = date_trunc('second', created_at)),
  'sized_at and created_at name the same instant, as they do for a synchronous estimator');

-- `#488`'s breakdown names no files, and that is an answer rather than a gap — the panel
-- renders the absence instead of guessing, and a fixture where every estimate happened to
-- name files would leave that path unexercised.
select pg_temp.must_hold(
  (select count(*) = 1
     from ouroboros.issue_estimates
    where id::text like '5eed0019-0000-4000-8000-%'
      and breakdown->'files' = '[]'::jsonb),
  'exactly one seeded estimate names no files, which is the empty-list path V026 makes valid');

-- ---------------------------------------------------------------------------
-- The queue rows are DASH-F.5's, and this seed added none.
--
-- Acceptance criterion: *consistent with DASH-F.5 queue seeds (no double-queued rows)*.
-- Two halves. The count is still twelve — a thirteenth written from here would break
-- mockup 02's *Queued issues* stat and its `est. 9h 40m` — and where an issue is queued in
-- the same repository, its estimate's `est_minutes` is the number the queue row carries,
-- because M.3 copies one into the other and the two must not disagree about the same work.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 12 from ouroboros.queue_items
    where id::text like '5eed000a-0000-4000-8000-%'),
  'the queue still holds the dashboard seed''s twelve items and no thirteenth');

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.queue_items
    where id::text like '5eed0018-0000-4000-8000-%'
       or id::text like '5eed0019-0000-4000-8000-%'),
  'the intake seed writes no queue item — the queue rows are cross-referenced, not duplicated');

select pg_temp.must_hold(
  (select count(*) = 5 and bool_and((latest.breakdown->>'est_minutes')::integer = item.est_minutes)
     from ouroboros.github_issues issue
     join ouroboros.github_repos repo on repo.id = issue.github_repo_id
     join ouroboros.queue_items item on item.github_repo_id = repo.id
                                    and item.issue_number = issue.number
     join lateral (select est.breakdown
                     from ouroboros.issue_estimates est
                    where est.github_issue_id = issue.id
                    order by est.version desc
                    limit 1) latest on true
    where repo.name = 'helios-firmware'),
  'where a seeded issue is already queued, its estimate and its queue row agree about est_minutes');

-- ---------------------------------------------------------------------------
-- The empty-state fixture, for the backlog this time.
--
-- Acceptance criterion: *the personal org yields zero backlog rows*. N.6 (#120) renders
-- its empty state against `kensuenobu`, which has two enabled repositories and no
-- mirrored issue in either — the absence itself, in the same database as the presence,
-- rather than a screenshot of one.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.github_issues issue
     join ouroboros.organization org on org."id" = issue.organization_id
    where org."slug" in ('kensuenobu', 'acme-labs')),
  'neither the personal workspace nor acme-labs has a mirrored issue');

select pg_temp.must_hold(
  (select count(*) = 0
     from ouroboros.issue_estimates est
     join ouroboros.github_issues issue on issue.id = est.github_issue_id
     join ouroboros.organization org on org."id" = issue.organization_id
    where org."slug" in ('kensuenobu', 'acme-labs')),
  'and therefore neither has an estimate');

-- The other three enabled repositories of acme-robotics are empty too: the backlog screen
-- is scoped to one repository, and a fixture that spread rows across four would make the
-- *Repository* select untestable.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.github_issues issue
     join ouroboros.github_repos repo on repo.id = issue.github_repo_id
    where repo.name in ('helios-console', 'helios-telemetry', 'atlas-scheduler')),
  'the mirror holds helios-firmware and nothing else, so the Repository select has an empty side');

-- ---------------------------------------------------------------------------
-- The id convention, for the intake seed's own rows.
--
-- Eighteen rows under two prefixes — `5eed0018…` a mirrored issue, `5eed0019…` an
-- estimate of one — so the two are told apart on sight in a log or a URL, and a row added
-- later with a generated id is caught here rather than by nobody.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 18 from (
     select id from ouroboros.github_issues   where id::text like '5eed0018-0000-4000-8000-%'
     union all
     select id from ouroboros.issue_estimates where id::text like '5eed0019-0000-4000-8000-%'
   ) as seeded),
  'the intake seed created its eighteen prefixed rows and no nineteenth');


-- ===========================================================================
-- R__dev_seed_sources.sql — where acme-robotics' work comes from.
--
-- The seventh seed's rows: two `ticket_sources` (`5eed001a…`) in `acme-robotics`, one
-- `github` and one `jira`. Scoped to those ids and that workspace, for the reason every
-- other seed's assertions are scoped: a developer who configured a source of their own must
-- not fail this suite.
--
-- The counts are exact, so this is the sources seed's idempotency test too. The canonical
-- tickets the GitHub source holds are R__dev_seed_ticket_planning.sql's (#275), and are
-- asserted in that seed's block below.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Two sources, two kinds, one workspace.
--
-- The pair is the point: source-neutrality is only visible where two kinds coexist. Both are
-- connected since #275, because mockup 09's *Tracker Sync* card draws both with an ok dot.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 2
     from ouroboros.ticket_sources src
     join ouroboros.organization org on org."id" = src.organization_id
    where org."slug" = 'acme-robotics'
      and src.id::text like '5eed001a-0000-4000-8000-%'),
  'the sources seed configured two ticket sources for acme-robotics');

select pg_temp.must_hold(
  (select array_agg(src.kind order by src.kind) = array['github', 'jira']
     from ouroboros.ticket_sources src
    where src.id::text like '5eed001a-0000-4000-8000-%'),
  'one GitHub and one Jira — a development stack in which a second tracker is not hypothetical');

select pg_temp.must_hold(
  (select array_agg(src.status order by src.kind) = array['active', 'active']
     from ouroboros.ticket_sources src
    where src.id::text like '5eed001a-0000-4000-8000-%'),
  'both sources are active — mockup 09 draws GitHub and Jira as connected');

-- ---------------------------------------------------------------------------
-- The GitHub source: the four repositories R__dev_seed.sql enables, in config.
--
-- Decision P6 is what this asserts: the repository list is a provider's idea of scope kept
-- in `config`, not a column or a join table, and the Jira row below is why.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select src.display_name = 'GitHub · acme-robotics'
          and src.config->>'login' = 'acme-robotics'
          and src.config->'repos' @> '["helios-firmware"]'::jsonb
          and jsonb_array_length(src.config->'repos') = 4
     from ouroboros.ticket_sources src
    where src.id = '5eed001a-0000-4000-8000-000000000001'),
  'the GitHub source names the workspace''s org and its four enabled repositories in config');

-- Its credential is a real envelope the vault's own CHECK accepted, and it opens nothing —
-- the base64url body is a sentence saying so, and there is no key anywhere that would
-- decrypt it. Asserted against the envelope grammar rather than with a `like 'ouro.v1.%'`,
-- which is what the providers seed's assertions settle for: the grammar is the thing
-- V030's CHECK enforces, so it is the thing worth asserting the seed produced.
select pg_temp.must_hold(
  (select src.credentials_encrypted ~ '^ouro\.v1\.[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
     from ouroboros.ticket_sources src
    where src.id = '5eed001a-0000-4000-8000-000000000001'),
  'the GitHub source carries one of the vault''s envelopes, not a token');

-- ---------------------------------------------------------------------------
-- The Jira source: no repository anywhere in it.
--
-- The row the whole seed exists to put in a development database. A site and a project key,
-- and nothing a GitHub-shaped reader could have assumed.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select src.display_name = 'Jira · PROJ'
          and src.config->>'base_url' = 'https://acme-robotics.atlassian.net'
          and src.config->'project_keys' = '["PROJ"]'::jsonb
          and not src.config ? 'repos'
          and not src.config ? 'login'
     from ouroboros.ticket_sources src
    where src.id = '5eed001a-0000-4000-8000-000000000002'),
  'the Jira source is a site and a project key — no repository, no login, no issue numbers');

select pg_temp.must_hold(
  (select src.credentials_encrypted
            = 'ouro.v1.1.c2VlZC1ub25jZS01.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1jcmVkZW50aWFsLWppcmE'
     from ouroboros.ticket_sources src
    where src.id = '5eed001a-0000-4000-8000-000000000002'),
  'and it carries its own sealed development credential, which is what lets it be active');

-- There is no third kind. The *Tracker Sync* card's `Linear · not connected` row and its
-- **connect ↗** are rendered from this absence, so a seeded `linear` source would silently
-- take the CTA away.
select pg_temp.must_hold(
  (select count(*) = 0
     from ouroboros.ticket_sources src
     join ouroboros.organization org on org."id" = src.organization_id
    where org."slug" = 'acme-robotics'
      and src.kind = 'linear'),
  'acme-robotics has no Linear source, so its tracker card offers to connect one');

-- ---------------------------------------------------------------------------
-- Neither source has been polled.
--
-- The same restraint R__dev_seed_intake.sql showed when it left
-- `github_repos.issues_synced_at` null: a stamp here would claim a poll that never happened.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 2
     from ouroboros.ticket_sources src
    where src.id::text like '5eed001a-0000-4000-8000-%'
      and src.sync_cursor is null and src.synced_at is null),
  'no sync has run against either source, and neither claims one has');

-- ---------------------------------------------------------------------------
-- The id convention, for the sources seed's own rows.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.ticket_sources
    where id::text like '5eed001a-0000-4000-8000-%'),
  'the sources seed created its two prefixed rows and no third');


-- ===========================================================================
-- R__dev_seed_workflows.sql — mockup 04's studio.
--
-- The eighth seed's rows: five `workflows` (`5eed001b…`) and nineteen
-- `workflow_versions` (`5eed001c…`), all of them `acme-robotics`'. Scoped to those ids and
-- that workspace, for the reason every other seed's assertions are scoped: a developer who
-- built a workflow of their own must not fail this suite.
--
-- The counts are exact, so this is the workflows seed's idempotency test too — and it is the
-- one seed where that matters most, because `workflow_version_next` raises on a second
-- application unless the statement's `not exists` guard holds it off, and a seed that lost
-- that guard would fail `migrate` rather than fail quietly.
--
-- It asserts three kinds of thing, and they are worth telling apart:
--
--   * **What the seed wrote** — the entities, the history, the draft, and the canvas node for
--     node and edge for edge against mockup 04.
--   * **What the DSL requires of a document and JSON Schema cannot say** — one trigger,
--     somewhere to end, every stage reachable from the trigger. `schemas/workflow-dsl/v1.json`
--     describes values, and *"every node is reachable"* is not a property of a value, so it is
--     asserted here over every stored definition. The grammar's own validator lives in
--     `ouroboros-rest` and `dsl.seed.spec.ts` runs it over these same documents.
--   * **What P.4 then renders** — the five rail captions and the head's usage share,
--     recomputed here the way `stats.captions.ts` composes them, because a caption is the
--     acceptance criterion and not the column it is derived from.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The five entities the rail lists.
--
-- The order is the assertion worth reading twice: P.4 lists `order by created_at asc, slug
-- asc`, so the mockup's rail is a claim about *when each workflow was created* and an
-- alphabetical seed would have put `deps-refresh` at the top of the studio.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 5
     from ouroboros.workflows wf
     join ouroboros.organization org on org."id" = wf.organization_id
    where org."slug" = 'acme-robotics'
      and wf.id::text like '5eed001b-0000-4000-8000-%'),
  'the workflows seed created acme-robotics'' five workflows');

select pg_temp.must_hold(
  (select array_agg(wf.slug order by wf.created_at, wf.slug)
            = array['standard-fix', 'feature-loop', 'deps-refresh', 'docs-loop', 'hotfix-p0']
     from ouroboros.workflows wf
    where wf.id::text like '5eed001b-0000-4000-8000-%'),
  'and they are the rail''s five entries, in the rail''s order — which is created_at, not the alphabet');

select pg_temp.must_hold(
  (select count(*) = 5 from ouroboros.workflows wf
    where wf.id::text like '5eed001b-0000-4000-8000-%' and wf.name = wf.slug),
  'the name is the slug on all five, which is what mockup 04 renders in both places it names one');

select pg_temp.must_hold(
  (select array_agg(wf.status order by wf.created_at) = array['active', 'active', 'active', 'active', 'paused']
     from ouroboros.workflows wf
    where wf.id::text like '5eed001b-0000-4000-8000-%'),
  'four are active and hotfix-p0 is paused — the rail''s err-dot as a column');

select pg_temp.must_hold(
  (select array_agg(wf.current_version order by wf.created_at) = array[14, 1, 1, 1, 1]
     from ouroboros.workflows wf
    where wf.id::text like '5eed001b-0000-4000-8000-%'),
  'standard-fix runs v14 — the page head''s chip — and the other four their first publish');

select pg_temp.must_hold(
  (select count(*) = 5
     from ouroboros.workflows wf
     join ouroboros.workflow_versions first
       on first.workflow_id = wf.id and first.version = 1
    where wf.id::text like '5eed001b-0000-4000-8000-%'
      and date_trunc('minute', wf.created_at) = date_trunc('minute', first.published_at)),
  'each workflow is exactly as old as its own history — created_at is when its v1 was published');

select pg_temp.must_hold(
  (select count(*) = 0
     from ouroboros.workflows wf
     join ouroboros.organization org on org."id" = wf.organization_id
    where org."slug" in ('acme-labs', 'kensuenobu')),
  'and the personal and second workspaces have none — the empty-state fixture S.7 renders against');


-- ---------------------------------------------------------------------------
-- The history — fourteen versions, because v14 is a number the database counts to.
--
-- `workflow_version_next` holds versions dense from 1, so *v14, active* is fourteen rows and
-- the ticket's *"version history depth ≥ 2"* comes with them. What the seed does not do is
-- invent thirteen graphs: v1–v13 are one predecessor changed one true way each, and the
-- assertion below is that every change note names the number its own document carries.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 19 from ouroboros.workflow_versions
    where id::text like '5eed001c-0000-4000-8000-%'),
  'nineteen version rows — fourteen of standard-fix, one apiece for the other four, and one draft');

select pg_temp.must_hold(
  (select array_agg(v.version order by v.version) = (select array_agg(n) from generate_series(1, 14) as n)
     from ouroboros.workflow_versions v
     join ouroboros.workflows wf on wf.id = v.workflow_id and wf.slug = 'standard-fix'
    where v.version is not null),
  'standard-fix''s history is dense from 1 to 14, because v14 is a number the trigger counts to');

select pg_temp.must_hold(
  (select count(*) = 13
     from ouroboros.workflow_versions v
     join ouroboros.workflows wf on wf.id = v.workflow_id and wf.slug = 'standard-fix'
    where v.version between 1 and 13
      and jsonb_array_length(v.definition -> 'nodes') = 6
      and (v.definition #>> '{nodes,3,config,limits,token_budget}')::int = 120000 + v.version * 20000),
  'v1-v13 are the six-node predecessor, each raising the implement budget by 20k as its note says');

select pg_temp.must_hold(
  (select count(*) = 12
     from ouroboros.workflow_versions v
     join ouroboros.workflows wf on wf.id = v.workflow_id and wf.slug = 'standard-fix'
    where v.version between 2 and 13
      and v.change_note = 'Raise the implement stage''s token budget to '
                          || ((120000 + v.version * 20000) / 1000)::text || 'k.'),
  'and every one of those notes names the number its own document carries');

select pg_temp.must_hold(
  (select v.published_by is null and v.change_note = 'Imported from the standard-fix template.'
     from ouroboros.workflow_versions v
     join ouroboros.workflows wf on wf.id = v.workflow_id and wf.slug = 'standard-fix'
    where v.version = 1),
  'v1 was published by nobody — the template import, and the fixture for published_by''s null');

select pg_temp.must_hold(
  (select count(distinct v.published_by) = 3
     from ouroboros.workflow_versions v
    where v.id::text like '5eed001c-0000-4000-8000-%' and v.published_by is not null),
  'three people have published into this workspace, so published_by has more than one answer');

select pg_temp.must_hold(
  (select count(*) = 19
     from ouroboros.workflow_versions v
    where v.id::text like '5eed001c-0000-4000-8000-%'
      and (v.version is null) = (v.published_at is null)
      and (v.published_at is not null or (v.published_by is null and v.change_note is null))),
  'every row is a published version or the draft, and no row is half of each');


-- ---------------------------------------------------------------------------
-- The draft — the row the page head's *Last edited 2h ago* is read from.
--
-- An hour either side of two hours, which is `#485`'s *opened 2d ago* band and for its
-- reason: the suite runs some time after `migrate` did, and a stamp relative to `now()`
-- drifts by exactly that much.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 1
     from ouroboros.workflow_versions v
     join ouroboros.workflows wf on wf.id = v.workflow_id
    where v.id::text like '5eed001c-0000-4000-8000-%'
      and v.version is null
      and wf.slug = 'standard-fix'),
  'exactly one workflow is being edited, and it is standard-fix');

select pg_temp.must_hold(
  (select v.updated_at between now() - interval '3 hours' and now() - interval '1 hour'
     from ouroboros.workflow_versions v
     join ouroboros.workflows wf on wf.id = v.workflow_id and wf.slug = 'standard-fix'
    where v.version is null),
  'the draft was last edited two hours ago — the page head''s *Last edited 2h ago*');

select pg_temp.must_hold(
  (select draft.updated_at > published.published_at
     from ouroboros.workflows wf
     join ouroboros.workflow_versions draft on draft.workflow_id = wf.id and draft.version is null
     join ouroboros.workflow_versions published on published.workflow_id = wf.id and published.version = 14
    where wf.slug = 'standard-fix'),
  'and it was opened after the version it was copied from was published, which is the only order it could have happened in');

select pg_temp.must_hold(
  (select draft.definition = published.definition
     from ouroboros.workflows wf
     join ouroboros.workflow_versions draft on draft.workflow_id = wf.id and draft.version is null
     join ouroboros.workflow_versions published on published.workflow_id = wf.id and published.version = 14
    where wf.slug = 'standard-fix'),
  'and its document is v14''s, which is what *start editing* leaves behind and what the canvas renders');


-- ---------------------------------------------------------------------------
-- The canvas, against mockup 04.
--
-- Positions matter here in a way they did not on any previous screen: parity means the graph
-- renders where the mockup draws it, so the nodes are asserted with their coordinates and the
-- edges with their labels and kinds. The `left:`/`top:` values in
-- `docs/mockups/04-workflow-builder.html` are the numbers on the right-hand side of these
-- arrays.
--
-- The Implement stage is asserted as a whole object rather than field by field, which is what
-- makes it the *inspector*: a field added to that config by a later edit fails here instead of
-- appearing in a panel nobody drew.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select array_agg(n.value ->> 'id' || ' ' || (n.value ->> 'type') || ' '
                    || (n.value #>> '{position,x}') || ',' || (n.value #>> '{position,y}')
                    order by n.ord)
          = array[
              'issue-queued trigger 24,40',
              'analyze llm 306,40',
              'effort-recheck flow 588,40',
              'plan llm 588,230',
              'split llm 306,230',
              'back-to-queue term 32,260',
              'implement llm 588,420',
              'build infra 306,420',
              'test infra 24,420',
              'review llm 24,630',
              'checks-green flow 306,630',
              'open-pr term 588,630']
     from ouroboros.workflows wf
     join ouroboros.workflow_versions v on v.workflow_id = wf.id and v.version = wf.current_version
    cross join lateral jsonb_array_elements(v.definition -> 'nodes') with ordinality as n(value, ord)
    where wf.slug = 'standard-fix'),
  'the canvas is mockup 04''s twelve nodes at mockup 04''s twelve positions, in its own order');

select pg_temp.must_hold(
  (select n.value -> 'config' = jsonb_build_object(
            'mode', 'skill',
            'skill', 'zephyr-conventions',
            'prompt_template', 'Implement the approved plan.

Issue: {{issue.title}}
Plan:  {{plan}}
Rules: touch only files named in the plan; follow the skill.',
            'routing', jsonb_build_object('inherit_task', 'implement'),
            'limits', jsonb_build_object('max_retries', 2, 'token_budget', 400000),
            'permissions', jsonb_build_object('push_fixup', true, 'touch_ci', false))
     from ouroboros.workflows wf
     join ouroboros.workflow_versions v on v.workflow_id = wf.id and v.version = wf.current_version
    cross join lateral jsonb_array_elements(v.definition -> 'nodes') as n
    where wf.slug = 'standard-fix' and n.value ->> 'id' = 'implement'),
  'and the Implement stage is the inspector field for field — skill mode, the prompt with its two variables, the inherited implement route, 2 retries, a 400k budget, fixups on and CI off');

select pg_temp.must_hold(
  (select array_agg(e.value ->> 'from' || ' -> ' || (e.value ->> 'to') || ' ' || (e.value ->> 'kind')
                    || coalesce(' ' || (e.value ->> 'label'), '') order by e.ord)
          = array[
              'issue-queued -> analyze default',
              'analyze -> effort-recheck default',
              'effort-recheck -> plan branch ≤ M ↓',
              'effort-recheck -> split branch > M ↘',
              'split -> back-to-queue default',
              'plan -> implement default',
              'implement -> build default',
              'build -> test default',
              'test -> review default',
              'review -> checks-green default',
              'checks-green -> open-pr branch pass →',
              'checks-green -> implement loop fail ↺']
     from ouroboros.workflows wf
     join ouroboros.workflow_versions v on v.workflow_id = wf.id and v.version = wf.current_version
    cross join lateral jsonb_array_elements(v.definition -> 'edges') with ordinality as e(value, ord)
    where wf.slug = 'standard-fix'),
  'and its twelve edges carry the mockup''s four labels and its three kinds — including the one dashed loop back from the gate to implement');


-- ---------------------------------------------------------------------------
-- What every stored definition has to be — the rules JSON Schema cannot state.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 19
     from ouroboros.workflow_versions v
    where v.id::text like '5eed001c-0000-4000-8000-%'
      and (select count(*) from jsonb_array_elements(v.definition -> 'nodes') as n
            where n.value ->> 'type' = 'trigger') = 1
      and (select count(*) from jsonb_array_elements(v.definition -> 'nodes') as n
            where n.value ->> 'type' = 'term') >= 1),
  'every stored definition has exactly one trigger and somewhere for a run to end');

with recursive
  doc as (select v.id, v.definition as d
            from ouroboros.workflow_versions v
           where v.id::text like '5eed001c-0000-4000-8000-%'),
  node as (select doc.id, n.value ->> 'id' as nid, n.value ->> 'type' as type
             from doc, jsonb_array_elements(doc.d -> 'nodes') as n),
  edge as (select doc.id, e.value ->> 'from' as src, e.value ->> 'to' as dst,
                  e.value ->> 'kind' as kind, e.value -> 'condition' as cond
             from doc, jsonb_array_elements(doc.d -> 'edges') as e),
  reached as (
    select node.id, node.nid from node where node.type = 'trigger'
    union
    select edge.id, edge.dst
      from reached join edge on edge.id = reached.id and edge.src = reached.nid
  )
select pg_temp.must_hold(
  (select count(*) = 0
     from node
    where not exists (select 1 from reached
                       where reached.id = node.id and reached.nid = node.nid)),
  'and every stage in every one of them is reachable from its trigger');

with doc as (select v.id, v.definition as d
               from ouroboros.workflow_versions v
              where v.id::text like '5eed001c-0000-4000-8000-%'),
     node as (select doc.id, n.value ->> 'id' as nid, n.value ->> 'type' as type
                from doc, jsonb_array_elements(doc.d -> 'nodes') as n),
     edge as (select doc.id, e.value ->> 'from' as src, e.value ->> 'to' as dst,
                     e.value ->> 'kind' as kind, e.value -> 'condition' as cond
                from doc, jsonb_array_elements(doc.d -> 'edges') as e)
select pg_temp.must_hold(
  (select count(*) = 0
     from edge
     join node as source on source.id = edge.id and source.nid = edge.src
     join node as target on target.id = edge.id and target.nid = edge.dst
    where target.type = 'trigger'
       or source.type = 'term'
       or edge.src = edge.dst
       or (edge.kind = 'branch' and edge.cond is null)
       or (edge.kind = 'default' and edge.cond is not null)),
  'nothing returns to a trigger, nothing leaves a terminal, every branch decides and no default pretends to');


-- ---------------------------------------------------------------------------
-- The rail P.4 then renders, and the one caption that is not the mockup's string.
--
-- `standard-fix` reads `12 stages`, not the mockup's `6`. #135 left that choice to this seed
-- and the seed made it: a stage is a node, the ticket asks for the twelve-node canvas, and the
-- caption is honest about the document in force. The six-stage document the mockup's string
-- was written for is v13 — see the migration's header.
-- ---------------------------------------------------------------------------
with rail as (
  select wf.slug, wf.status, wf.created_at,
         case when jsonb_typeof(v.definition -> 'nodes') = 'array'
              then jsonb_array_length(v.definition -> 'nodes') end as stage_count,
         coalesce((select array_agg(n.value -> 'config' ->> 'action')
                     from jsonb_array_elements(v.definition -> 'nodes') as n
                    where n.value ->> 'type' = 'term'
                      and n.value -> 'config' ->> 'action' is not null), '{}'::text[]) as terminals
    from ouroboros.workflows wf
    join ouroboros.organization org on org."id" = wf.organization_id
    left join ouroboros.workflow_versions v
      on v.workflow_id = wf.id and v.version = wf.current_version
   where org."slug" = 'acme-robotics' and wf.status <> 'archived'
)
select pg_temp.must_hold(
  (select array_agg(
            case when stage_count is null then 'not published'
                 else stage_count::text || ' stage' || case when stage_count = 1 then '' else 's' end end
            || coalesce(' · ' || case when status = 'paused'                        then 'paused'
                                      when 'open_pr_automerge' = any(terminals)     then 'auto-merge'
                                      when 'needs_review'      = any(terminals)     then 'needs review'
                                      when 'back_to_queue'     = any(terminals)     then 'back to queue' end,
                        '')
            order by created_at, slug)
          = array['12 stages · auto-merge',
                  '7 stages · auto-merge',
                  '5 stages · needs review',
                  '4 stages · auto-merge',
                  '5 stages · paused']
     from rail),
  'the rail reads what P.4 computes from these rows — the mockup''s four captions exactly, and 12 stages where the mockup wrote 6');

select pg_temp.must_hold(
  (select count(*) filter (where r.workflow_tag = 'standard-fix') = 22
          and count(*) = 53
          and round(count(*) filter (where r.workflow_tag = 'standard-fix') * 100.0 / count(*)) = 42
     from ouroboros.runs r
     join ouroboros.organization org on org."id" = r.organization_id
    where org."slug" = 'acme-robotics'
      and r.started_at >= now() - interval '30 days'),
  'and the page head reads *used by 42% of runs* — 22 of the dashboard seed''s 53, which is the share these two seeds earn rather than the mockup''s unreachable 61%');


-- ---------------------------------------------------------------------------
-- The dry run of `#485`, which is the acceptance criterion as a query.
--
-- The intake seed sizes `#485` as an `m`, this seed's trigger fires at `effort ≤ M`, and the
-- walk below follows every edge whose condition holds for that ticket — the effort predicates
-- against the estimate in force, the check predicates on the happy path, where everything
-- passes. What it must produce is *one* path, which is the graph being deterministic for this
-- ticket, and that path must be the expected one.
--
-- It is a walk rather than a list of nodes for a reason worth stating: an edge deleted from
-- the seeded document, or a predicate inverted, changes the path and fails here, while a
-- static list of ten ids would still pass.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select array_position(array['xs', 's', 'm', 'l', 'xl'], est.effort)
          <= array_position(array['xs', 's', 'm', 'l', 'xl'],
                            v.definition #>> '{trigger,conditions,effort_lte}')
     from ouroboros.workflows wf
     join ouroboros.workflow_versions v on v.workflow_id = wf.id and v.version = wf.current_version
     join ouroboros.organization org on org."id" = wf.organization_id
     join ouroboros.github_issues issue on issue.organization_id = org."id" and issue.number = 485
     join ouroboros.issue_estimates est on est.github_issue_id = issue.id
    where org."slug" = 'acme-robotics' and wf.slug = 'standard-fix'
    order by est.version desc
    limit 1),
  'the seeded #485 is an M, so standard-fix''s `effort ≤ M` trigger fires for it');

with recursive
  scale as (select array['xs', 's', 'm', 'l', 'xl'] as steps),
  ticket as (
    select est.effort
      from ouroboros.github_issues issue
      join ouroboros.issue_estimates est on est.github_issue_id = issue.id
      join ouroboros.organization org on org."id" = issue.organization_id
     where org."slug" = 'acme-robotics' and issue.number = 485
     order by est.version desc
     limit 1
  ),
  doc as (
    select v.definition as d
      from ouroboros.workflows wf
      join ouroboros.organization org on org."id" = wf.organization_id
      join ouroboros.workflow_versions v
        on v.workflow_id = wf.id and v.version = wf.current_version
     where org."slug" = 'acme-robotics' and wf.slug = 'standard-fix'
  ),
  node as (select n.value ->> 'id' as nid, n.value ->> 'type' as type
             from doc, jsonb_array_elements(doc.d -> 'nodes') as n),
  edge as (select e.value ->> 'from' as src, e.value ->> 'to' as dst,
                  e.value -> 'condition' as cond
             from doc, jsonb_array_elements(doc.d -> 'edges') as e),
  taken as (
    select edge.src, edge.dst
      from edge, scale, ticket
     where edge.cond is null
        or (edge.cond ->> 'kind' = 'checks' and edge.cond ->> 'op' = 'all_passed')
        or (edge.cond ->> 'kind' = 'effort'
            and case edge.cond ->> 'op'
                  when 'lt'  then array_position(scale.steps, ticket.effort)
                               <  array_position(scale.steps, edge.cond ->> 'value')
                  when 'lte' then array_position(scale.steps, ticket.effort)
                               <= array_position(scale.steps, edge.cond ->> 'value')
                  when 'eq'  then ticket.effort = edge.cond ->> 'value'
                  when 'gte' then array_position(scale.steps, ticket.effort)
                               >= array_position(scale.steps, edge.cond ->> 'value')
                  when 'gt'  then array_position(scale.steps, ticket.effort)
                               >  array_position(scale.steps, edge.cond ->> 'value')
                end)
  ),
  walk as (
    select node.nid as at, array[node.nid] as path from node where node.type = 'trigger'
    union all
    select taken.dst, walk.path || taken.dst
      from walk join taken on taken.src = walk.at
     where not (taken.dst = any(walk.path))
  )
select pg_temp.must_hold(
  (select count(*) = 1
     from walk
    where not exists (select 1 from taken where taken.src = walk.at)
      and walk.path = array['issue-queued', 'analyze', 'effort-recheck', 'plan', 'implement',
                            'build', 'test', 'review', 'checks-green', 'open-pr']),
  'and a dry run of it walks one path and the expected one — down the `≤ M` branch, through implement, build, test and review, and out of the gate to the pull request');


-- ---------------------------------------------------------------------------
-- The id convention, for the workflows seed's own rows.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 5 from ouroboros.workflows
    where id::text like '5eed001b-0000-4000-8000-%'),
  'the workflows seed created its five prefixed entities and no sixth');

select pg_temp.must_hold(
  (select count(*) = 19 from ouroboros.workflow_versions
    where id::text like '5eed001c-0000-4000-8000-%'),
  'and its nineteen prefixed versions and no twentieth');

-- ===========================================================================
-- R__dev_seed_ticket_planning.sql — mockup 09, card for card.
--
-- The ninth seed's rows (#275): fifty-two canonical tickets (`5eed001d…`), ten dependency
-- edges (`5eed001e…`), five planning epics (`5eed001f…`) and their forty-two ticket links
-- (`5eed0020…`), one draft batch (`5eed0021…`), its six drafts (`5eed0022…`) and their six
-- estimates (`5eed0023…`) — all in `acme-robotics`.
--
-- Every figure the page prints is asserted **as the aggregate that computes it**, never
-- read back out of a column, because the acceptance criterion is that nothing is stored. Where
-- the seed carries a row built to catch a nearly-right query, the nearly-right reading is
-- asserted too, so a later edit that quietly removed the trap fails here rather than in the
-- service it was set for. Exact counts, so this is the seed's idempotency test as well.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Exactly the rows the seed names, once each.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select (select count(*) from ouroboros.tickets
            where id::text like '5eed001d-0000-4000-8000-%') = 52
      and (select count(*) from ouroboros.ticket_dependencies
            where id::text like '5eed001e-0000-4000-8000-%') = 10
      and (select count(*) from ouroboros.planning_epics
            where id::text like '5eed001f-0000-4000-8000-%') = 5
      and (select count(*) from ouroboros.epic_tickets
            where id::text like '5eed0020-0000-4000-8000-%') = 42
      and (select count(*) from ouroboros.draft_batches
            where id::text like '5eed0021-0000-4000-8000-%') = 1
      and (select count(*) from ouroboros.ticket_drafts
            where id::text like '5eed0022-0000-4000-8000-%') = 6
      and (select count(*) from ouroboros.issue_estimates
            where id::text like '5eed0023-0000-4000-8000-%') = 6),
  'the planning seed wrote 52 tickets, 10 edges, 5 epics, 42 links, 1 batch, 6 drafts and 6 estimates — once');

select pg_temp.must_hold(
  (select count(*) = 52
     from ouroboros.tickets t
     join ouroboros.ticket_sources src on src.id = t.source_id
     join ouroboros.organization org on org."id" = t.organization_id
    where t.id::text like '5eed001d-0000-4000-8000-%'
      and org."slug" = 'acme-robotics'
      and src.kind = 'github'
      and src.display_name = 'GitHub · acme-robotics'),
  'every seeded ticket is acme-robotics'' and was ingested from its GitHub source');

-- Shaped as Q.3's GitHub mapping writes a row, so a real sync of the same issue upserts it.
select pg_temp.must_hold(
  (select bool_and(t.external_key = '#' || t.external_id
                   and t.external_url = 'https://github.com/acme-robotics/'
                                        || (t.meta->'github'->>'repo') || '/issues/'
                                        || t.external_id
                   and t.meta->'github'->>'owner' = 'acme-robotics'
                   and src.config->'repos' ? (t.meta->'github'->>'repo')
                   and t.source_updated_at >= t.source_created_at)
     from ouroboros.tickets t
     join ouroboros.ticket_sources src on src.id = t.source_id
    where t.id::text like '5eed001d-0000-4000-8000-%'),
  'each ticket carries GitHub''s identity, link and repository in the shape the provider maps them');

-- ---------------------------------------------------------------------------
-- Tracker Sync and Backlog Health — `42 open`, `38/42`, `4`, `6`.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 42
     from ouroboros.tickets t
     join ouroboros.ticket_sources src on src.id = t.source_id
     join ouroboros.organization org on org."id" = t.organization_id
    where org."slug" = 'acme-robotics'
      and src.kind = 'github'
      and t.state = 'open'),
  'the GitHub source holds 42 open tickets — the sync row''s count and the health card''s tag');

select pg_temp.must_hold(
  (select count(*) filter (where t.sizing_status = 'sized') = 38 and count(*) = 42
     from ouroboros.tickets t
     join ouroboros.organization org on org."id" = t.organization_id
    where org."slug" = 'acme-robotics'
      and t.state = 'open'),
  'Sized computes to 38 of 42 open tickets');

select pg_temp.must_hold(
  (select count(*) filter (where t.sizing_status = 'sized') = 48 and count(*) = 52
     from ouroboros.tickets t
     join ouroboros.organization org on org."id" = t.organization_id
    where org."slug" = 'acme-robotics'),
  'and 48 of 52 when the closed tickets are not excluded, so forgetting the state is visible');

select pg_temp.must_hold(
  (select count(distinct blocked.id) = 4
     from ouroboros.ticket_dependencies dep
     join ouroboros.tickets blocked on blocked.id = dep.blocked_ticket_id
     join ouroboros.tickets blocker on blocker.id = dep.blocker_ticket_id
     join ouroboros.organization org on org."id" = dep.organization_id
    where org."slug" = 'acme-robotics'
      and blocked.state = 'open'
      and blocker.state = 'open'),
  'Blocked computes to 4 — open tickets with an open blocker, over both origins');

select pg_temp.must_hold(
  (select count(*) = 6
          and count(distinct dep.blocked_ticket_id) filter (where dep.origin = 'planned') = 3
          and count(*) filter (where dep.origin = 'synced') = 2
          and count(*) filter (where blocker.state = 'closed') = 1
     from ouroboros.ticket_dependencies dep
     join ouroboros.tickets blocker on blocker.id = dep.blocker_ticket_id
     join ouroboros.organization org on org."id" = dep.organization_id
    where org."slug" = 'acme-robotics'
      and dep.blocked_ticket_id is not null),
  'and the edges carry the traps: six edges, two synced, one resolved by a closed blocker, one ticket blocked twice');

select pg_temp.must_hold(
  (select count(*) filter (where t.state = 'open') = 6 and count(*) = 14
     from ouroboros.tickets t
     join ouroboros.organization org on org."id" = t.organization_id
    where org."slug" = 'acme-robotics'
      and t.source_updated_at < now() - interval '30 days'),
  'Stale > 30d computes to 6 open tickets, and to 14 if the closed ones are not excluded');

select pg_temp.must_hold(
  (select count(*) = 1
     from ouroboros.tickets t
     join ouroboros.organization org on org."id" = t.organization_id
    where org."slug" = 'acme-robotics'
      and t.state = 'open'
      and t.source_updated_at between now() - interval '30 days' and now() - interval '25 days'),
  'and one open ticket sits just inside the threshold, the near miss on the other side of it');

-- ---------------------------------------------------------------------------
-- The roadmap — five lanes, their chips, and a TODAY that lands in the second column.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select array_agg(p.name || '|' || p.tint || '|' || p.status || '|'
                    || p.ticket_count || '|' || p.done_count order by p.sort_order)
          = array['OTA hardening|accent|active|12|8',
                  'BLE provisioning v2|model|active|9|2',
                  'Motor control refactor|warn|active|14|0',
                  'Fleet telemetry dashboard|ok|active|7|0',
                  'Zephyr 4.2 migration|neutral|proposed|0|0']
     from ouroboros.planning_epic_progress p
     join ouroboros.organization org on org."id" = p.organization_id
    where org."slug" = 'acme-robotics'),
  'the five lanes compute the mockup''s chips — 12·8, 9·2, 14·0, 7·0 and the unscoped Zephyr lane');

select pg_temp.must_hold(
  (select bool_and(case e.sort_order
                     when 5 then e.start_month is null and e.end_month is null
                     else e.start_month = (date_trunc('month', now())
                                           + make_interval(months => e.sort_order - 2))::date
                      and e.end_month   = (date_trunc('month', now())
                                           + make_interval(months => e.sort_order))::date
                   end)
          and min(e.start_month) = (date_trunc('month', now()) - interval '1 month')::date
          and bool_and(e.roadmap_name = 'Helios 2.1')
     from ouroboros.planning_epics e
     join ouroboros.organization org on org."id" = e.organization_id
    where org."slug" = 'acme-robotics'),
  'lane months are offsets from the current month, which is always the gantt''s second column — so TODAY never rots');

select pg_temp.must_hold(
  (select bool_and(e.roadmap_window
                   = 'Q' || extract(quarter from min_start)
                     || case when extract(year from min_start) = extract(year from max_end)
                             then '' else ' ' || extract(year from min_start) end
                     || '–Q' || extract(quarter from max_end) || ' ' || extract(year from max_end))
     from ouroboros.planning_epics e
     join ouroboros.organization org on org."id" = e.organization_id
     cross join (select min(start_month) as min_start, max(end_month) as max_end
                   from ouroboros.planning_epics x
                   join ouroboros.organization o on o."id" = x.organization_id
                  where o."slug" = 'acme-robotics') span
    where org."slug" = 'acme-robotics'),
  'and the roadmap''s window tag names the quarters the lanes actually span');

select pg_temp.must_hold(
  (select count(*) = 10
     from ouroboros.tickets t
     join ouroboros.organization org on org."id" = t.organization_id
    where org."slug" = 'acme-robotics'
      and t.id::text like '5eed001d-0000-4000-8000-%'
      and not exists (select 1 from ouroboros.epic_tickets et where et.ticket_id = t.id)),
  'ten open tickets belong to no lane, so a chip counted over the source instead of the links is wrong');

-- ---------------------------------------------------------------------------
-- Generate Tickets — the OTA batch, `✓ all sized`, `~3 days`, `$14`.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select b.planner = 'outline-v0'
          and b.status = 'sized'
          and b.target_milestone = 'Helios 2.1'
          and b.auto_size and not b.queue_small
          and src.kind = 'github'
          and epic.name = 'OTA hardening'
          and b.source_prompt like 'We need OTA updates to survive power loss mid-flash:%'
     from ouroboros.draft_batches b
     join ouroboros.organization org on org."id" = b.organization_id
     join ouroboros.ticket_sources src on src.id = b.target_source_id
     join ouroboros.planning_epics epic on epic.id = b.epic_id
    where org."slug" = 'acme-robotics'),
  'the batch is outline-v0''s, sized, bound for GitHub and Helios 2.1, in the OTA hardening lane');

select pg_temp.must_hold(
  (select array_agg(d.local_key || '|' || upper(e.effort) || '|' || d.suggested_workflow || '|'
                    || coalesce(notes.blocks, '') order by d.local_key)
          = array['OTA-1|L|feature-loop|blocks OTA-3',
                  'OTA-2|M|feature-loop|blocks OTA-3',
                  'OTA-3|L|feature-loop|blocks OTA-5',
                  'OTA-4|M|feature-loop|blocks OTA-5',
                  'OTA-5|M|hil-verify|',
                  'OTA-6|XS|docs-loop|']
     from ouroboros.ticket_drafts d
     join ouroboros.draft_batches b on b.id = d.batch_id
     join ouroboros.organization org on org."id" = b.organization_id
     join lateral (select ie.effort from ouroboros.issue_estimates ie
                    where ie.draft_id = d.id order by ie.version desc limit 1) e on true
     left join lateral (select 'blocks ' || string_agg(blocked.local_key, ', '
                                                       order by blocked.local_key) as blocks
                          from ouroboros.ticket_dependencies dep
                          join ouroboros.ticket_drafts blocked on blocked.id = dep.blocked_draft_id
                         where dep.blocker_draft_id = d.id) notes on true
    where org."slug" = 'acme-robotics'),
  'the six drafts render the mockup''s keys, effort chips, workflow tags and dependency notes');

select pg_temp.must_hold(
  (select bool_and(d.selected and d.push_state = 'pending' and d.provenance = 'planned'
                   and exists (select 1 from ouroboros.issue_estimates ie
                                where ie.draft_id = d.id
                                  and ie.github_issue_id is null
                                  and ie.trace->>'estimator' = 'heuristic-v0'
                                  and ie.trace->'signals' = '[]'::jsonb))
          and count(*) = 6
     from ouroboros.ticket_drafts d
     join ouroboros.draft_batches b on b.id = d.batch_id
     join ouroboros.organization org on org."id" = b.organization_id
    where org."slug" = 'acme-robotics'),
  'every draft is selected, pending and sized through issue_estimates.draft_id — so the pill reads all sized');

select pg_temp.must_hold(
  (select sum((e.breakdown->>'est_minutes')::numeric) / (24 * 60) = 3
     from ouroboros.ticket_drafts d
     join ouroboros.draft_batches b on b.id = d.batch_id
     join ouroboros.organization org on org."id" = b.organization_id
     join lateral (select ie.breakdown from ouroboros.issue_estimates ie
                    where ie.draft_id = d.id order by ie.version desc limit 1) e on true
    where org."slug" = 'acme-robotics'
      and d.selected),
  'the drafts'' est_minutes sum to three loop-days');

-- The `$` the way AL.4's repository prices it: the routed model's connection kind through the
-- workspace's aliases, then `model_price()` — a token rate at its input rate, free as zero.
select pg_temp.must_hold(
  (select count(*) = 6
          and count(p.billing_mode) = 6
          and round(sum(case p.billing_mode
                          when 'token' then (e.breakdown->>'est_tokens')::numeric
                                            * p.input_cents_per_1m / 1000000
                          when 'free'  then 0
                        end)) = 1400
     from ouroboros.ticket_drafts d
     join ouroboros.draft_batches b on b.id = d.batch_id
     join ouroboros.organization org on org."id" = b.organization_id
     join lateral (select ie.breakdown, ie.routed_model from ouroboros.issue_estimates ie
                    where ie.draft_id = d.id order by ie.version desc limit 1) e on true
     left join lateral (select c.kind
                          from ouroboros.model_aliases a
                          join ouroboros.provider_connections c
                            on c.id = a.provider_connection_id
                           and c.organization_id = a.organization_id
                         where a.organization_id = b.organization_id
                           and a.model_id = e.routed_model
                         order by a.alias
                         limit 1) k on true
     left join lateral ouroboros.model_price(b.organization_id, k.kind, e.routed_model) p on true
    where org."slug" = 'acme-robotics'
      and d.selected
      and (p.billing_mode is null or p.billing_mode in ('token', 'free'))),
  'every draft is priced by a seeded rate, and the priced subtotal is 1400 cents — the footer''s $14');

-- ---------------------------------------------------------------------------
-- No collision with the intake mirror or the dashboard's queue and runs.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select not exists (select 1
                        from ouroboros.tickets t
                       where t.id::text like '5eed001d-0000-4000-8000-%'
                         and (t.external_id::integer in (select number from ouroboros.github_issues)
                              or t.external_id::integer in (select issue_number from ouroboros.runs)
                              or t.external_id::integer in (select issue_number
                                                              from ouroboros.queue_items))))
      and (select count(*) = 9 from ouroboros.github_issues
            where id::text like '5eed0018-0000-4000-8000-%'),
  'no canonical ticket reuses an issue number the intake or dashboard seeds use, and the intake mirror still holds its nine');

-- ---------------------------------------------------------------------------
-- The personal workspace is empty, and so is acme-labs.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select not exists (select 1 from ouroboros.tickets t
                        join ouroboros.organization o on o."id" = t.organization_id
                       where o."slug" in ('kensuenobu', 'acme-labs'))
      and not exists (select 1 from ouroboros.ticket_sources s
                        join ouroboros.organization o on o."id" = s.organization_id
                       where o."slug" in ('kensuenobu', 'acme-labs'))
      and not exists (select 1 from ouroboros.planning_epics e
                        join ouroboros.organization o on o."id" = e.organization_id
                       where o."slug" in ('kensuenobu', 'acme-labs'))
      and not exists (select 1 from ouroboros.draft_batches b
                        join ouroboros.organization o on o."id" = b.organization_id
                       where o."slug" in ('kensuenobu', 'acme-labs'))
      and not exists (select 1 from ouroboros.ticket_dependencies d
                        join ouroboros.organization o on o."id" = d.organization_id
                       where o."slug" in ('kensuenobu', 'acme-labs'))),
  'the personal workspace has no source, ticket, lane, batch or edge — AM.5''s guidance path, with no $ to show');

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.epic_mirrors),
  'and nothing has been pushed, so no epic has a tracker mirror');


-- ===========================================================================
-- R__dev_seed_farm.sql — mockup 08's build farm (#249)
-- ===========================================================================
--
-- The tenth seed, and the one whose rows are *live entities*: a `runners` row claims a
-- machine somewhere is heartbeating. Every figure mockup 08 prints is asserted here as the
-- aggregate it is, and each one is asked in a form that a nearly-right query gets wrong —
-- the near misses are asserted too, because a fixture that stopped distinguishing them would
-- leave every figure below passing for the wrong reason.

-- --- the fleet, the pools, and the sixth runner that is not in either count ------
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.runner_pools p
     join ouroboros.organization o on o."id" = p.organization_id
    where o."slug" = 'acme-robotics')
   and (select count(*) = 5 from ouroboros.runners r
          join ouroboros.organization o on o."id" = r.organization_id
         where o."slug" = 'acme-robotics' and r.status <> 'removed'),
  'the head reads "5 runners. 2 pools." — both counted, neither stored');

select pg_temp.must_hold(
  (select count(*) = 6 from ouroboros.runners r
     join ouroboros.organization o on o."id" = r.organization_id
    where o."slug" = 'acme-robotics'),
  'and forge-00 is the sixth: a count that forgets to exclude `removed` reads 6');

select pg_temp.must_hold(
  (select count(*) = 4 from ouroboros.runners r
     join ouroboros.organization o on o."id" = r.organization_id
    where o."slug" = 'acme-robotics' and r.status not in ('offline', 'removed')),
  'the stat row reads 4/5 online, which is every runner the fleet can currently reach');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.runners r
     join ouroboros.organization o on o."id" = r.organization_id
    where o."slug" = 'acme-robotics' and r.status = 'building'),
  'and the RUNNERS card''s pill reads "1 building"');

select pg_temp.must_hold(
  (select round(extract(epoch from now() - r.last_seen_at) / 3600) = 2
     from ouroboros.runners r
     join ouroboros.organization o on o."id" = r.organization_id
    where o."slug" = 'acme-robotics' and r.name = 'forge-03'),
  'forge-03 was last seen two hours ago, which is what "offline · 2h" is computed from');

-- #262: a seeded runner has no agent heartbeating for it, so on a running stack the presence
-- sweep would call all four live ones offline half a minute after boot. Their stamp is a day
-- ahead, which no sweep reaches; the two the sweep never looks at keep their real ages.
select pg_temp.must_hold(
  (select count(*) = 4 and bool_and(r.last_seen_at > now() + interval '23 hours')
     from ouroboros.runners r
     join ouroboros.organization o on o."id" = r.organization_id
    where o."slug" = 'acme-robotics' and r.status in ('online', 'building', 'draining')),
  'the four live runners'' last heartbeat is dated a day ahead, so a presence sweep leaves the fixture alone');

select pg_temp.must_hold(
  (select count(*) = 2 and bool_and(r.last_seen_at < now())
     from ouroboros.runners r
     join ouroboros.organization o on o."id" = r.organization_id
    where o."slug" = 'acme-robotics' and r.status in ('offline', 'removed')),
  'and the offline and the removed runner keep a last heartbeat in the past, which is what their ages are read from');

select pg_temp.must_hold(
  (select telemetry = '{}'::jsonb and uptime_seconds is null
     from ouroboros.runners r
     join ouroboros.organization o on o."id" = r.organization_id
    where o."slug" = 'acme-robotics' and r.name = 'forge-03'),
  'and it carries no snapshot and no uptime, so its row prints the mockup''s dashes');

-- Three runners in pool-a and two in pool-b — the pool card's meta lines — which is also
-- where the removed runner is: counted, pool-a would read four.
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.runners r
     join ouroboros.runner_pools p on p.id = r.pool_id
     join ouroboros.organization o on o."id" = p.organization_id
    where o."slug" = 'acme-robotics' and p.name = 'pool-a' and r.status <> 'removed')
   and (select count(*) = 2 from ouroboros.runners r
          join ouroboros.runner_pools p on p.id = r.pool_id
          join ouroboros.organization o on o."id" = p.organization_id
         where o."slug" = 'acme-robotics' and p.name = 'pool-b' and r.status <> 'removed'),
  'the pools card reads "3 runners" and "2 runners", counted the same way the head is');

-- --- the executor worlds, and the degraded connection ---------------------------
select pg_temp.must_hold(
  (select executor = 'container' and image is not null and autoscale_pref ->> 'enabled' = 'false'
     from ouroboros.runner_pools p
     join ouroboros.organization o on o."id" = p.organization_id
    where o."slug" = 'acme-robotics' and p.name = 'pool-a')
   and (select executor = 'shell' and image is null and tags @> '["hil"]'::jsonb
          from ouroboros.runner_pools p
          join ouroboros.organization o on o."id" = p.organization_id
         where o."slug" = 'acme-robotics' and p.name = 'pool-b'),
  'pool-a is a container world with a pinned image and an auto-scale preference that is off (B9); pool-b is a shell world tagged hil (#776)');

-- AH.4's (#252) fallback: pool-a's builds are all one command, which is its default and what
-- AI.5's (#260) submit dialog prefills; pool-b runs two kinds of job and has none, so a
-- submission there has to name its command.
select pg_temp.must_hold(
  (select default_command = 'west build -b helios_mainboard app'
     from ouroboros.runner_pools p
     join ouroboros.organization o on o."id" = p.organization_id
    where o."slug" = 'acme-robotics' and p.name = 'pool-a')
   and (select default_command is null
          from ouroboros.runner_pools p
          join ouroboros.organization o on o."id" = p.organization_id
         where o."slug" = 'acme-robotics' and p.name = 'pool-b'),
  'pool-a defaults to its one build command; pool-b, which runs two kinds of job, has no default');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.runners r
     join ouroboros.organization o on o."id" = r.organization_id
    where o."slug" = 'acme-robotics'
      and r.security_mode = 'bearer_fallback' and r.cert_serial is null and r.name = 'anvil-mac'
      and r.bearer_sealed like 'ouro.v1.%'),
  'anvil-mac fell back to a bearer token, which AI.2 (#257) has a row to render as degraded — and the fallback carries its own sealed secret (#250)');

-- --- the farm CA, and the certificates the fleet is holding (#250) ---------------
--
-- One authority per workspace; its key sealed, because every secret in this schema is. The
-- certificate rows pair with `runners.cert_serial` in both directions — an mTLS runner has one
-- and a fallback runner has none — which is the pairing V041's live index makes unambiguous.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.farm_authorities a
     join ouroboros.organization o on o."id" = a.organization_id
    where o."slug" = 'acme-robotics'
      and a.key_sealed like 'ouro.v1.%'
      and a.certificate_pem like '-----BEGIN CERTIFICATE-----%'
      and a.not_after > now()),
  'the workspace has one farm CA, its key sealed and its certificate live');

select pg_temp.must_hold(
  (select count(*) = 5 from ouroboros.runner_certificates c
     join ouroboros.organization o on o."id" = c.organization_id
    where o."slug" = 'acme-robotics')
   and (select count(*) = 1 from ouroboros.runner_certificates c
          join ouroboros.organization o on o."id" = c.organization_id
         where o."slug" = 'acme-robotics' and c.revoked
           and c.revoked_at is not null and c.revocation_reason = 'runner_removed'),
  'five certificates for the five mTLS runners, one of them revoked because its runner was removed');

select pg_temp.must_hold(
  (select bool_and(exists (select 1 from ouroboros.runner_certificates c
                            where c.runner_id = r.id and c.serial = r.cert_serial))
     from ouroboros.runners r
     join ouroboros.organization o on o."id" = r.organization_id
    where o."slug" = 'acme-robotics' and r.security_mode = 'mtls'),
  'and every mTLS runner''s cert_serial names a certificate that was actually issued — the pointer V041 deliberately does not spell as a foreign key');

-- --- the enrollment tokens ------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.enrollment_tokens t
     join ouroboros.organization o on o."id" = t.organization_id
    where o."slug" = 'acme-robotics')
   and (select count(*) = 1 from ouroboros.enrollment_tokens t
          join ouroboros.organization o on o."id" = t.organization_id
         where o."slug" = 'acme-robotics' and t.revoked and t.revoked_at is not null)
   and (select bool_and(t.token_sealed like 'ouro.v1.%' and t.expires_at > t.created_at)
          from ouroboros.enrollment_tokens t
          join ouroboros.organization o on o."id" = t.organization_id
         where o."slug" = 'acme-robotics'),
  'two enrollment tokens, one revoked, both sealed envelopes with a positive TTL');

-- --- the stat row, every number of it -------------------------------------------
--
-- One partition of today's terminal jobs answers the card's headline and its three-part
-- delta, which is why the three numbers add up: they are one `group by`, not three queries.
select pg_temp.must_hold(
  (with today as (
     select j.status from ouroboros.build_jobs j
       join ouroboros.organization o on o."id" = j.organization_id
      where o."slug" = 'acme-robotics'
        and j.status in ('succeeded', 'failed', 'retried', 'canceled')
        and j.finished_at >= date_trunc('day', now()))
   select count(*) = 23
      and count(*) filter (where status = 'succeeded') = 19
      and count(*) filter (where status = 'retried')   = 3
      and count(*) filter (where status = 'failed')    = 1
     from today),
  'Builds today reads 23, and 19 clean · 3 retried · 1 failed partitions it');

select pg_temp.must_hold(
  (select count(*) = 28 from ouroboros.build_jobs j
     join ouroboros.organization o on o."id" = j.organization_id
    where o."slug" = 'acme-robotics' and j.queued_at >= date_trunc('day', now())),
  'and the two running and three queued jobs are the near miss: counted by queued_at it reads 28');

select pg_temp.must_hold(
  (select count(*) = 43 from ouroboros.build_jobs j
     join ouroboros.organization o on o."id" = j.organization_id
    where o."slug" = 'acme-robotics' and j.finished_at is not null),
  'and the prior week''s twenty are the other one: without the day window it reads 43');

-- Each retried attempt has a successor among the nineteen, so a retry is one failure and one
-- success rather than two of either.
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.build_jobs retry
     join ouroboros.build_jobs original on original.id = retry.retry_of
     join ouroboros.organization o on o."id" = retry.organization_id
    where o."slug" = 'acme-robotics'
      and original.status = 'retried' and retry.status = 'succeeded'
      and retry.finished_at >= date_trunc('day', now())),
  'each of today''s three retried attempts has the successful attempt that replaced it');

select pg_temp.must_hold(
  (select round(extract(epoch from avg(j.finished_at - j.started_at))) = 252
     from ouroboros.build_jobs j
     join ouroboros.organization o on o."id" = j.organization_id
    where o."slug" = 'acme-robotics'
      and j.status in ('succeeded', 'failed', 'retried', 'canceled')
      and j.finished_at >= date_trunc('day', now())),
  'Avg build time is 252 seconds, which the card prints as 4m 12s');

select pg_temp.must_hold(
  (select round(extract(epoch from avg(j.finished_at - j.started_at))) = 290
     from ouroboros.build_jobs j
     join ouroboros.organization o on o."id" = j.organization_id
    where o."slug" = 'acme-robotics'
      and j.finished_at <  date_trunc('day', now())
      and j.finished_at >= date_trunc('day', now()) - interval '7 days'),
  'and the prior week''s is 290, so the delta the card prints is 38 seconds down');

-- --- the cache rate, weighted, and null is not zero ------------------------------
select pg_temp.must_hold(
  (select round(100.0 * sum((j.ccache_stats ->> 'hits')::numeric)
              / sum((j.ccache_stats ->> 'hits')::numeric
                    + (j.ccache_stats ->> 'misses')::numeric)) = 78
     from ouroboros.build_jobs j
     join ouroboros.organization o on o."id" = j.organization_id
    where o."slug" = 'acme-robotics'
      and j.ccache_stats is not null
      and j.finished_at >= date_trunc('day', now())),
  'Cache hit rate is 78% — Σ hits over Σ objects across today''s jobs that measured any');

select pg_temp.must_hold(
  (select count(*) = 7 from ouroboros.build_jobs j
     join ouroboros.organization o on o."id" = j.organization_id
    where o."slug" = 'acme-robotics'
      and j.ccache_stats is null
      and j.status in ('succeeded', 'failed', 'retried', 'canceled')
      and j.finished_at >= date_trunc('day', now())),
  'seven of today''s twenty-three measured no cache at all, and null is not zero (B5)');

select pg_temp.must_hold(
  (select round(100.0 * sum((j.ccache_stats ->> 'hits')::numeric)
              / sum((j.ccache_stats ->> 'hits')::numeric
                    + (j.ccache_stats ->> 'misses')::numeric)) = 74
     from ouroboros.build_jobs j
     join ouroboros.organization o on o."id" = j.organization_id
    where o."slug" = 'acme-robotics'
      and j.ccache_stats is not null and j.finished_at is not null),
  'and the prior week''s builds are the near miss: without the day window the rate reads 74%');

-- --- the queue chips, and what is in flight -------------------------------------
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.build_jobs j
     join ouroboros.runners r on r.id = j.runner_id
    where r.name = 'forge-01' and j.status in ('queued', 'offered'))
   and (select count(*) = 1 from ouroboros.build_jobs j
          join ouroboros.runners r on r.id = j.runner_id
         where r.name = 'bigiron' and j.status in ('queued', 'offered')),
  'the runners table reads q:2 on forge-01 and q:1 on bigiron, counted from the queue itself');

select pg_temp.must_hold(
  (select bool_and((r.telemetry ->> 'queue_depth')::int = q.depth)
     from ouroboros.runners r
     join ouroboros.organization o on o."id" = r.organization_id
     join lateral (select count(*) as depth from ouroboros.build_jobs j
                    where j.runner_id = r.id and j.status in ('queued', 'offered')) q on true
    where o."slug" = 'acme-robotics' and r.telemetry ? 'queue_depth'),
  'and every heartbeat''s queue_depth agrees with the rows behind it');

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.build_jobs j
     join ouroboros.organization o on o."id" = j.organization_id
    where o."slug" = 'acme-robotics' and j.status = 'running'),
  'two builds are running — forge-01''s #479 and the sweep a draining bigiron is finishing');

-- --- run_id is null on every row, which is decision B6 in the data ---------------
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.build_jobs j
     join ouroboros.organization o on o."id" = j.organization_id
    where o."slug" = 'acme-robotics' and j.run_id is not null),
  'no seeded job is attributed to a loop run: AJ.3 (#265) is what fills run_id in (B6)');

-- --- the live log, and the row it has to agree with ------------------------------
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.build_log_chunks c
     join ouroboros.build_jobs j on j.id = c.job_id
     join ouroboros.organization o on o."id" = j.organization_id
    where o."slug" = 'acme-robotics' and j.number = 479)
   and (select count(*) = 5 from ouroboros.build_log_chunks c
          join ouroboros.build_jobs j on j.id = c.job_id
          join ouroboros.organization o on o."id" = j.organization_id
         where o."slug" = 'acme-robotics'),
  'the LIVE card''s listing is three chunks of #479, of five in the whole seed');

select pg_temp.must_hold(
  (select (j.ccache_stats ->> 'hits')::int = 412
      and (j.ccache_stats ->> 'misses')::int = 113
      and convert_from(c.content, 'UTF8') like '%(412/525 objects)%'
     from ouroboros.build_jobs j
     join ouroboros.build_log_chunks c on c.job_id = j.id and c.seq = 1
     join ouroboros.organization o on o."id" = j.organization_id
    where o."slug" = 'acme-robotics' and j.number = 479),
  'and the log''s ccache line and the job''s ccache_stats tell the same story about one build');

-- The cap trigger's arithmetic, as the seed leaves it: the offsets are contiguous, the job's
-- running total is the sum of its chunks, and nothing was elided.
select pg_temp.must_hold(
  (select bool_and(agreed) from (
     select j.log_bytes = sum(octet_length(c.content))
        and min(c.byte_start) = 0
        and j.log_dropped_bytes = 0
        and j.log_truncated_at is null as agreed
       from ouroboros.build_jobs j
       join ouroboros.build_log_chunks c on c.job_id = j.id
       join ouroboros.organization o on o."id" = j.organization_id
      where o."slug" = 'acme-robotics'
      group by j.id, j.log_bytes, j.log_dropped_bytes, j.log_truncated_at) totals),
  'each logged job''s running total is the sum of its own chunks, and no seeded log was truncated');

-- #262: the trigger assigns byte_start in the order rows reach it, so the seed's insert is
-- ordered. Unordered, PostgreSQL 17 stored #479 as 3, 2, 1 and the LIVE card read backwards.
select pg_temp.must_hold(
  (select bool_and(in_order) from (
     select c.byte_start = coalesce(sum(octet_length(c.content)) over (
              partition by c.job_id order by c.seq
              rows between unbounded preceding and 1 preceding), 0) as in_order
       from ouroboros.build_log_chunks c
       join ouroboros.build_jobs j on j.id = c.job_id
       join ouroboros.organization o on o."id" = j.organization_id
      where o."slug" = 'acme-robotics') offsets),
  'every seeded chunk starts where the chunks before it in seq order end, so a log reads in the order it was printed');

-- --- the pool-assignment window (#514) -------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.runner_pool_windows w
     join ouroboros.organization o on o."id" = w.organization_id
    where o."slug" = 'acme-robotics'
      and w.days_of_week = '[1, 2, 3, 4, 5]'::jsonb
      and w.starts_at = '14:00'::time and w.ends_at = '16:00'::time),
  'one time-windowed pool assignment exists, so #514''s capability has a fixture to read');

-- --- the whole seed belongs to one workspace, and the others are empty ------------
select pg_temp.must_hold(
  (select count(*) = 48 from ouroboros.build_jobs j
     join ouroboros.organization o on o."id" = j.organization_id
    where o."slug" = 'acme-robotics'),
  'forty-eight build jobs in all — twenty last week, twenty-three today, five in flight');

select pg_temp.must_hold(
  (select not exists (select 1 from ouroboros.runner_pools p
                        join ouroboros.organization o on o."id" = p.organization_id
                       where o."slug" in ('kensuenobu', 'acme-labs'))
      and not exists (select 1 from ouroboros.runners r
                        join ouroboros.organization o on o."id" = r.organization_id
                       where o."slug" in ('kensuenobu', 'acme-labs'))
      and not exists (select 1 from ouroboros.build_jobs j
                        join ouroboros.organization o on o."id" = j.organization_id
                       where o."slug" in ('kensuenobu', 'acme-labs'))
      and not exists (select 1 from ouroboros.enrollment_tokens t
                        join ouroboros.organization o on o."id" = t.organization_id
                       where o."slug" in ('kensuenobu', 'acme-labs'))),
  'the personal workspace has no pool, runner, job or token — AI.7''s (#262) guidance path');

\o
\echo 'seed.sql: all assertions passed'
