-- seed.sql — what the development seeds put in the database, as assertions.
--
-- The other half of the seeds' tests. tests/seed.test.sh reads the two migrations and the
-- two configuration files and asserts the properties that make them safe — guarded,
-- idempotent, deterministic. This asserts the one thing a file read cannot: that
-- applying them to a real PostgreSQL produces exactly the demo content every mockup, and
-- every e2e test written against it, expects to find — mockup 01 Step 2's three
-- organizations and mockup 02's dashboard, number for number.
--
-- Two migrations, one suite, because they describe one database: R__dev_seed.sql (#23) is
-- *who exists* and R__dev_seed_dashboard.sql (#68) is *what the loop has done*, and a
-- dashboard assertion that could not name `acme-robotics` would be asserting nothing.
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
-- the dashboard read-model — mockup 02, number for number — by #68.

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

\o
\echo 'seed.sql: all assertions passed'
