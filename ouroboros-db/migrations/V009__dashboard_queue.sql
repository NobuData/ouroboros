-- V009__dashboard_queue.sql — `queue_items`, the ordered per-organization issue queue.
--
-- The second table of the dashboard read-model, and the one behind two of mockup 02's
-- six surfaces (docs/mockups/02-dashboard.html):
--
--   * **Up next in queue** (`c-5`) — five bordered rows, each an issue number, a title,
--     an effort chip (`M`, `L`, `XS`, `XL`, `S`) and a workflow tag,
--   * the stat row's **Queued issues**, whose subline reads `est. 9h 40m of autonomous
--     work` — the sum of the queue's estimates, not a count.
--
-- A queue is an *order* and an *estimate*, and neither had anywhere to live: `runs`
-- (V008, #64) records work the loop has started, and by construction says nothing about
-- work it has not.
--
-- **This issue delivers the shape and the constraints only.** Reordering and removal are
-- the mockup-03 issues screen's (#73's `GET /api/v1/queue` reads this table; the engine
-- consuming the head of the queue is v2, #54). What that split means in practice is that
-- every rule a reader depends on is a database constraint rather than an application
-- invariant — the same reasoning V008 gave, for the same reason: the writers do not exist
-- to be trusted yet.
--
-- **Decision F9 — the effort scale is closed, and it is the mockup's.** `xs|s|m|l|xl` are
-- the five chips the card renders and the five classes the design system styles; a sixth
-- value would be a row whose chip has no CSS. Stored lower-case because it is a class
-- name and a filter value, not a caption — the UI upper-cases it.
--
-- **Decision F8 — `workflow_tag` stays opaque**, exactly as it is on `runs`: workflow
-- entities are mockup 04's, and a queue item tagged with a workflow that has since been
-- renamed must still render. Bounded and non-blank, and no vocabulary.
--
-- House snake_case throughout — decision A4. `organization` is referenced by its quoted
-- camelCase `"id"` because that is BetterAuth's column; everything this file creates is
-- ours. `position` is a PostgreSQL keyword only in the sense that `position(… in …)` is a
-- function: it is a `func_name_keyword`, which may be a column name unquoted, and is used
-- unquoted throughout this file and in the tests.
--
-- Filed as issue #65 (F.2).

-- ---------------------------------------------------------------------------
-- The repo-belongs-to-the-organization check, now shared.
--
-- `queue_items` names the same two parents `runs` does — the workspace it is scoped to
-- and the repository the issue lives in — and needs the same rule: nothing about two
-- separate foreign keys makes them agree, and a row that names one organization and
-- another's repository is not a broken join but a tenancy leak, one workspace's issue
-- titles rendering on another's dashboard. The composite foreign key that would prevent
-- it does not exist, because V003 hung `github_repos` off `github_orgs.org_id` rather
-- than storing the workspace twice; reaching the workspace from a repository is a join,
-- and a join is a trigger's job.
--
-- V008 wrote that trigger for `runs`. This migration does not write it a second time: the
-- function below is that function with the table taken out of it, and V008's trigger is
-- re-pointed at it so there is one copy of the rule for both tables — and for the third
-- table that needs it (`token_usage`, #66, reaches a repository through `run_id` and so
-- may not, but the next one that names both parents directly will).
--
-- What generalising it costs is one requirement, stated because it is invisible: the
-- table must call its columns `organization_id` and `github_repo_id`. That is the house
-- naming already, and a table that spells them differently gets an `undefined_column`
-- error on its first insert rather than a silently absent check.
--
-- The error is unchanged for callers. It is still class 23 (`check_violation`) — an
-- integrity violation with a constraint name, like every other rule in these files —
-- and the name is now `tg_name`, the trigger's own. `runs` keeps its trigger name, so
-- `runs_repo_in_organization` remains exactly what a rejected run reports.
--
-- What it does **not** cover, stated rather than implied, and inherited unchanged from
-- V008: it fires on writes to the *referencing* table, so re-parenting a `github_repos`
-- row onto an org in another workspace — or a `github_orgs` row onto another
-- organization — would leave existing rows mis-scoped behind it. Nothing performs either
-- move today (enablement rows are created and deleted, not transplanted). The day
-- something does, that migration owns this.
-- ---------------------------------------------------------------------------
create function ouroboros.repo_in_organization()
returns trigger language plpgsql as $$
declare
  owner text;
begin
  select o.organization_id into owner
    from ouroboros.github_repos r
    join ouroboros.github_orgs  o on o.id = r.org_id
   where r.id = new.github_repo_id;

  -- Null means the repository is gone between this statement and its own foreign key —
  -- which the FK itself will refuse a moment later. Saying nothing here leaves that
  -- error to the constraint that describes it properly.
  if owner is not null and owner is distinct from new.organization_id then
    raise exception
      '% row targets repository %, which belongs to organization % rather than %',
      tg_table_name, new.github_repo_id, owner, new.organization_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.repo_in_organization() is
  'BEFORE INSERT OR UPDATE trigger for any table carrying both organization_id and github_repo_id (#65, generalised from #64): refuses a row whose repository belongs to a different organization than the row does. The composite foreign key this replaces does not exist — github_repos reaches the workspace through github_orgs. Raises class 23 naming the trigger, so each table reports its own constraint name.';

-- V008's trigger, re-pointed at the shared function and keeping its name — which is what
-- keeps its error identical, since the name callers see is now the trigger's. Dropped and
-- re-created rather than altered, because a trigger's function is not something
-- `alter trigger` can change.
drop trigger runs_repo_in_organization on ouroboros.runs;

create trigger runs_repo_in_organization
  before insert or update of organization_id, github_repo_id on ouroboros.runs
  for each row execute function ouroboros.repo_in_organization();

-- And the copy it superseded. Dropped after the last trigger referencing it, so this
-- statement is also the check that there was only one.
drop function ouroboros.runs_repo_in_organization();

-- ---------------------------------------------------------------------------
-- queue_items
-- ---------------------------------------------------------------------------
create table ouroboros.queue_items (
  id               uuid        primary key default gen_random_uuid(),

  -- The workspace the queue belongs to. Every read of this table is scoped by it, it
  -- leads both unique keys, and it cascades for the reason V006 and V008 gave: a deleted
  -- workspace must not leave rows behind naming issues in repositories nobody can reach.
  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The repository the issue lives in. Cascade rather than `set null`: a queued issue in
  -- a repository that is no longer enabled is not work anything will pick up, and the
  -- card's row links into the repo. Held to the same workspace as `organization_id` by
  -- the shared trigger above.
  github_repo_id   uuid        not null
                               references ouroboros.github_repos (id) on delete cascade,

  -- The issue, as GitHub numbers it (`#485`), and its title at the time it was queued.
  --
  -- The title is stored rather than fetched for the same reason `runs` stores it: the
  -- card renders five of them on every poll, and a fan-out to the GitHub API per row
  -- would be rate-limited before it was slow. Unlike a run's, this one is worth
  -- refreshing when the queue is next reconciled with GitHub — a queued issue is work
  -- that has not happened yet, so its current title is the useful answer. Nothing
  -- refreshes it today; #73 owns that when writes land.
  issue_number     integer     not null,
  issue_title      text        not null,

  -- The effort chip, decision F9. Text with a named CHECK rather than an enum — the house
  -- idiom (V003, V007, V008): the value is a label the UI maps to a chip class, and
  -- widening the scale is an ordinary migration instead of enum surgery.
  effort           text        not null,

  -- The workflow this issue is queued under — `standard-fix`, `feature-loop`,
  -- `docs-loop`, `deps-refresh` on the mockup. Opaque, decision F8; see the header.
  workflow_tag     text        not null,

  -- Where the issue sits in the queue: 1 is next. Dense from 1 by convention rather than
  -- by constraint — see `queue_items_organization_position_key` below for what is
  -- enforced, and what deliberately is not.
  position         integer     not null,

  -- How long the loop is expected to spend on this issue, in minutes, and the only
  -- column the *Queued issues* stat reads: its subline is `sum(est_minutes)` rendered as
  -- `9h 40m`.
  --
  -- Nullable, and null means *not estimated* — which is not zero. An unestimated item is
  -- an ordinary queue row that contributes nothing to the total, and `sum` skips nulls
  -- without being asked; zero would claim the loop will finish it instantly. The estimate
  -- is deliberately not derived from `effort`: the chip is a size a person chose and the
  -- estimate is minutes something measured, and collapsing the two would make the stat a
  -- restatement of the chips rather than a second fact.
  est_minutes      integer,

  -- When the issue joined the queue — the age the card can show and the tiebreak a
  -- reorder starts from. Distinct from `created_at` below in the same way `runs`
  -- distinguished `started_at`: they are the same instant for an issue queued as it is
  -- filed and deliberately different for a queue imported or back-filled from elsewhere.
  enqueued_at      timestamptz not null default now(),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- --- one position per workspace, and reordering still works --------------------
  --
  -- Acceptance criterion, both halves at once: position uniqueness per organization is
  -- enforced, *and* a position swap inside a transaction succeeds.
  --
  -- Those two are in tension, and `deferrable initially deferred` is what resolves them.
  -- PostgreSQL checks a unique index as each row version is written — mid-statement, not
  -- at the end of it — so with an immediate constraint every ordinary reorder fails:
  -- `update … set position = 2 where …` collides with the row already at 2, and so does
  -- the single-statement `case` form that swaps both at once. Deferring moves the check
  -- to commit, where the transaction is once again a valid ordering, and reordering
  -- becomes plain SQL that needs no ceremony from the caller — no `set constraints`, no
  -- shuffling through a negative or temporary position, neither of which the writers this
  -- table is waiting on (#73) should have to know about.
  --
  -- What it costs is where a duplicate is reported: at `commit` rather than at the
  -- statement. That is why it is *this* key that defers and not the natural key below —
  -- a duplicate position is a bug in a reorder, which is a transaction that either
  -- applies whole or does not, while a duplicate enqueue is a thing a person can ask for
  -- twice and should be told about at once. (A deferrable index is also not eligible as
  -- an `on conflict` arbiter; an upsert keyed on position is not an operation this table
  -- has, and the natural key remains available for one.)
  --
  -- Dense ordering — 1, 2, 3 with no gaps — is a convention the writer keeps, not a rule
  -- enforced here. It cannot be a row-level CHECK, since density is a property of the set
  -- rather than of any row, and as a constraint trigger over the whole queue it would
  -- serialise every reorder to buy nothing a reader can see: the card is `order by
  -- position`, which renders 1, 2, 5 exactly as it renders 1, 2, 3. What a reader
  -- actually depends on is that the order is *total* — no two rows claiming the same
  -- place — and that is this constraint.
  constraint queue_items_organization_position_key
    unique (organization_id, position) deferrable initially deferred,

  -- --- an issue queues once -------------------------------------------------------
  --
  -- Acceptance criterion: a duplicate enqueue is rejected. The queue is a set of issues
  -- in an order, so the same issue twice is not two pieces of work — it is one issue that
  -- would render twice in the card and be counted twice by the stat.
  --
  -- Deliberately *not* the rule on `runs`, which allows the same issue many times because
  -- a retried issue is genuinely two runs and that table is a history. A queue is a plan,
  -- and a plan holds each issue once.
  --
  -- Scoped to the organization rather than the repository: a workspace's queue is one
  -- queue, and two enabled repositories both numbering an issue `#485` are two different
  -- issues. That is a deliberate over-reach and it is the safer of the two errors —
  -- refusing the second `#485` costs one workspace one queue row, while allowing it
  -- would let the card render two rows a person cannot tell apart. `github_repo_id`
  -- disambiguates them for display; when a workspace with two repositories actually
  -- exists to be bothered by this, widening the key to include it is one migration.
  constraint queue_items_organization_issue_key
    unique (organization_id, issue_number),

  -- --- the five chips, and nothing else --------------------------------------------
  --
  -- Acceptance criterion: the effort CHECK matches the mockup's five chips exactly.
  -- Decision F9 — the card renders all five, the design system styles all five, and a
  -- sixth value is a chip with no class.
  constraint queue_items_effort
    check (effort in ('xs', 's', 'm', 'l', 'xl')),

  -- --- the numbers ------------------------------------------------------------------
  --
  -- Positions start at 1 — the head of the queue is *next*, not zeroth — and issue
  -- numbers are GitHub's positive counters; there is no `#0`.
  constraint queue_items_position_positive     check (position >= 1),
  constraint queue_items_issue_number_positive check (issue_number >= 1),

  -- An estimate is either absent or a real quantity of minutes. Zero is refused because
  -- it is the value that would be typed for "no estimate" and then silently claim the
  -- loop needs no time; null is how this table says that. The upper bound is a fortnight
  -- of continuous work — far past any real estimate, and near enough to stop a
  -- units mistake (milliseconds, seconds) from adding a century to the stat.
  constraint queue_items_est_minutes_sane
    check (est_minutes is null or est_minutes between 1 and 20160),

  -- --- the strings are bounded and say something -------------------------------------
  --
  -- Opaque is not the same as unchecked (decision F8), and the lengths are the rendering
  -- surfaces': GitHub caps an issue title at 256, and a workflow tag that needed more
  -- than a line is not one. Matches `runs` deliberately — the same two columns hold the
  -- same two facts, and a title that fits one table must fit the other.
  constraint queue_items_issue_title_present  check (btrim(issue_title) <> ''
                                                    and length(issue_title) <= 512),
  constraint queue_items_workflow_tag_present check (btrim(workflow_tag) <> ''
                                                    and length(workflow_tag) <= 64)
);

