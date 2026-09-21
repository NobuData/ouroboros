-- V045__run_stage_history.sql — `run_stages`, one row per stage × attempt, and the three
-- facts a run had to carry before the Run Console's page head could be rendered from data.
--
-- Mockup 10 (docs/mockups/10-run-detail.html) opens with a stepper:
--
--     ✓ Queued 0m 04s → ✓ Analyze 1m 12s → ✓ Plan 2m 05s → ● Implement, attempt 2/3
--                                                            "attempt 1 failed tests —
--                                                             loop returned from gate ↺"
--     → ○ Build → ○ Test → ○ Review → ○ Open PR
--
-- Three of those facts are **history**, and V008's `runs` cannot hold any of them. It stores
-- the stage a loop is *currently* in — `stage_label`, `stage_index`, `stage_total` — which is
-- exactly the right shape for mockup 02's one line per run, and there is no way to ask it how
-- long *Analyze* took, whether *Implement* has been tried before, or why the loop came back.
--
--   * **A duration needs two timestamps.** `1m 12s` is the arithmetic of a start and a finish
--     per stage, so this table stores both and no duration. See decision R1 below.
--   * **`attempt 2/3` needs the attempts.** The `2` is a row that knows attempt 1 happened;
--     the `3` is what the pinned workflow allows, which is a snapshot of the DSL's
--     `limits.max_retries` and *not* a live read of a document that can be republished.
--   * **The warn note is a transition, not a sentence.** *"attempt 1 failed tests — loop
--     returned from gate ↺"* is the record of a gate sending the loop backwards. Roadmap
--     decision **R1** is that it must be *composed from* that transition and never typed as a
--     string by whoever renders it, because a note that is copy drifts from the run it
--     describes and a note derived from a recorded transition cannot.
--
-- Filed as issue #298 (AO.1), the first issue of the Run Console roadmap
-- (docs/ROADMAP_MOCKUP_10_RUN_CONSOLE.md).
--
--
-- Decision R1, made structural — `note` is a generated column.
-- ---------------------------------------------------------------------------
--
-- "Machine-composed, never free text" is a promise until something enforces it, and the
-- enforcement cannot be a CHECK: a CHECK can reject a note, but it cannot tell a *correct*
-- sentence somebody typed from the one the transition implies. V018 met the same problem with
-- `escalation_rules.display` and answered it the same way — the column is
-- `generated always … stored`, derived from structured columns, and **PostgreSQL itself
-- refuses any statement that supplies a value for it**, from any client, in any role.
--
-- So the transition is stored as three columns that arrive together —
-- `returned_from_stage_key`, `returned_from_kind`, `return_reason` — and the sentence is
-- arithmetic over them and `attempt`. The acceptance criterion *"a test asserts no write path
-- accepts free-form note text from a client"* is therefore not a property of any write path:
-- there is no write path that could.
--
-- The vocabulary both structured columns are held to is the workflow DSL's
-- (docs/WORKFLOW_DSL.md), not one invented here. `returned_from_kind` is the DSL's node
-- `type` with `flow` resolved into the two words §4.4 gives it — `trigger`, `llm`, `infra`,
-- `gate`, `decision`, `term` — because *gate* is the word the canvas prints, the code view
-- prints and the mockup's note prints. `return_reason` is the closed set of endings a loop
-- edge can carry the run back from.
--
--
-- Why no `organization_id`, when nearly every other table in this schema has one.
-- ---------------------------------------------------------------------------
--
-- V029's choice, for V029's reason: a stage has no meaning apart from the run it belongs to,
-- every read enters through a run, and `run_id` cascades. A second copy of the workspace here
-- would be a fact that can disagree with `runs.organization_id` and a composite foreign key to
-- keep it from doing so — machinery bought to store something no query needs, because there is
-- no *"this workspace's stages"* question that is not *"this workspace's runs, and their
-- stages"*.
--
--
-- What this migration deliberately does **not** do.
-- ---------------------------------------------------------------------------
--
-- `runs.stage_label`, `runs.stage_index` and `runs.stage_total` stay exactly where they are.
-- The dashboard reads them on every poll, so removing them in the same change that introduces
-- their replacement would leave mockup 02 in mid-air between two migrations. The amendment
-- filed on #64 is the read path moving to `ouroboros.runs_with_stage` below — a view with
-- every column `runs` has, whose three stage columns are answered from stage history where a
-- run has any and from the legacy columns where it has none — and their removal is a later
-- migration, once nothing reads them.

