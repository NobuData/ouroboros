-- seed.sql — what the development seeds put in the database, as assertions.
--
-- The other half of the seeds' tests. tests/seed.test.sh reads the two migrations and the
-- two configuration files and asserts the properties that make them safe — guarded,
-- idempotent, deterministic. This asserts the one thing a file read cannot: that
-- applying them to a real PostgreSQL produces exactly the demo content every mockup, and
-- every e2e test written against it, expects to find — mockup 01 Step 2's three
-- organizations and mockup 02's dashboard, number for number.
--
-- Three migrations, one suite, because they describe one database: R__dev_seed.sql (#23)
-- is *who exists*, R__dev_seed_dashboard.sql (#68) is *what the loop has done*, and
-- R__dev_seed_providers.sql (#221) is *what it is allowed to call* — and a dashboard
-- assertion that could not name `acme-robotics` would be asserting nothing. The last two
-- share a table: a provider card's monthly meter is the dashboard seed's spend of today
-- plus the providers seed's spend of earlier this month, so the figures below are asserted
-- over the sum rather than over either file's rows.
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
-- the dashboard read-model — mockup 02, number for number — by #68, and with mockup 07's
-- five provider cards by #221.

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
-- upstream failure to (#216), and the detail is the sentence its foot prints.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.provider_connections conn
    where conn.id = '5eed000c-0000-4000-8000-000000000003'
      and conn.kind = 'copilot'
      and conn.display_name = 'GitHub Copilot'
      and conn.status = 'error'
      and conn.enabled
      and conn.monthly_cap_cents = 9500
      and conn.health ->> 'detail' = '503 upstream · retrying'
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

-- The two zero meters, and they are zero for different reasons. Ollama has spent 2.1M
-- tokens that nobody priced — `$0.00 · 2.1M tokens on-box` — and vLLM has no rows at all,
-- which is what *no metered spend* means: an absence rather than a row claiming a call
-- that cost nothing.
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
  (select count(*) = 0 from ouroboros.token_usage usage
     join ouroboros.organization org on org."id" = usage.organization_id
    where org."slug" = 'acme-robotics'
      and usage.provider = 'openai_compatible'),
  'the local vLLM connection has no usage rows at all, which is what "no metered spend" means');

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

\o
\echo 'seed.sql: all assertions passed'