comment on table ouroboros.queue_items is
  'The ordered, estimable per-organization issue queue (#65) — the read-model behind mockup 02''s Up next in queue card and its Queued issues stat. Ordering is total and enforced; density is the writer''s convention. Writes (reorder, remove) are the issues screen''s, #73.';
comment on column ouroboros.queue_items.organization_id is
  'Owning workspace. Every read is scoped by it, and it leads both unique keys.';
comment on column ouroboros.queue_items.github_repo_id is
  'Repository the issue lives in. Held to the same workspace as organization_id by the queue_items_repo_in_organization trigger, which is the composite foreign key github_repos cannot offer.';
comment on column ouroboros.queue_items.issue_title is
  'The title as it was when the issue was queued — stored, not fetched: the card renders five of them on every poll. Worth refreshing when the queue is next reconciled with GitHub, since queued work has not happened yet.';
comment on column ouroboros.queue_items.effort is
  'One of xs | s | m | l | xl — decision F9, the five chips mockup 02 renders, stored lower-case as the class name the UI stamps.';
comment on column ouroboros.queue_items.workflow_tag is
  'Workflow label, plain text and no foreign key — workflow entities are mockup 04 territory (decision F8), and a queued issue must still render under a renamed workflow.';
comment on column ouroboros.queue_items.position is
  'Place in the queue; 1 is next. Unique within the organization and deferrable, so a reorder swaps positions inside a transaction with no ceremony. Density is a convention, not a constraint.';