-- ---------------------------------------------------------------------------
-- `runs` gains the three facts the console's page head is rendered from.
--
--     Run Console · Loop #1847
--     #482 — Fix flaky CAN-bus telemetry test
--     coding · standard-fix v14 · claude-fable-5 · elapsed 12m 40s
--     · branch loop/482-canbus-flake
--
-- `loop_seq` is the `#1847`, `branch_name` is the `loop/482-canbus-flake`, and
-- `workflow_version_pin` is the `14` of `standard-fix v14`.
--
-- **The pin is the version number, not the rendered string.** `runs.workflow_tag` already
-- carries the slug (`standard-fix`, opaque by decision F8 — no foreign key, so a closed run
-- still renders under a workflow that has since been renamed or deleted), and the DSL's §3
-- says a pin is *"`workflow_tag` + `workflow_version`"* — which is precisely the pair V032
-- gave `queue_items`. `standard-fix@v14` is the composition of the two, and storing the
-- composition as well would be a second copy of the slug that can disagree with the first.
-- ---------------------------------------------------------------------------
alter table ouroboros.runs
  add column loop_seq             integer,
  add column branch_name          text,
  add column workflow_version_pin integer;

-- Every run that already exists gets a number, in the order the loop performed them, so that
-- `not null` below is a rule about the column rather than a rule about rows written after
-- today. `started_at` is the loop's own clock (V008) and therefore the order a person would
-- count in; `created_at` and `id` break ties, so the back-fill is deterministic and a second
-- run of it on a restored dump numbers the same rows the same way.
update ouroboros.runs r
   set loop_seq = numbered.seq
  from (select id,
               row_number() over (partition by organization_id
                                  order by started_at, created_at, id) as seq
          from ouroboros.runs) numbered
 where numbered.id = r.id;

alter table ouroboros.runs
  alter column loop_seq set not null;

alter table ouroboros.runs
  -- The counter is a display number: `Loop #1847`, and `#0` is not one.
  add constraint runs_loop_seq_positive
    check (loop_seq >= 1),

  -- One number per workspace, once. This is what makes the allocation below safe under
  -- concurrency rather than merely careful: two writers that both computed the same next
  -- number cannot both commit, whatever the lock did. Read backwards it is also the index the
  -- allocator takes `max(loop_seq)` from.
  add constraint runs_organization_loop_seq_key
    unique (organization_id, loop_seq),

  -- A git branch name, shaped rather than parsed. Null is a run that has not created one —
  -- a run in `Queued` has no branch, and the head renders no chip for it. Refused: blank,
  -- surrounding whitespace, and anything past what a filesystem will hold as a ref.
  add constraint runs_branch_name_present
    check (branch_name is null
           or (btrim(branch_name) = branch_name
               and branch_name <> ''
               and length(branch_name) <= 255)),

  -- The version half of the pin, numbered as `workflow_versions.version` numbers them: dense
  -- from 1 (V029). Null is a run performed under a workflow that had nothing published to pin,
  -- which is the same null `queue_items.workflow_version` carries and means the same thing.
  add constraint runs_workflow_version_pin_positive
    check (workflow_version_pin is null or workflow_version_pin >= 1);

comment on column ouroboros.runs.loop_seq is
  'The Loop #1847 counter (#298) — a per-workspace display sequence, allocated by runs_allocate_loop_seq() when an insert does not supply one and unique per workspace. Gapless in the ordinary case and not promised to be: a transaction that allocates a number and then rolls back takes that number with it, which is the one gap a display counter can afford and a lock-free allocator could not avoid anyway.';
comment on column ouroboros.runs.branch_name is
  'The branch the loop is working on — loop/482-canbus-flake — which the console head renders and R7''s take-over dialog hands to a person as a checkout command. Null until the run has one.';
