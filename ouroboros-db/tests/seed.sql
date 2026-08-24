-- seed.sql — what the development seeds put in the database, as assertions.
--
-- The other half of the seeds' tests. tests/seed.test.sh reads the two migrations and the
-- two configuration files and asserts the properties that make them safe — guarded,
-- idempotent, deterministic. This asserts the one thing a file read cannot: that
-- applying them to a real PostgreSQL produces exactly the demo content every mockup, and
-- every e2e test written against it, expects to find — mockup 01 Step 2's three
-- organizations and mockup 02's dashboard, number for number.
--
-- Five migrations, one suite, because they describe one database: R__dev_seed.sql (#23)
-- is *who exists*, R__dev_seed_dashboard.sql (#68) is *what the loop has done*,
-- R__dev_seed_providers.sql (#221) is *what it is allowed to call*,
-- R__dev_seed_routing.sql (#192) is *where the calls go*, and R__dev_seed_audit.sql (#225)
-- is *who touched the keys* — and a dashboard assertion that could not name `acme-robotics`
-- would be asserting nothing. Two of them share a table: a provider card's monthly meter is
-- the dashboard seed's spend of today plus the providers seed's spend of earlier this month,
-- so the figures below are asserted over the sum rather than over either file's rows.
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
-- five provider cards by #221, and with the credential trail behind that page's **Audit
-- log** button by #225.

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
-- The seven aliases, and what each resolves to.
--
-- The matrix's pills and their grey resolution lines — `coder-max` → `claude-fable-5 ·
-- Anthropic`. Asserted through the join rather than against `model_id` alone, because the
-- line prints both halves and decision M1's whole point is that the second half lives in
-- exactly one place.
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
  'the seven aliases resolve to the models and connections the matrix prints under them');

-- `second-opinion` is the one with a restriction, and it is the one the review escalation
-- rule adds as a vote — which is exactly what `review_vote_only` says this workspace allows
-- it to be used for (V019, decision R3).
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.model_aliases alias
     join ouroboros.organization org on org."id" = alias.organization_id
    where org."slug" = 'acme-robotics'
      and alias.alias = 'second-opinion'
      and alias.restrictions = '{"review_vote_only": true}'::jsonb),
  'second-opinion is restricted to review votes, which is the only thing a rule uses it for');

-- Nothing else is restricted and nothing carries params: the mockup's *"(max thinking)"*
-- belongs to the rule that applies it, and seeding it onto the alias would make that rule a
-- no-op that appears to work.
select pg_temp.must_hold(
  (select count(*) = 6 from ouroboros.model_aliases alias
     join ouroboros.organization org on org."id" = alias.organization_id
    where org."slug" = 'acme-robotics'
      and alias.params = '{}'::jsonb
      and alias.restrictions = '{}'::jsonb),
  'the other six aliases carry no params and no restrictions, which is the ordinary state');

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
   ) as routing_rows),
  'neither the personal workspace nor acme-labs has an alias, a kind, a route, a hop or a rule');

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

-- ---------------------------------------------------------------------------
-- `Used by`, computed out of these rows and stored in none of them (#581).
--
-- CG.3's `alias_references` is the one definition mockup 21's count column, chip list and
-- delete guard all read (decision **R5**), and the seed is where it meets rows somebody
-- else wrote. `coder-max` is the assertion the ticket names: the inspector draws four chips
-- beside it, and three of them are routes whose chains this file seeds while the fourth is
-- the escalation rule that names it. Nothing stores that four.
--
-- **The numbers below are Y.4's seven aliases, not mockup 21's eight rows.** The registry
-- screen is drawn around a superset — it adds the unbound `gpt5-experiments`, and its
-- drawn counts belong to that state — and reconciling the two is CG.4's (#582), which this
-- ticket blocks. What is asserted here is that the count is *computed from the seed that
-- exists*, so the day CG.4 changes the seed these lines move with it rather than agreeing
-- with a drawing.
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
            'coder-fallback=2', 'coder-max=4', 'coder-std=4', 'local-docs=3',
            'local-free=2', 'second-opinion=1', 'sizer=3']
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
-- The id convention, for the routing seed's own rows.
--
-- 413 rows under six prefixes — an alias, a kind, a route, a hop, a rule and a routed call
-- are each recognisable on sight in a log or a URL — so a row added later with a generated id
-- is caught here rather than by nobody.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 413 from (
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
   ) as seeded),
  'the routing seed created its 413 prefixed rows and no 414th');


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

\o
\echo 'seed.sql: all assertions passed'