comment on column ouroboros.queue_items.est_minutes is
  'Expected minutes of autonomous work, or null for not estimated — which is not zero. The Queued issues stat is sum(est_minutes) rendered as "9h 40m"; sum skips the nulls.';
comment on column ouroboros.queue_items.enqueued_at is
  'When the issue joined the queue — not created_at, which is when the row appeared. They differ for a queue imported or back-filled.';

-- ---------------------------------------------------------------------------
-- Indexes — the card's read is the unique key's, and the cascade needs its own.
--
-- Both dashboard reads are already served by `queue_items_organization_position_key`, the
-- index the unique constraint creates:
--
--   select … from ouroboros.queue_items          -- Up next in queue (top five)
--    where organization_id = $1 order by position limit 5
--
--   select count(*), sum(est_minutes)            -- the Queued issues stat
--     from ouroboros.queue_items where organization_id = $1
--
-- The first is a range scan in index order, so the `order by` costs no sort node; the
-- second is the same range, aggregated. A separate index on `(organization_id, position)`
-- would be that index a second time, so there is none — asserted in tests/constraints.sql
-- rather than left as a claim.
-- ---------------------------------------------------------------------------

-- Not a read path: the cascade's. `github_repos` cascades into this table, and without an
-- index on the referencing column PostgreSQL scans all of `queue_items` for every
-- repository deleted. Neither unique key can serve it — both lead with
-- `organization_id`.
create index queue_items_github_repo_id_idx
  on ouroboros.queue_items (github_repo_id);

-- ---------------------------------------------------------------------------
-- Triggers.
--
-- `updated_at` moves on its own (V001's function, as on every table here): on a queue,
-- what it records is when a row was last reordered or re-estimated, which is the one
-- thing a stale-looking queue is asked about.
-- ---------------------------------------------------------------------------
create trigger queue_items_touch_updated_at
  before update on ouroboros.queue_items
  for each row execute function ouroboros.touch_updated_at();

create trigger queue_items_repo_in_organization
  before insert or update of organization_id, github_repo_id on ouroboros.queue_items
  for each row execute function ouroboros.repo_in_organization();