comment on column ouroboros.runs.workflow_version_pin is
  'The published workflow version this run was pinned to, the 14 of standard-fix v14 (#298). The slug half is workflow_tag; the DSL (§3) defines a pin as that pair, and V032 stores the same pair on a queue item. Null when the workflow had nothing published to pin. A later publish does not move it — that is what makes a closed run answerable for what it actually ran.';
comment on constraint runs_organization_loop_seq_key on ouroboros.runs is
  'One loop number per workspace, once (#298) — and what makes the allocator safe under concurrency rather than merely careful, since two writers that computed the same next number cannot both commit.';

-- ---------------------------------------------------------------------------
-- Allocating the loop number.
--
-- The acceptance criterion is three words — *org-scoped, gapless-enough for display, and
-- concurrent-safe* — and they pull against each other. A PostgreSQL `sequence` is
-- concurrent-safe and neither org-scoped nor gapless. `max(loop_seq) + 1` with no lock is
-- org-scoped and gapless and races: two runs starting in the same millisecond both read
-- 1846 and one of them is refused by the unique key above, which turns a display number into
-- a failed insert.
--
-- So: a transaction-scoped advisory lock keyed on the workspace, then `max + 1`. Concurrent
-- inserts for one workspace serialise on the lock and see each other's numbers; inserts for
-- different workspaces do not contend at all, because the workspace is half the key. The
-- lock is released by commit or rollback with no `unlock` to forget.
--
-- **What is still not gapless, stated rather than implied.** A transaction that allocates
-- 1847 and then rolls back leaves 1847 unused, because the next allocator sees 1846 as the
-- highest *committed* number. That is the gap the criterion says "enough" about: holding it
-- would mean a counter that hands numbers back, and a run that never happened keeping its
-- place in the sequence is worse than a missing number in a caption.
--
-- An insert that supplies its own `loop_seq` is left alone — the development seed does,
-- because mockup 10's head reads `Loop #1847` and a seed that let the allocator choose would
-- render a different number in every database. The unique key still holds it.
-- ---------------------------------------------------------------------------
create function ouroboros.runs_allocate_loop_seq()
returns trigger language plpgsql as $$
declare
  highest integer;
begin
  if new.loop_seq is not null then
    return new;
  end if;

  -- Two keys rather than one: a constant identifying *this* allocator, so the lock cannot
  -- collide with an unrelated advisory lock somewhere else in the application, and the
  -- workspace, so only writers racing for the same counter wait for each other.
  perform pg_advisory_xact_lock(hashtext('ouroboros.runs.loop_seq'),
                                hashtext(new.organization_id));

  select max(loop_seq) into highest
    from ouroboros.runs
   where organization_id = new.organization_id;

  new.loop_seq := coalesce(highest, 0) + 1;

  return new;
end;
$$;

comment on function ouroboros.runs_allocate_loop_seq() is
  'Assigns runs.loop_seq — the Loop #1847 counter — as the workspace''s highest plus one (#298), under a transaction-scoped advisory lock keyed on the workspace so that concurrent inserts serialise instead of colliding on runs_organization_loop_seq_key. An insert that supplies its own number keeps it.';

create trigger runs_allocate_loop_seq
  before insert on ouroboros.runs
  for each row execute function ouroboros.runs_allocate_loop_seq();

