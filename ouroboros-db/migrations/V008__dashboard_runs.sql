-- V008__dashboard_runs.sql — `runs`, one row per run of the loop against an issue.
--
-- The first table of the dashboard read-model. Three of the six surfaces on mockup 02
-- (docs/mockups/02-dashboard.html) are views over the same entity — "a run of the loop
-- against an issue" — and until now that entity had no table anywhere:
--
--   * the **stat row**'s *Loops live* (`2 coding · 1 in review`) and *PRs merged · 7d*,
--   * **Active loops** (`c-8`) — issue, workflow tag, stage meter, model pill, elapsed,
--     status pill,
--   * **Recently closed by the loop** (`c-7`) — issue → PR, model, cycle, checks,
--     outcome.
--
-- **Decision F2 — one table, not two.** The two tables on the mockup are two *queries*,
-- not two entities: "active loops" is the rows whose status is non-terminal, "recently
-- closed" is the rows whose status is terminal. A second table for completions would
-- have to be kept in step with this one by something, and that something is the thing
-- that goes wrong. A run is written once and mutated through its lifecycle instead, and
-- the transition into a terminal status *is* the move between the two cards.
--
-- **Decision F8 — `model` and `workflow_tag` are opaque.** A model identifier is a
-- string the dashboard renders in a `pill model` and nothing here interprets:
-- `claude-fable-5`, `ollama/qwen3-coder`, `copilot/gpt-5-codex`. The model registry is
-- mockup 06/21 territory and workflow entities are mockup 04's; a CHECK enumerating
-- either here would be this table inventing a catalog it does not own, and would reject
-- a run the engine legitimately performed. Both columns are therefore bounded and
-- non-blank and otherwise unconstrained — the shape is asserted, the vocabulary is not.
--
-- **Nothing writes this table yet.** The loop engine is deliberately v2 (#54), so the
-- read-model is populated by the dev seed (#68) and read by the REST endpoints (#71,
-- #72). That is why every rule a reader depends on is a database constraint rather than
-- an application invariant: the writers do not exist to be trusted yet.
--
-- House snake_case throughout — decision A4: the library's shape governs the library's
-- tables and stops there. `organization` is referenced by its quoted camelCase `"id"`
-- because that is BetterAuth's column; everything this file creates is ours.
--
-- Filed as issue #64 (F.1).

-- ---------------------------------------------------------------------------
-- The repo-belongs-to-the-organization check.
--
-- `runs` names two parents — the workspace it is scoped to, and the repository it
-- targets — and nothing about two separate foreign keys makes them agree. A row could
-- name `org-acme` and a repository enabled by Globex, and the result is not a broken
-- join: it is Globex's issue titles rendering on Acme's dashboard, which is a tenancy
-- leak rather than a typo.
--
-- The parents cannot be reconciled by a composite foreign key, because `github_repos`
-- does not carry the organization — V003 hung it off `github_orgs.org_id` deliberately,
-- so that the workspace is stored once and cannot disagree with itself. Reaching the
-- workspace from a repository is therefore a join, and a join is a trigger's job.
--
-- Raised as class 23 (`check_violation`) naming this constraint, so it is refused the
-- same way every other rule in this file is: callers see an integrity violation with a
-- constraint name, not a bespoke error class they would have to learn.
--
-- What it does **not** cover, stated rather than implied: it fires on writes to `runs`,
-- so re-parenting a `github_repos` row onto an org in another workspace — or a
-- `github_orgs` row onto another organization — would leave existing runs mis-scoped
-- behind it. Neither is a move anything performs today (enablement rows are created and
-- deleted, not transplanted), and covering it would mean triggers on two tables this
-- migration has no other business with. The day something does move an org between
-- workspaces, that migration owns this.
-- ---------------------------------------------------------------------------
create function ouroboros.runs_repo_in_organization()
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
      'run targets repository % , which belongs to organization % rather than %',
      new.github_repo_id, owner, new.organization_id
      using errcode = 'check_violation', constraint = 'runs_repo_in_organization';
  end if;

  return new;
end;
$$;

comment on function ouroboros.runs_repo_in_organization() is
  'Refuses a run whose github_repo_id belongs to a different organization than its organization_id (#64). The composite key a foreign key would need does not exist — github_repos reaches the workspace through github_orgs.';

-- ---------------------------------------------------------------------------
-- runs
-- ---------------------------------------------------------------------------
create table ouroboros.runs (
  id               uuid        primary key default gen_random_uuid(),

  -- The workspace the run belongs to, and the scope of every query in this file. Cascade
  -- for the same reason V006 gave the extension tables one: a deleted workspace must not
  -- leave rows behind naming issues in repositories nobody can reach any more.
  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The repository the issue lives in. Cascade rather than `set null`, because a run
  -- without a repository cannot be rendered — the *Issue* column links into the repo —
  -- and because disabling scope should not leave history claiming work in it. Held to
  -- the same workspace as `organization_id` by the trigger above.
  github_repo_id   uuid        not null
                               references ouroboros.github_repos (id) on delete cascade,

  -- The issue, as GitHub numbers it (`#482`), and its title at the time the run started.
  --
  -- The title is stored rather than fetched: this is a read-model, the dashboard renders
  -- it on every poll, and a card that fanned out to the GitHub API per row would be
  -- rate-limited before it was slow. A title edited on GitHub afterwards makes this a
  -- record of what the loop was working on, which is the more useful of the two answers
  -- for a row that has already closed.
  issue_number     integer     not null,
  issue_title      text        not null,

  -- The workflow this run was performed under — `standard-fix`, `feature-loop`,
  -- `deps-refresh` on the mockup. Plain text and no foreign key: workflow entities are
  -- mockup 04's, and a tag naming a workflow that has since been renamed or deleted must
  -- still render on a run that has already closed. See decision F8 in the header.
  workflow_tag     text        not null,

  -- The model the run was performed with, opaque. See decision F8 in the header.
  model            text        not null,

  -- Where the run is in its life. The vocabulary is closed and the whole of decision F2:
  -- `coding | building | review` are the *active loops*, `merged | needs_human | failed`
  -- are the *recently closed*, and there is no third category. Text with a named CHECK
  -- rather than an enum, the house idiom (V003, V007): the value is a label the UI maps
  -- to a pill class, and widening the set is an ordinary migration instead of enum
  -- surgery.
  status           text        not null,

  -- The stage meter: `Implementing · 4/6` and a bar at 4/6 of its width. The label is
  -- the workflow's word for the step, so it is text and not a vocabulary — a workflow
  -- names its own stages.
  stage_label      text        not null,
  stage_index      integer     not null,
  stage_total      integer     not null,

  -- The loop's clock, which is not the row's. `started_at` is what the *Elapsed* column
  -- counts from and what a cycle time is measured across; `created_at` below is when
  -- this row appeared. They are the same instant for a run recorded as it starts and
  -- deliberately different for one back-filled afterwards.
  started_at       timestamptz not null default now(),

  -- When the run reached a terminal status — and null exactly while it has not. See
  -- `runs_terminal_finished_at` below.
  finished_at      timestamptz,

  -- The pull request the run opened, and the checks on it (`14/14`). All three are null
  -- until there is a pull request to describe: a run in `coding` has not opened one, and
  -- zeroes would render as `0/0` rather than as an empty cell.
  pr_number        integer,
  checks_passed    integer,
  checks_total     integer,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- --- what a status may be -------------------------------------------------
  --
  -- Acceptance criterion: an unknown status is rejected. Everything downstream of this
  -- table partitions rows by it — the active list, the completions list, the *Loops
  -- live* count — so a seventh value would be a row that appears in neither card and is
  -- silently invisible rather than loudly wrong.
  constraint runs_status
    check (status in ('coding', 'building', 'review', 'merged', 'needs_human', 'failed')),

  -- --- terminal rows have finished, active rows have not ----------------------
  --
  -- Acceptance criterion, in its stronger form: terminal statuses *require*
  -- `finished_at`, and non-terminal statuses *forbid* it. The biconditional rather than
  -- the implication, because F2 makes the two facts one fact — a run is closed when its
  -- status says so, and `finished_at` is when that happened. A `coding` row carrying a
  -- finish time is a contradiction, and it is the shape that would put a live loop in
  -- the *recently closed* card, whose query is `finished_at is not null`.
  --
  -- It is also what lets that query be an index scan on `finished_at` alone rather than
  -- a filter on `status` as well: null means active, and PostgreSQL's b-tree can skip
  -- the nulls.
  constraint runs_terminal_finished_at
    check ((status in ('merged', 'needs_human', 'failed')) = (finished_at is not null)),

  -- A run cannot finish before it started. Cheap, and the one arithmetic error that
  -- would render as a negative cycle time in the *Cycle* column.
  constraint runs_finished_after_started
    check (finished_at is null or finished_at >= started_at),

  -- --- the stage meter is renderable ------------------------------------------
  --
  -- `stage_index / stage_total` is a bar width, so a total of zero is a division by zero
  -- and an index above the total is a bar wider than its track. Zero is permitted for
  -- the index — a run that has started but not entered its first stage is `0/6` — and
  -- the label is required to say something, since the meter is captioned by it.
  constraint runs_stage_total_positive  check (stage_total >= 1),
  constraint runs_stage_index_in_range  check (stage_index between 0 and stage_total),
  constraint runs_stage_label_present   check (btrim(stage_label) <> ''
                                               and length(stage_label) <= 120),

  -- --- the opaque strings are still strings -----------------------------------
  --
  -- No vocabulary (decision F8), but a shape: non-blank, and bounded so that a
  -- runaway writer cannot put a megabyte into a table cell. The lengths are the
  -- rendering surfaces' — GitHub caps an issue title at 256, and a model identifier or
  -- a workflow tag that needed more than a line is not one.
  constraint runs_issue_title_present   check (btrim(issue_title) <> ''
                                               and length(issue_title) <= 512),
  constraint runs_workflow_tag_present  check (btrim(workflow_tag) <> ''
                                               and length(workflow_tag) <= 64),
  constraint runs_model_present         check (btrim(model) <> ''
                                               and length(model) <= 200),

  -- --- the numbers GitHub gave us ---------------------------------------------
  --
  -- Issue and pull-request numbers are positive counters; there is no `#0`.
  constraint runs_issue_number_positive check (issue_number >= 1),
  constraint runs_pr_number_positive    check (pr_number is null or pr_number >= 1),

  -- Checks are a pair or neither: `14/14` needs both halves, and a passed count with no
  -- total is a numerator with nothing to divide by. Zero of zero is legal and means a
  -- repository with no checks configured, which is not the same as not knowing yet
  -- (both null).
  constraint runs_checks_paired
    check ((checks_passed is null) = (checks_total is null)),
  constraint runs_checks_in_range
    check (checks_total is null
           or (checks_total >= 0 and checks_passed between 0 and checks_total)),

  -- A run cannot have merged without a pull request to merge. The *Issue → PR* column of
  -- the completions card reads `#474 → PR #512` from these two, and a merged row with no
  -- `pr_number` has no second half to render. The other two terminal statuses are
  -- deliberately not held to this: a run can fail, or stop for a human, before it ever
  -- opened one.
  constraint runs_merged_has_pr
    check (status <> 'merged' or pr_number is not null)
);

comment on table ouroboros.runs is
  'One run of the loop against one issue (#64). The read-model behind mockup 02''s stat row, Active loops and Recently closed cards — decision F2: non-terminal rows are the active list, terminal rows are the completions list, and there is no second table.';
comment on column ouroboros.runs.organization_id is
  'Owning workspace. Every dashboard query is scoped by it, and it leads both indexes.';
comment on column ouroboros.runs.github_repo_id is
  'Repository the issue lives in. Held to the same workspace as organization_id by the runs_repo_in_organization trigger, which is the composite foreign key github_repos cannot offer.';
comment on column ouroboros.runs.issue_title is
  'The title as it was when the run started — stored, not fetched: the card renders it on every poll, and a closed run should read as the work it actually did.';
comment on column ouroboros.runs.workflow_tag is
  'Workflow label, plain text and no foreign key — workflow entities are mockup 04 territory and a closed run must still render under a renamed workflow.';
comment on column ouroboros.runs.model is
  'Model identifier as recorded, opaque (decision F8): claude-fable-5, ollama/qwen3-coder, copilot/gpt-5-codex. The dashboard renders it; nothing here interprets it.';
comment on column ouroboros.runs.status is
  'Lifecycle: coding | building | review (active) or merged | needs_human | failed (closed). Decision F2 — the partition between the two cards.';
comment on column ouroboros.runs.stage_label is
  'The workflow''s word for the current step ("Implementing"), captioning the stage_index/stage_total meter.';
comment on column ouroboros.runs.started_at is
  'When the loop started on this issue — what Elapsed counts from, and not created_at, which is when the row appeared.';
comment on column ouroboros.runs.finished_at is
  'When the run reached a terminal status; null exactly while it has not (runs_terminal_finished_at). The completions index is keyed on it.';
comment on column ouroboros.runs.checks_total is
  'Total checks on the pull request, paired with checks_passed: both set or both null. 0/0 is a repository with no checks, which is not the same as not knowing yet.';

-- ---------------------------------------------------------------------------
-- Indexes — one per dashboard read, and one for the cascade.
--
-- Acceptance criterion: `EXPLAIN` shows index use for the active-loops query and for the
-- seven-day completions window. Both are asserted in tests/constraints.sql against a
-- migrated database, which is the only place the planner can be asked.
-- ---------------------------------------------------------------------------

-- *Active loops*, and the *Loops live* stat over the same rows:
--
--   select … from ouroboros.runs
--    where organization_id = $1 and status in ('coding', 'building', 'review')
--
-- Leading `organization_id` because every query here is workspace-scoped and none is
-- global; `status` second because it is the filter that follows. Not a partial index on
-- the three active statuses, deliberately: the same index serves a completions list
-- filtered by outcome (`status = 'merged'`), and one index that serves both reads is
-- cheaper to maintain on a table the engine will write to on every stage advance.
create index runs_organization_status_idx
  on ouroboros.runs (organization_id, status);

-- *Recently closed by the loop*, and the seven-day windows the *PRs merged · 7d* stat
-- and the loop-pulse metrics (#72) compute:
--
--   select … from ouroboros.runs
--    where organization_id = $1 and finished_at >= now() - interval '7 days'
--    order by finished_at desc
--
-- `desc` matches the sort the card asks for, so the index answers the ordering as well
-- as the range and no sort node is needed. Nulls are the active rows — see
-- `runs_terminal_finished_at` — so this index is, in effect, the completions table F2
-- declined to create.
create index runs_organization_finished_at_idx
  on ouroboros.runs (organization_id, finished_at desc);

-- Not a read path: the cascade's. `github_repos` cascades into this table, and without
-- an index on the referencing column PostgreSQL scans all of `runs` for every repository
-- deleted. Neither index above can serve it — both lead with `organization_id`.
create index runs_github_repo_id_idx
  on ouroboros.runs (github_repo_id);

-- ---------------------------------------------------------------------------
-- Triggers.
--
-- `updated_at` is the freshness signal for a table nothing writes yet: once the engine
-- does, "when was this run last heard from" is what distinguishes a loop that is working
-- from one that has stopped without saying so.
-- ---------------------------------------------------------------------------
create trigger runs_touch_updated_at
  before update on ouroboros.runs
  for each row execute function ouroboros.touch_updated_at();

create trigger runs_repo_in_organization
  before insert or update of organization_id, github_repo_id on ouroboros.runs
  for each row execute function ouroboros.runs_repo_in_organization();
