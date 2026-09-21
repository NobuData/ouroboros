-- V047__run_changes_and_links.sql — `run_files`, `run_commits`, and the two columns the
-- Run Console's right-hand column needs that live on the run itself.
--
-- Mockup 10 (docs/mockups/10-run-detail.html) draws two cards down that column, and this
-- migration is the whole of what the first one needs and almost none of what the second one
-- does. That asymmetry is the issue.
--
--     CHANGES SO FAR                                    3 files
--       drivers/can/telemetry_buf.c              +38  −12
--       drivers/can/isr_fastpath.c                +9   −3
--       tests/telemetry/test_frame_order.c       +21   −0
--       ─────────────────────────────────────────────────
--       a41c9e2  can: replace telemetry k_fifo with k_msgq + frame seq
--       7f03b8d  can: assign frame seq in ISR before enqueue
--       [ will squash on merge ]
--
--     RESOURCES
--       Tokens        212k / 400k budget
--       Est. cost     $1.14 / $2.50 cap
--       Build farm    ● forge-02 reserved
--       Wall clock    12m 40s
--
-- Filed as issue #300 (AO.3), the third issue of the Run Console roadmap
-- (docs/ROADMAP_MOCKUP_10_RUN_CONSOLE.md). It needs AO.1 (#298) for `runs`' console columns
-- and the `runs_with_stage` view this file has to keep whole, and AH.1 (#249) for the build
-- jobs the reservation points at.
--
--
-- The Changes card is two tables, and the first of them upserts.
-- ---------------------------------------------------------------------------
--
-- An executor reports its change-set **repeatedly** as it works, and the card shows where the
-- change-set stands *now*. `telemetry_buf.c +38 −12` is the state of that file against the
-- run's base, not the delta since the last report — so a second report of the same file
-- **replaces** its counts. That is an upsert on `(run_id, path)`, and it is the one thing in
-- this migration that is easy to get wrong in a way nobody notices for a week: an ingestion
-- path that adds instead of replacing produces counts that climb forever, and a file that
-- reads `+228 −72` after six reports of `+38 −12` looks like a busy run rather than a bug.
--
-- The unique key is what makes the correct statement writable and the incorrect one
-- unnecessary:
--
--     insert into ouroboros.run_files
--         (run_id, path, additions, deletions, status, last_reported_at)
--     values (…)
--     on conflict (run_id, path) do update
--        set additions        = excluded.additions,
--            deletions        = excluded.deletions,
--            status           = excluded.status,
--            last_reported_at = excluded.last_reported_at;
--
-- `run_commits` is the same shape with the opposite ending: a commit is immutable, so a
-- redelivered report of one is a **no-op** rather than a replacement. Two unique keys hold it
-- — `(run_id, sha)`, which is the commit's identity, and `(run_id, seq)`, which is its place
-- in the list — so a redelivery is written as an untargeted `on conflict do nothing`, which
-- covers both. A targeted `on conflict (run_id, sha)` would raise on the other key instead of
-- doing nothing, which is why the contract is stated here rather than left to each writer.
--
--
-- The Resources card, and why this migration nearly ignores it.
-- ---------------------------------------------------------------------------
--
-- Every number in that card already has an owner:
--
--   | Rendered                      | Owned by                                             |
--   |-------------------------------|------------------------------------------------------|
--   | `212k` tokens used            | `token_usage`, summed per run (V010, #66)            |
--   | `/ 400k budget`               | `run_stages.token_budget`, the DSL snapshot (V045)   |
--   | `$1.14` est. cost             | `token_usage.cost_cents`, null where unpriced (M7)   |
--   | `/ $2.50 cap`                 | the route's cost cap (#194)                          |
--   | `forge-02 reserved`           | `build_jobs` and its runner (V040, #249)             |
--   | `12m 40s` wall clock          | `run_stages`' timestamps, or the run's own (V045)    |
--
-- Roadmap decision **R8** is that the console *reads* those systems rather than keeping its
-- own copies, and the reasoning is the same one V010's header gives for not storing a total
-- per workspace: **a second counter is a counter that will disagree with the first one**, and
-- when it does, somebody has to work out which of the two is lying — usually while looking at
-- a run that has already finished and cannot be asked again.
--
-- So the Resources half of this issue adds one column: `runs.reserved_build_job_id`, the link
-- that turns *"this run has a slot on the farm"* from a sentence into a join. Everything else
-- that card renders is an aggregate over rows that already exist.
--
-- **Deliberately not added**, and asserted absent in tests/constraints.sql so that adding one
-- is a test somebody has to delete rather than a column nobody notices: `total_additions`,
-- `total_deletions`, `file_count`, `commit_count`, `tokens_used`, `cost_cents`,
-- `wall_clock_seconds`. The first three are `sum()`, `sum()` and `count()` over `run_files`,
-- which holds three rows for the run on the mockup; the rest belong to the systems above.

-- ---------------------------------------------------------------------------
-- `runs` gains the merge-strategy snapshot and the farm link.
-- ---------------------------------------------------------------------------
alter table ouroboros.runs
  add column merge_strategy        text,
  add column reserved_build_job_id uuid;

alter table ouroboros.runs
  -- The workflow DSL's `merge_method` (docs/WORKFLOW_DSL.md §4.5), which is the vocabulary
  -- because it is the one the pinned document wrote it in. The card's tag is this word
  -- rendered — *"will squash on merge"* — so a fourth word here would be a tag nobody has
  -- written the sentence for.
  add constraint runs_merge_strategy
    check (merge_strategy is null or merge_strategy in ('squash', 'merge', 'rebase')),

  -- The reservation is a build job of **this run's own workspace**, which is what the
  -- composite reference says and what no service then has to remember. V040 added
  -- `build_jobs_id_organization_key` for exactly this shape, and `build_jobs.run_id` is its
  -- mirror image — the two tables point at each other, each with a nullable link, because a
  -- build can belong to no loop (decision B6) and a loop can have reserved no build.
  --
  -- MATCH SIMPLE, so a null `reserved_build_job_id` satisfies the constraint whatever
  -- `organization_id` holds; and `on delete set null (reserved_build_job_id)`, naming the one
  -- column, because an unqualified SET NULL on a composite reference would try to null
  -- `organization_id` too — which is `not null`, so the delete would fail rather than release
  -- the reservation.
  add constraint runs_reserved_build_job_fk
    foreign key (reserved_build_job_id, organization_id)
    references ouroboros.build_jobs (id, organization_id)
    on delete set null (reserved_build_job_id);

comment on column ouroboros.runs.merge_strategy is
  'How the pinned workflow says this run''s pull request will land — the DSL''s open_pr_automerge options.merge_method (§4.5), snapshotted at pin time (#300). The source of mockup 10''s "will squash on merge" tag. A snapshot rather than a join for V008''s decision F8 reason: the workflow can be republished, renamed or deleted, and a closed run must still answer for what it actually ran under. Null when the pinned workflow''s terminal node is not open_pr_automerge — a back_to_queue or needs_review ending opens no pull request — and the card then renders no tag rather than a default one.';
comment on column ouroboros.runs.reserved_build_job_id is
  'The build job this run holds on the farm (#300, decision R8) — what mockup 10''s Resources card renders as "forge-02 reserved", by way of the job''s runner. Nullable, and its absence is an omitted row rather than a placeholder: most runs never reserve anything, and a schema that forced a reservation would be a schema that invented one. Composite with organization_id, so a run can only ever reserve a build job of its own workspace; ON DELETE SET NULL on this column alone, because a deleted build job releases the reservation rather than deleting the run.';
comment on constraint runs_reserved_build_job_fk on ouroboros.runs is
  'A run reserves a build job of its own workspace (#300), the mirror of build_jobs_run_fk (#249, decision B6). SET NULL names the one column: an unqualified SET NULL on a composite reference would null organization_id too, and the delete would fail instead of releasing the reservation.';

-- The index the reservation is released through. Without it, deleting a build job seq-scans
-- `runs` to find the rows pointing at it, once per deleted job — which is the shape a
-- workspace teardown takes. Partial, because a reservation is the exception: on a database of
-- finished runs, almost every row is excluded and the index is a fraction of the table.
create index runs_reserved_build_job_idx
  on ouroboros.runs (reserved_build_job_id, organization_id)
  where reserved_build_job_id is not null;

comment on index ouroboros.runs_reserved_build_job_idx is
  'What runs_reserved_build_job_fk releases a reservation through when a build job is deleted (#300), and what the farm''s "which run holds this job?" read enters by. Partial, because a run with a reservation is the exception rather than the rule.';

-- ---------------------------------------------------------------------------
-- `runs_with_stage` carries them too.
--
-- V045's amendment on #64 is *"a read moves from `runs` to this view by changing one word"*,
-- and that is only true while the two have the same columns — V046 added its six here for the
-- same reason. Two more, at the end, which is what `create or replace view` allows and what
-- keeps every existing read working through the replacement.
-- ---------------------------------------------------------------------------
create or replace view ouroboros.runs_with_stage as
select run.id,
       run.organization_id,
       run.github_repo_id,
       run.issue_number,
       run.issue_title,
       run.workflow_tag,
       run.model,
       run.status,
       coalesce(current_stage.stage_label, run.stage_label) as stage_label,
       coalesce(current_stage.stage_index, run.stage_index) as stage_index,
       coalesce(current_stage.stage_total, run.stage_total) as stage_total,
       run.started_at,
       run.finished_at,
       run.pr_number,
       run.checks_passed,
       run.checks_total,
       run.created_at,
       run.updated_at,
       run.loop_seq,
       run.branch_name,
       run.workflow_version_pin,
       run.simulated,
       run.event_seq,
       run.event_bytes,
       run.event_cap,
       run.event_byte_cap,
       run.events_elided_at,
       run.merge_strategy,
       run.reserved_build_job_id
  from ouroboros.runs run
  left join ouroboros.run_stage_current current_stage
    on current_stage.run_id = run.id;

comment on view ouroboros.runs_with_stage is
  'runs, with the stage meter resolved from stage history (#298, the amendment on #64, extended by #299 and #300). Identical to runs for a run with no run_stages rows, which is what lets a read move over one at a time and what keeps mockup 02 rendering while the legacy columns are still on the table. Their removal is a later migration.';

-- ---------------------------------------------------------------------------
-- run_files — where each file of the change-set stands, now.
-- ---------------------------------------------------------------------------
create table ouroboros.run_files (
  id         uuid        primary key default gen_random_uuid(),

  -- The run whose change-set this is, and — V029's and V045's choice — the whole of this
  -- row's tenancy: a file of a change-set has no meaning apart from the run that changed it,
  -- and every read enters through a run. Cascade, because a diff of work nobody can reach is
  -- not a diff.
  run_id     uuid        not null
                         references ouroboros.runs (id) on delete cascade,

  -- The repository-relative path, as the executor reports it —
  -- `drivers/can/telemetry_buf.c`. The card prints it whole and the guardrail evaluations of
  -- AO.4 (#301) match allowed-path rules against it, so it is stored the way git names a
  -- file: relative to the repository root, forward slashes, no leading one.
  path     text        not null,

  -- **Cumulative, and replaced by each report.** The `+38` and the `−12`. See the header:
  -- these are where the file stands against the run's base, not a delta, which is what makes
  -- a repeated report an upsert rather than an addition.
  additions  integer     not null default 0,
  deletions  integer     not null default 0,

  -- What happened to the file, in git's own four words. The card has no treatment for them
  -- today — it prints a path and two counts — but a deleted file with `+0 −140` and a new one
  -- with `+21 −0` are different facts, and the one that renders them differently is AQ's.
  status   text        not null,

  -- When the executor measured the row above. **Not** a second `updated_at`: this table's
  -- only write is a report, so the row's clock and the report's clock are the same instant
  -- named once, and a column that repeated it in the database's own `now()` would be the
  -- second copy this schema spends its headers arguing against.
  last_reported_at timestamptz not null default now(),

  -- When the file first entered this run's change-set. Kept because the difference between
  -- the two is how long a file has been in the diff, which is a question the Changes card
  -- does not ask and the ingestion contract's replay does.
  created_at timestamptz not null default now(),

  -- --- one row per file per run ------------------------------------------------
  --
  -- The key the upsert conflicts on, and the acceptance criterion in one line: a second
  -- report of `telemetry_buf.c` cannot become a second row, so `sum(additions)` counts the
  -- file once however many times it was reported.
  --
  -- It is also the card's read — every file of one run, in path order — and the index the
  -- `runs` cascade deletes through, which is why no second index is created here.
  constraint run_files_run_path_key unique (run_id, path),

  -- --- the shapes ---------------------------------------------------------------
  --
  -- A path, shaped rather than parsed. Refused: blank, surrounding whitespace, an absolute
  -- path, a `..` segment and anything past what git will hold. The middle two matter beyond
  -- tidiness — AO.4's allowed-path rules are matched against this column, and a rule written
  -- for `drivers/` is not a rule anybody wrote for `/drivers/` or `app/../drivers/`.
  constraint run_files_path_present
    check (btrim(path) = path
           and path <> ''
           and length(path) <= 1024),
  constraint run_files_path_is_relative
    check (path !~ '^/'
           and path !~ '(^|/)\.\.(/|$)'),

  -- A diff adds and removes a number of lines, and that number is not negative.
  constraint run_files_counts_non_negative
    check (additions >= 0 and deletions >= 0),

  constraint run_files_status
    check (status in ('added', 'modified', 'deleted', 'renamed')),

  -- Two statements the words themselves make: a file that did not exist before this run has
  -- no lines to have removed, and a file that does not exist after it has none to have added.
  -- Both are arithmetic rather than policy, and both catch the same reporting bug — a status
  -- and a pair of counts that came from different sides of a rename.
  constraint run_files_added_removes_nothing
    check (status <> 'added' or deletions = 0),
  constraint run_files_deleted_adds_nothing
    check (status <> 'deleted' or additions = 0)
);

comment on table ouroboros.run_files is
  'Where each file of a run''s change-set stands, now (#300, AO.3) — mockup 10''s Changes card, file rows. Counts are cumulative against the run''s base and a report REPLACES them: writers upsert on run_files_run_path_key rather than adding, because a delta added to a cumulative row is a count that climbs forever. The card''s "3 files" and its totals are count() and sum() over these rows at read time; no aggregate of them is stored anywhere (decision R8).';
comment on column ouroboros.run_files.run_id is
  'The run whose change-set this is, and the whole of this row''s tenancy — V045''s choice, since a changed file has no meaning apart from the run that changed it and every read enters through one. ON DELETE CASCADE.';
comment on column ouroboros.run_files.path is
  'The repository-relative path as the executor reports it — drivers/can/telemetry_buf.c. Held relative and segment-clean because AO.4 (#301) matches the pinned workflow''s allowed-path rules against this column, and a rule written for drivers/ is not one anybody wrote for /drivers/ or app/../drivers/.';
comment on column ouroboros.run_files.additions is
  'Lines this file has gained against the run''s base — the +38 (#300). Cumulative: a report states where the file stands, so an upsert replaces this and never adds to it.';
comment on column ouroboros.run_files.deletions is
  'Lines this file has lost against the run''s base — the −12 (#300). Cumulative, as additions is.';
comment on column ouroboros.run_files.status is
  'added | modified | deleted | renamed — what happened to the file, in git''s own words. Constrained against the counts: an added file removes nothing and a deleted one adds nothing.';
comment on column ouroboros.run_files.last_reported_at is
  'When the executor measured this row (#300). There is no updated_at beside it: a report is the only thing that writes this table, so the row''s clock and the report''s are one instant, and naming it twice would be the second copy that can disagree with the first.';
comment on constraint run_files_run_path_key on ouroboros.run_files is
  'One row per file per run (#300) — the key a cumulative report upserts on, so re-reporting a file replaces its counts instead of adding a second row. Also the Changes card''s read, in path order, and the index the runs cascade deletes through.';

-- ---------------------------------------------------------------------------
-- run_commits — the commits the run has made, in order.
-- ---------------------------------------------------------------------------
create table ouroboros.run_commits (
  id           uuid        primary key default gen_random_uuid(),

  run_id       uuid        not null
                           references ouroboros.runs (id) on delete cascade,

  -- The commit's own name. Stored as the executor reports it — an abbreviation or the whole
  -- forty characters — because both name the same commit and the card prints the first seven
  -- of either. `a41c9e2` on the mockup is the abbreviation; a report that carries the full
  -- sha renders identically and is the more useful thing to have kept.
  sha          text        not null,

  -- What the commit says. The card prints its first line; the column holds what was reported,
  -- because a message body is the sort of thing somebody wants later and nothing here needs
  -- to truncate for.
  message      text        not null,

  -- Where this commit sits in the run's list, from 1. The card draws them in this order, and
  -- the order is the writer's rather than the clock's on purpose: a rebase rewrites commit
  -- times, and a list that reordered itself when the loop rebased would be a list that
  -- disagreed with the branch it describes.
  seq          integer     not null,

  -- When the commit was made, by git's clock rather than by this database's. See seq: the two
  -- can disagree after a rebase, and this column is the one that is allowed to.
  committed_at timestamptz not null,

  -- When the report that carried it landed. V040's `received_at` on `build_log_chunks`, and
  -- the same use: the gap between the two is what ingestion lag looks like. There is no
  -- `updated_at`, because a commit is immutable and a redelivered report of one writes
  -- nothing — see the two unique keys below.
  reported_at  timestamptz not null default now(),

  -- --- the two keys, and what each one refuses ---------------------------------
  --
  -- A commit's identity within a run. The acceptance criterion *"re-reporting the same sha is
  -- a no-op"* is this key plus `on conflict do nothing`.
  constraint run_commits_run_sha_key unique (run_id, sha),

  -- And its place in the list. Two commits cannot claim one position, so *ordered* is a
  -- property of the rows rather than of whoever happens to select them. A redelivered report
  -- carries the same seq with the same sha and so collides on both keys, which is why the
  -- contract in this file's header is the untargeted `on conflict do nothing`: a target names
  -- one key, and the other one then raises instead of doing nothing.
  --
  -- Leading `run_id`, so this is also the card's read — one run's commits in drawing order —
  -- and the index the `runs` cascade deletes through.
  constraint run_commits_run_seq_key unique (run_id, seq),

  -- --- the shapes ---------------------------------------------------------------
  --
  -- Lower-case hex, seven to forty. Seven is git's own shortest unambiguous abbreviation and
  -- the width the card prints; forty is a whole SHA-1. Folded case rather than either case,
  -- so `A41C9E2` and `a41c9e2` cannot be two rows for one commit.
  constraint run_commits_sha_shape
    check (sha ~ '^[0-9a-f]{7,40}$'),

  constraint run_commits_message_present
    check (btrim(message) <> '' and length(message) <= 8192),

  constraint run_commits_seq_positive
    check (seq >= 1)
);

comment on table ouroboros.run_commits is
  'The commits a run has made, in the order its Changes card draws them (#300, AO.3) — a41c9e2 "can: replace telemetry k_fifo with k_msgq + frame seq". A commit is immutable, so a redelivered report is a no-op rather than an update: writers use an untargeted ON CONFLICT DO NOTHING, which covers both unique keys. No count of these is stored on runs; the card counts the rows.';
comment on column ouroboros.run_commits.sha is
  'The commit''s name, as reported — an abbreviation or the whole forty characters, both of which name the same commit and render as the same seven-character chip (#300). Lower-case hex, so one commit cannot become two rows by case.';
comment on column ouroboros.run_commits.message is
  'What the commit says. The card prints the first line; the column keeps what was reported.';
comment on column ouroboros.run_commits.seq is
  'Where this commit sits in the run''s list, from 1 (#300). The writer''s order rather than the clock''s: a rebase rewrites commit times, and a list that reordered itself when the loop rebased would disagree with the branch it describes.';
comment on column ouroboros.run_commits.committed_at is
  'When the commit was made, by git''s clock. May disagree with seq after a rebase, which is why seq exists.';
comment on column ouroboros.run_commits.reported_at is
  'When the report carrying this commit landed — V040''s received_at, and the same use: the gap from committed_at is what ingestion lag looks like.';
comment on constraint run_commits_run_sha_key on ouroboros.run_commits is
  'One row per commit per run (#300). Re-reporting a sha is a no-op rather than a second line in the card.';
comment on constraint run_commits_run_seq_key on ouroboros.run_commits is
  'One commit per position per run (#300), so the list''s order is a property of the rows. Also the card''s read, in drawing order, and the index the runs cascade deletes through.';