-- ---------------------------------------------------------------------------
-- run_stages — one row per stage × attempt.
-- ---------------------------------------------------------------------------
create table ouroboros.run_stages (
  id          uuid        primary key default gen_random_uuid(),

  -- The run this is the history of, and — see the header — the whole of this row's tenancy.
  -- Cascade: a deleted run must not leave a timeline behind describing work nobody can reach.
  run_id      uuid        not null
                          references ouroboros.runs (id) on delete cascade,

  -- **The DSL node id**, which is what makes a stage row nameable by the pinned document:
  -- `implement`, `checks-green`, `open-pr`. Held to the DSL's own node-id shape
  -- (docs/WORKFLOW_DSL.md §4: a slug of at most 64 characters) rather than to "some text",
  -- because a stage key that cannot be a node id is a row that belongs to no workflow.
  --
  -- Not a foreign key, for the reason V008 gives `workflow_tag` (decision F8): the workflow
  -- and the version it came from can be renamed, republished or deleted, and a run that has
  -- already closed must still render its own timeline.
  stage_key   text        not null,

  -- The label as the pinned version titled it — `Implement`, `Open PR`. A **snapshot**: the
  -- stepper of a run performed in March must read the way it read in March, and a workflow
  -- renaming its node in April changes what the next run records and nothing else.
  stage_label text        not null,

  -- Where the stage sits in the pinned workflow, from 1. What orders the stepper, and what
  -- `run_stage_current` ranks to derive the `4/8` meter. Dense-from-1 is the writer's
  -- convention and not a rule here: a `decision` node forks, so which stages a particular run
  -- materialises is a property of the path it took.
  "position"  integer     not null,

  -- Which try this is, from 1. Unique with the run and the stage key, so a retry is a new row
  -- rather than an overwrite — which is the whole point: `attempt 2/3` is only answerable by a
  -- table that still holds attempt 1.
  attempt     integer     not null default 1,

  -- Where this attempt is. Five words, and the stepper's three treatments come from them:
  -- `succeeded` is `✓` with a duration, `active` is `●`, and `pending` is `○`. `failed` is an
  -- attempt that ended badly — usually superseded by the next attempt of the same stage, which
  -- is why it is not drawn — and `skipped` is a stage the path went around.
  status      text        not null default 'pending',

  -- **The two timestamps a duration is computed from, and there is no third column holding
  -- the answer.** `0m 04s`, `1m 12s`, `2m 05s` on the mockup are `finished_at - started_at`,
  -- rendered. A stored duration would be a third place for the same fact to live and the
  -- only one of the three that can be wrong without contradicting anything.
  started_at  timestamptz,
  finished_at timestamptz,

  -- **The `/3` of `attempt 2/3`** — how many attempts the pinned workflow allows this stage,
  -- snapshotted at pin time. The DSL stores `limits.max_retries` (§4.2, an integer 0–10), and
  -- an allowance of *n retries* is *n + 1 attempts*: the mockup's stage has `max_retries: 2`
  -- and prints `2/3`. Stored as the total rather than as the retry count because the total is
  -- the number rendered, and re-deriving it on every render is a `+ 1` waiting to be dropped.
  --
  -- Null for a stage with no limits to snapshot: only `llm` nodes carry a `limits` object, so
  -- `Queued` (a `trigger`) and `Open PR` (a `term`) have no allowance and render no `/n`.
  max_attempts integer,

  -- The stage's token allowance at pin time — the DSL's `limits.token_budget` (§4.2), the
  -- `400k` of the Resources card's `212k / 400k budget` meter. Snapshotted here beside
  -- `max_attempts` for the same reason and with the same nullability, and read by AO.3/R8's
  -- resource arithmetic rather than by anything in this migration.
  token_budget integer,

  -- --- the transition that created this row -----------------------------------
  --
  -- All three null, or all three set. Set is *"a loop edge brought the run back here"*, which
  -- is the only thing the stepper has a note for, and `note` below is the sentence they
  -- compose. See decision R1 in the header for why they are columns rather than the sentence.

  -- The node the loop edge left from — `checks-green` in the DSL's own example. Same shape as
  -- `stage_key`, and not a foreign key for the same reason.
  returned_from_stage_key text,

  -- What kind of node that was, in the DSL's vocabulary with `flow` resolved into the two
  -- words §4.4 gives it. `gate` is the word the note prints.
  returned_from_kind      text,

  -- How the previous attempt ended. Closed, because `note` maps each word to a phrase and a
  -- word with no phrase would compose a sentence with a hole in it.
  return_reason           text,

  -- **The stepper's warn note, and nothing may write it.** `generated always … stored`, so
  -- PostgreSQL refuses any insert or update that supplies a value — from any client, in any
  -- role, including the owner. Decision R1 in one column definition.
  --
  -- Null when there was no transition to describe, which is every row of an ordinary
  -- first-attempt timeline.
  note text generated always as (
    case
      when return_reason is null then null
      else 'attempt ' || (attempt - 1)::text || ' '
           || case return_reason
                when 'failed_tests'     then 'failed tests'
                when 'failed_build'     then 'failed the build'
                when 'failed_checks'    then 'failed checks'
                when 'failed_review'    then 'failed review'
                when 'gate_rejected'    then 'was turned back'
                when 'budget_exhausted' then 'ran out of token budget'
                when 'timed_out'        then 'timed out'
                when 'errored'          then 'ended in an error'
              end
           || ' — loop returned from ' || returned_from_kind || ' ↺'
    end
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- --- one row per stage per attempt ------------------------------------------
  --
  -- Acceptance criterion, and the key the whole table is for: a second `implement` attempt 2
  -- is refused, so a retry cannot be recorded twice and a redelivered ingestion message is an
  -- upsert rather than a duplicate step in the stepper.
  constraint run_stages_run_stage_attempt_key unique (run_id, stage_key, attempt),

  -- --- the shapes ---------------------------------------------------------------
  constraint run_stages_stage_key_slug
    check (stage_key ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' and length(stage_key) <= 64),
  constraint run_stages_stage_label_present
    check (btrim(stage_label) <> '' and length(stage_label) <= 120),
  constraint run_stages_position_positive check ("position" >= 1),
  constraint run_stages_attempt_positive  check (attempt >= 1),

  constraint run_stages_status
    check (status in ('pending', 'active', 'succeeded', 'failed', 'skipped')),

  -- --- the clock says the same thing the status does ----------------------------
  --
  -- A duration is computed, so the pair of timestamps has to mean the same thing in every row
  -- that has one. `pending` has not begun; `active` has begun and not ended; `succeeded` and
  -- `failed` have both, which is what makes `finished_at - started_at` total over exactly the
  -- rows the stepper prints a duration for. `skipped` never ran — it may record *when* the
  -- path went around it, and it can have no start, so it can have no duration to render.
  constraint run_stages_clock
    check (case status
             when 'pending' then started_at is null and finished_at is null
             when 'active'  then started_at is not null and finished_at is null
             when 'skipped' then started_at is null
             else                started_at is not null and finished_at is not null
           end),

  -- A stage cannot finish before it started — the one arithmetic error that renders as a
  -- negative duration in the stepper's caption.
  constraint run_stages_finished_after_started
    check (finished_at is null or started_at is null or finished_at >= started_at),

  -- --- the snapshots are the DSL's numbers --------------------------------------
  --
  -- `limits.max_retries` is 0–10, so a total allowance is 1–11; `limits.token_budget` is
  -- 1 000–10 000 000. Mirrored rather than left open so that a snapshot which could not have
  -- come from a valid document is refused where it is written instead of rendering as a
  -- meter nobody can explain.
  constraint run_stages_max_attempts_range
    check (max_attempts is null or max_attempts between 1 and 11),
  constraint run_stages_token_budget_range
    check (token_budget is null or token_budget between 1000 and 10000000),

  -- `attempt 4/3` is not a thing a stepper can draw.
  constraint run_stages_attempt_within_max
    check (max_attempts is null or attempt <= max_attempts),

  -- --- the transition is whole, or absent ---------------------------------------
  --
  -- `note` reads all three, so two of three would compose a sentence naming a `null`. Stated
  -- as two equalities rather than one three-way `and`, so a rejection says which half is
  -- missing.
  constraint run_stages_return_complete
    check ((return_reason is null) = (returned_from_stage_key is null)
           and (return_reason is null) = (returned_from_kind is null)),

  constraint run_stages_return_reason
    check (return_reason is null
           or return_reason in ('failed_tests', 'failed_build', 'failed_checks',
                                'failed_review', 'gate_rejected', 'budget_exhausted',
                                'timed_out', 'errored')),

  constraint run_stages_returned_from_kind
    check (returned_from_kind is null
           or returned_from_kind in ('trigger', 'llm', 'infra', 'gate', 'decision', 'term')),

  constraint run_stages_returned_from_stage_key_slug
    check (returned_from_stage_key is null
           or (returned_from_stage_key ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
               and length(returned_from_stage_key) <= 64)),

  -- The note opens `attempt N−1`, so a first attempt cannot have been returned to: there is no
  -- attempt 0 for a gate to have failed. This is what stops the sentence reading
  -- *"attempt 0 failed tests"*.
  constraint run_stages_return_is_a_retry
    check (return_reason is null or attempt >= 2)
);

comment on table ouroboros.run_stages is
  'One run of one workflow stage, one row per attempt (#298, AO.1, decision R1) — the stage timeline mockup 10 draws and the history V008''s three current-stage columns on runs cannot hold. Durations are computed from started_at/finished_at and stored nowhere; attempt counts are rows; and the stepper''s warn note is a generated column over the transition that created the row, so no writer can type one.';
comment on column ouroboros.run_stages.run_id is
  'The run this is the history of, and the whole of this row''s tenancy — V029''s choice: a stage has no meaning apart from its run and every read enters through one. ON DELETE CASCADE.';
comment on column ouroboros.run_stages.stage_key is
  'The pinned workflow''s DSL node id (docs/WORKFLOW_DSL.md §4) — implement, checks-green. Held to the node-id slug shape, and deliberately not a foreign key: a closed run must still render its timeline under a workflow that has since been renamed, republished or deleted (V008 decision F8).';
comment on column ouroboros.run_stages.stage_label is
  'The node title as the pinned version had it — a snapshot, so a run performed in March still reads the way it read in March.';
comment on column ouroboros.run_stages."position" is
  'Order within the pinned workflow, from 1. What orders the stepper and what run_stage_current ranks to derive the 4/8 meter. Density is the writer''s convention: a decision node forks, so which stages a run materialises depends on the path it took.';
comment on column ouroboros.run_stages.attempt is
  'Which try this is, from 1 — the 2 of attempt 2/3. A retry is a new row rather than an overwrite, which is what makes the prior attempt still answerable.';
comment on column ouroboros.run_stages.status is
  'pending | active | succeeded | failed | skipped — the stepper''s ○, ●, ✓ and the two it does not draw. Held with the clock by run_stages_clock.';
comment on column ouroboros.run_stages.started_at is
  'When this attempt began. Half of the computed duration; there is no duration column to drift from it.';
comment on column ouroboros.run_stages.finished_at is
  'When this attempt ended. Null while it has not (run_stages_clock), and never earlier than started_at.';
comment on column ouroboros.run_stages.max_attempts is
  'The /3 of attempt 2/3 — the DSL''s limits.max_retries plus one, snapshotted at pin time (#298). Total attempts rather than retries because the total is the number rendered. Null for a stage type that carries no limits object, which is every node that is not an llm.';
comment on column ouroboros.run_stages.token_budget is
  'The stage''s limits.token_budget at pin time — the 400k of the Resources card''s 212k / 400k meter. Snapshotted beside max_attempts and read by AO.3/R8''s resource arithmetic (#300).';
comment on column ouroboros.run_stages.returned_from_stage_key is
  'The DSL node id a loop edge brought the run back from (#298) — checks-green in the DSL''s own example. One of the three transition columns note is composed from; all three are set together or none is.';
comment on column ouroboros.run_stages.returned_from_kind is
  'What kind of node that was, in the DSL''s vocabulary with flow resolved into gate and decision (§4.4). The word the note prints: "loop returned from gate".';
comment on column ouroboros.run_stages.return_reason is
  'How the previous attempt ended, from a closed set. Closed because note maps each word to a phrase, and a word with no phrase would compose a sentence with a hole in it.';
comment on column ouroboros.run_stages.note is
  'The stepper''s warn note — "attempt 1 failed tests — loop returned from gate ↺" — GENERATED ALWAYS … STORED from attempt and the three transition columns (#298, decision R1). PostgreSQL refuses any statement that supplies a value, from any client in any role, which is what makes "machine-composed, never copy" a property of the schema rather than a promise of a service. Null when there was no transition to describe.';
comment on constraint run_stages_run_stage_attempt_key on ouroboros.run_stages is
  'One row per stage per attempt (#298). A redelivered ingestion message is an upsert rather than a second step in the stepper.';
comment on constraint run_stages_clock on ouroboros.run_stages is
  'The clock agrees with the status (#298): pending has neither timestamp, active has a start and no finish, succeeded and failed have both, and skipped has no start — so a computed duration exists for exactly the rows the stepper prints one for.';
comment on constraint run_stages_return_is_a_retry on ouroboros.run_stages is
  'A returned-to row is a retry (#298). The note opens "attempt N−1", and there is no attempt 0 for a gate to have failed.';

-- ---------------------------------------------------------------------------
-- Indexes.
-- ---------------------------------------------------------------------------

-- The stepper's own read, and the cascade's: every stage of one run, in the order it draws
-- them, newest attempt of each stage last.
--
--   select … from ouroboros.run_stages where run_id = $1 order by "position", attempt
--
-- Leading `run_id` because there is no question here that is not about one run — see the
-- header on why there is no `organization_id` to lead with — which also makes this the index
-- the `runs` cascade needs, so no second one is created for it.
create index run_stages_run_position_attempt_idx
  on ouroboros.run_stages (run_id, "position", attempt);

comment on index ouroboros.run_stages_run_position_attempt_idx is
  'The stepper''s read — one run''s stages in drawing order (#298) — and the index the runs cascade deletes through, which is why there is no separate one on run_id.';

-- **One stage is active at a time.**
--
-- The loop walks its graph; the DSL has no fork-join, a `decision` diverges rather than
-- parallelises (§4.4), and the stepper draws exactly one `●`. Enforcing it here is what makes
-- *"the current stage"* a total function rather than a tie-break: `run_stage_current` below
-- picks the active row, and with this index there is never more than one to pick from.
--
-- Partial, so it costs nothing on the rows that are not active — which, on a finished run, is
-- every row.
create unique index run_stages_one_active_idx
  on ouroboros.run_stages (run_id)
  where status = 'active';

comment on index ouroboros.run_stages_one_active_idx is
  'At most one active stage per run (#298). The loop walks its graph and the DSL has no fork-join, so two active stages are a writer''s mistake rather than a shape this schema has to resolve — which is what lets run_stage_current name *the* current stage instead of choosing between candidates.';

-- ---------------------------------------------------------------------------
-- Attempts are dense, and a retry follows an attempt that ended.
--
-- `attempt 2/3` is a claim about attempt 1 — that it happened and that it is over. Without
-- this, attempt 2 could be the only row of its stage and the caption would be counting
-- something that never existed; or attempt 2 could start while attempt 1 is still `active`,
-- which is two tries of one stage running at once and not a retry at all.
--
-- A CHECK cannot say either: both read a different row. Fires on the columns that decide
-- which previous row this one claims, and on nothing else — a status changing on *this* row
-- is not a statement about the one before it.
-- ---------------------------------------------------------------------------
create function ouroboros.run_stages_attempt_sequence()
returns trigger language plpgsql as $$
declare
  previous text;
begin
  if new.attempt = 1 then
    return new;
  end if;

  select status into previous
    from ouroboros.run_stages
   where run_id = new.run_id
     and stage_key = new.stage_key
     and attempt = new.attempt - 1;

  if previous is null then
    raise exception
      'stage % of run % has no attempt %, so it cannot have attempt %',
      new.stage_key, new.run_id, new.attempt - 1, new.attempt
      using errcode = 'check_violation', constraint = 'run_stages_attempt_sequence';
  end if;

  if previous in ('pending', 'active') then
    raise exception
      'attempt % of stage % of run % is still %, so attempt % cannot begin',
      new.attempt - 1, new.stage_key, new.run_id, previous, new.attempt
      using errcode = 'check_violation', constraint = 'run_stages_attempt_sequence';
  end if;

  return new;
end;
$$;

comment on function ouroboros.run_stages_attempt_sequence() is
  'Refuses an attempt whose predecessor does not exist or has not ended (#298). attempt 2/3 is a claim about attempt 1 — that it happened, and that it is over — and both facts live in a different row than the one being written, which is why this is a trigger and not a CHECK.';

create trigger run_stages_attempt_sequence
  before insert or update of run_id, stage_key, attempt on ouroboros.run_stages
  for each row execute function ouroboros.run_stages_attempt_sequence();

create trigger run_stages_touch_updated_at
  before update on ouroboros.run_stages
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- run_stage_current — where a run is, derived.
--
-- One row per run that has any stage history: the stage a reader means by *"the current
-- stage"*, with the `4/8` meter computed beside it.
--
-- **Which row that is.** The active one, if there is one — and `run_stages_one_active_idx`
-- says there is at most one. Otherwise the stage the run got furthest into, which is the
-- right answer for a finished run (it rests at its last stage) and for a failed one (it rests
-- where it stopped, not at the pending stage after it). Otherwise — nothing has started —
-- the first stage, so a run that has been pinned but has not begun captions its `0/8` meter
-- with the stage it is about to enter rather than with the last one it will never reach.
--
-- The third sort key is what says those last two sentences: for a row that has started, the
-- *highest* position wins, and for a row that has not, the *lowest*. Negating one of them is
-- how a single `order by` holds both.
--
-- **The meter.** `stage_total` counts the distinct stages this run materialised, and
-- `stage_index` counts the ones it has entered — which is why a run that has started and
-- entered nothing is `0/8` rather than `1/8`, exactly as V008's `runs_stage_index_in_range`
-- allows. Distinct stage keys rather than rows, so three attempts at `implement` advance the
-- meter once.
-- ---------------------------------------------------------------------------
create view ouroboros.run_stage_current as
select picked.run_id,
       picked.id      as run_stage_id,
       picked.stage_key,
       picked.stage_label,
       picked."position",
       picked.attempt,
       picked.max_attempts,
       picked.token_budget,
       picked.status,
       picked.note,
       picked.started_at,
       picked.finished_at,
       totals.stage_index,
       totals.stage_total
  from (select stage.*,
               row_number() over (
                 partition by stage.run_id
                 order by (stage.status = 'active')     desc,
                          (stage.started_at is not null) desc,
                          case when stage.started_at is null
                               then  stage."position"
                               else -stage."position"
                          end,
                          stage.attempt desc
               ) as pick
          from ouroboros.run_stages stage) picked
  join (select run_id,
               count(distinct stage_key)
                 filter (where started_at is not null)::integer as stage_index,
               count(distinct stage_key)::integer               as stage_total
          from ouroboros.run_stages
         group by run_id) totals on totals.run_id = picked.run_id
 where picked.pick = 1;

comment on view ouroboros.run_stage_current is
  'Where each run with stage history is, derived (#298): the active stage if there is one, else the furthest it got into, else the one it is about to enter — with stage_index (distinct stages entered) and stage_total (distinct stages materialised) computed beside it. The console''s stepper head and the source runs_with_stage resolves the dashboard''s meter from.';

-- ---------------------------------------------------------------------------
-- runs_with_stage — the dashboard amendment, as a view.
--
-- Every column of `runs`, with the three stage-meter columns answered from stage history
-- where a run has any and from the legacy columns where it has none. A read moves from
-- `runs` to this by changing one word, and reads identically for every run written before
-- this migration — which is what "the dashboard is never mid-air" means in practice, and why
-- V008's three columns are still there to fall back to.
--
-- Filed as the amendment on #64. When the DASH read paths have moved and nothing selects the
-- legacy columns any more, a later migration drops them and this view's `coalesce` with them.
-- ---------------------------------------------------------------------------
create view ouroboros.runs_with_stage as
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
       run.workflow_version_pin
  from ouroboros.runs run
  left join ouroboros.run_stage_current current_stage
    on current_stage.run_id = run.id;

comment on view ouroboros.runs_with_stage is
  'runs, with the stage meter resolved from stage history (#298, the amendment on #64). Identical to runs for a run with no run_stages rows, which is what lets a read move over one at a time and what keeps mockup 02 rendering while the legacy columns are still on the table. Their removal is a later migration.';
