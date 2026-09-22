-- V049__run_ingest_receipts.sql — what the ingestion contract has to remember *between*
-- requests: which submissions it has already answered, how far an executor's own clock had
-- got, and which report of a change-set a guardrail verdict judged.
--
-- AP.1 (issue #303, docs/ROADMAP_MOCKUP_10_RUN_CONSOLE.md, decision **R2**) is the one
-- internal contract every executor reports through — the simulated driver (AP.5, #307)
-- today and real execution (AR.1, #315) tomorrow. Everything it writes already has a table:
-- V045's `run_stages`, V046's `run_events`, V047's `run_files` and `run_commits`, V048's
-- `guardrail_evaluations`, V010's `token_usage`. What none of them has is a memory of the
-- *request* that wrote them, and three of the ticket's acceptance criteria are about
-- requests rather than about rows:
--
--   * *Replaying any write with the same idempotency key is a no-op that returns the
--     original result.*
--   * *Interleaved batches from concurrent posts produce a dense, correctly ordered `seq`
--     with no gaps and no duplicates.*
--   * *A file report triggers guardrail evaluation; a run with no file changes triggers
--     none.*
--
-- Three columns' worth of state, in one table and two columns on `runs`.
--
--
-- Why a receipt rather than a natural key.
-- ---------------------------------------------------------------------------
--
-- The schema's habit until now is natural-key idempotency: V040's log chunks collide on
-- `(job_id, seq)`, V042's terminal frames on the agent's envelope id, V048's controls on
-- `(run_id, idempotency_key)`. Each of those works because the write is *one row whose
-- identity the caller already supplies*, so a redelivery collides with itself and
-- `on conflict do nothing` is the whole of the mechanism.
--
-- Four of AP.1's six operations are not that shape:
--
--   * **Opening a run** has no natural key at all. Two `POST /internal/runs` are two runs,
--     two `loop_seq` allocations and two rows in mockup 02's *Active loops* — and a retry
--     after a lost response is exactly how that happens.
--   * **A stage transition** *moves* a row that already exists: `run_stages` is keyed
--     `(run_id, stage_key, attempt)` and a transition's job is to change that row's
--     `status` and clocks. A replay collides with a row it was going to write to anyway,
--     so the collision says nothing about whether this submission was seen before.
--   * **An event batch** is many rows whose identity the *server* assigns — V046's
--     `run_events_append()` allocates `seq` densely, which is what makes a caller-supplied
--     key impossible by construction.
--   * **A change-set report** is a `PUT`: it is idempotent in its effect on `run_files` and
--     emphatically not in its effect on anything downstream, because every report is a
--     report and AP.3's evaluation is triggered by one.
--
-- So the contract records the **request**: the operation, the caller's key, a digest of
-- what they sent, and the answer they were given. A replay returns the stored answer
-- without touching a row; a key reused with a *different* body is refused rather than
-- silently answered with the first body's result, which is the failure mode a stored
-- response introduces and the digest is what closes.
--
-- Commits keep their natural key as well — `run_commits_run_sha_key`, which the issue names
-- ("Append, sha-idempotent") — and the receipt sits above it. The two are not redundant:
-- the natural key makes a *re-reported commit* a no-op whatever request it arrives in, and
-- the receipt makes a *re-sent request* a no-op whatever commits it names.
--
--
-- The executor's clock, and why the server keeps a copy.
-- ---------------------------------------------------------------------------
--
-- `runs.event_hint` is the highest ordering hint this run has accepted. The issue:
--
-- > events carry an executor-side monotonic hint; the server assigns authoritative `seq`
-- > and rejects out-of-order batches with a reason rather than silently reordering.
--
-- Both halves need a number kept here. `run_events.seq` is the *server's* order and is
-- assigned on arrival, so it can never disagree with itself — which means it also cannot
-- detect that two concurrent posts arrived in the wrong order. The hint can: it is the
-- executor's own monotonic counter, and a batch whose first hint is not above everything
-- already accepted is a batch that overtook another one in flight.
--
-- Rejecting is the point. An ingestion path that sorted the batch into place would have to
-- renumber a dense sequence AP.2's `?after=` pages by — a transcript that changes under a
-- reader's cursor — and one that appended anyway would produce a transcript whose `seq`
-- order and whose clock disagree. Neither is recoverable; a `409` with the two numbers in
-- it is, because the executor still holds the batch.
--
-- It is a column on `runs` for V046's reason, stated there about `event_seq`: the check has
-- to happen under the same lock as the append, and the run's row is the row the append
-- already takes.
--
--
-- `change_set_seq` — the number V048 left for this migration to allocate.
-- ---------------------------------------------------------------------------
--
-- `guardrail_evaluations.change_set_seq` is documented as *"which report of the change-set
-- was judged — the report's own number, so re-evaluation history reads as a sequence rather
-- than a pile"*. V048 stores it and allocates nothing, because which reports exist is the
-- ingestion contract's question. `runs.change_set_seq` is the counter it is allocated from:
-- one per accepted `PUT /internal/runs/:id/files`, from 1.
--
-- A run that has never reported a change-set stands at `0`, and that is the schema half of
-- the acceptance criterion *"a run with no file changes triggers none"*: there is no report
-- number to evaluate under, because there was no report.

-- ---------------------------------------------------------------------------
-- `runs` gains the two counters the contract advances.
--
-- Both `not null default 0`, both non-negative, and both moved only by the ingestion path.
-- Defaults rather than nullable because *"this run has accepted no hint yet"* and *"this
-- run has reported no change-set yet"* are `0` rather than an absence — every comparison
-- below is an inequality, and an inequality against null is null.
-- ---------------------------------------------------------------------------
alter table ouroboros.runs
  add column event_hint     integer not null default 0,
  add column change_set_seq integer not null default 0;

alter table ouroboros.runs
  add constraint runs_event_hint_non_negative     check (event_hint >= 0),
  add constraint runs_change_set_seq_non_negative check (change_set_seq >= 0);

comment on column ouroboros.runs.event_hint is
  'The highest executor-side ordering hint this run has accepted (#303, AP.1). run_events.seq is the server''s order and is assigned on arrival, so it cannot notice that two concurrent batches arrived in the wrong order; this can, because it is the executor''s own monotonic counter. A batch whose first hint does not exceed it is refused with both numbers rather than reordered — renumbering a dense sequence AP.2 pages by would change the transcript under a reader''s cursor. On runs for V046''s reason: the check happens under the lock the append already takes.';
comment on column ouroboros.runs.change_set_seq is
  'How many times this run has reported its change-set (#303, AP.1) — the counter guardrail_evaluations.change_set_seq is allocated from, which V048 stores and deliberately does not assign. From 1 on the first accepted PUT /internal/runs/:id/files. A run standing at 0 has reported nothing, which is the schema half of "a run with no file changes triggers no evaluation".';

-- ---------------------------------------------------------------------------
-- `runs_with_stage` carries the two new columns too.
--
-- V045's amendment on #64 is *"a read moves from `runs` to this view by changing one word"*,
-- and that is only true while the two have the same columns — V046 added its six for that
-- reason and V047 its two. Two more, at the end, which is what `create or replace view`
-- allows and what keeps every existing read working through the replacement.
--
-- Neither is a number the console renders. They are here because the invariant is *the same
-- shape*, not *the useful columns*: `ouroboros-rest`'s mirror asserts the two row types are
-- assignable to each other, so a column on `runs` that is not in the view is a compile error
-- in the service rather than a read that quietly answers without it.
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
       run.reserved_build_job_id,
       run.event_hint,
       run.change_set_seq
  from ouroboros.runs run
  left join ouroboros.run_stage_current current_stage
    on current_stage.run_id = run.id;

comment on view ouroboros.runs_with_stage is
  'runs, with the stage meter resolved from stage history (#298, the amendment on #64, extended by #299, #300 and #303). Identical to runs for a run with no run_stages rows, which is what lets a read move over one at a time and what keeps mockup 02 rendering while the legacy columns are still on the table. Their removal is a later migration.';

-- ---------------------------------------------------------------------------
-- run_ingest_receipts — one row per answered submission.
--
-- The scope is `(organization_id, operation, idempotency_key)` rather than
-- `(run_id, …)`, and the reason is the one operation that has no run when its key is
-- checked. A replayed `POST /internal/runs` must collide with the *first* create, and the
-- first create's run id is precisely what the replay does not know — it is what the replay
-- is asking for. Keying by run would give every create a key that collides with nothing.
--
-- `run_id` is still here and still `not null`: by the time a receipt is written the run
-- exists, even for a create, because the whole operation is one transaction. What it buys
-- is the cascade — a deleted run takes its receipts with it, so the ledger cannot outlive
-- the rows it describes — and the ability to answer *"what did this run's executor send?"*
-- from one table.
-- ---------------------------------------------------------------------------
create table ouroboros.run_ingest_receipts (
  id              uuid        primary key default gen_random_uuid(),

  -- The workspace, which is what the key is unique within. Resolved by the contract from a
  -- row the caller named — the ticket a run is opened for, or the run itself — and never
  -- from a field of the request, which is AD.3's rule for this whole channel: a worker
  -- naming its own workspace is a worker choosing whose ledger to write into.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The run this submission was about. Held to the same workspace as organization_id by
  -- run_in_organization() at the foot of this file — V010's trigger, second user.
  run_id          uuid        not null
                              references ouroboros.runs (id) on delete cascade,

  -- Which of the six operations. Part of the key, so an executor that numbers its
  -- submissions from one per kind — which is the obvious thing to do — does not have its
  -- first event batch answered with its first stage transition's result.
  operation       text        not null,

  -- The caller's name for this submission. Required and with no default, unlike V048's
  -- run_controls.idempotency_key: a control may legitimately be a one-off a human pressed,
  -- and an executor's report is always a thing that can be redelivered.
  idempotency_key text        not null,

  -- SHA-256 of the canonical request, lower-case hex. What makes a stored response safe:
  -- without it, a caller that reused a key for a different report would be answered with
  -- the earlier report's result and would have no way to find out. With it that request is
  -- refused, which is recoverable — the caller still holds the report.
  request_digest  text        not null,

  -- The answer, exactly as it was first given. Returned verbatim on a replay, so a retry
  -- after a lost response yields the run id, the sequence numbers or the change-set number
  -- the first attempt was told about rather than a second set.
  response        jsonb       not null,

  created_at      timestamptz not null default now(),

  -- --- the key ----------------------------------------------------------------
  constraint run_ingest_receipts_scope_key
    unique (organization_id, operation, idempotency_key),

  -- --- the vocabulary ---------------------------------------------------------
  --
  -- Closed, and closed the way V046's actor set is: these are the six operations the
  -- internal contract publishes, and a seventh is an edit to openapi.internal.yaml, to this
  -- list and to tests/constraints.sql in one change. A free-text operation column would
  -- make a typo in a service a silently separate idempotency namespace.
  constraint run_ingest_receipts_operation
    check (operation in ('run.create',
                         'run.stage_transition',
                         'run.events',
                         'run.files',
                         'run.commits',
                         'run.resources')),

  -- --- the strings ------------------------------------------------------------
  --
  -- The same bound and the same shape as run_controls.idempotency_key (V048), because the
  -- two are the same kind of thing and a caller should not have to hold two rules.
  constraint run_ingest_receipts_idempotency_key_shape
    check (btrim(idempotency_key) = idempotency_key
           and idempotency_key <> ''
           and length(idempotency_key) <= 128),

  -- A digest is a digest. Sixty-four lower-case hex characters or it is not one, which
  -- keeps a service that forgot to hash from writing a request body into this column.
  constraint run_ingest_receipts_request_digest_shape
    check (request_digest ~ '^[0-9a-f]{64}$'),

  -- --- the response -----------------------------------------------------------
  --
  -- An object, because every operation's result is one and a replay hands this value
  -- straight back as the response body. A bare string or array stored here would be a
  -- response shape no version of the contract ever published.
  constraint run_ingest_receipts_response_is_an_object
    check (jsonb_typeof(response) = 'object')
);

comment on table ouroboros.run_ingest_receipts is
  'One row per answered ingestion submission (#303, AP.1) — the ledger behind "replaying any write with the same idempotency key is a no-op that returns the original result". A receipt rather than a natural key because four of the six operations have no key a caller could supply: opening a run has no natural identity, a stage transition moves a row that already exists, an event batch is numbered by the server, and a change-set report is idempotent in its rows and not in the evaluation it triggers. request_digest is what makes a stored response safe — a key reused with a different body is refused rather than answered with the first body''s result.';
comment on column ouroboros.run_ingest_receipts.organization_id is
  'The workspace the key is unique within (#303). Resolved by the contract from a row the caller named — the ticket a run opens for, or the run itself — never from a field of the request, which is AD.3''s rule for the whole internal channel.';
comment on column ouroboros.run_ingest_receipts.run_id is
  'The run this submission was about (#303). Not part of the key: a replayed create must collide with the first create, whose run id is exactly what the replay is asking for. What it buys is the cascade and the ability to read one run''s submissions from one table.';
comment on column ouroboros.run_ingest_receipts.operation is
  'Which of the six published operations (#303) — part of the key, so an executor numbering its submissions from one per kind does not have its first event batch answered with its first stage transition''s result.';
comment on column ouroboros.run_ingest_receipts.idempotency_key is
  'The caller''s name for this submission (#303). Required and undefaulted, unlike run_controls.idempotency_key (V048): a control may be a one-off a human pressed, and an executor''s report is always a thing that can be redelivered.';
comment on column ouroboros.run_ingest_receipts.request_digest is
  'SHA-256 of the canonical request, lower-case hex (#303). Without it a caller that reused a key for a different report would be answered with the earlier report''s result and could not find out; with it that request is refused, which is recoverable because the caller still holds the report.';
comment on column ouroboros.run_ingest_receipts.response is
  'The answer exactly as it was first given (#303), returned verbatim on a replay — so a retry after a lost response yields the run id, the sequence numbers or the change-set number the first attempt was told about rather than a second set.';
comment on constraint run_ingest_receipts_scope_key on ouroboros.run_ingest_receipts is
  'One answer per key per operation per workspace (#303). Scoped by workspace rather than by run because run.create''s key is checked before its run exists.';
comment on constraint run_ingest_receipts_operation on ouroboros.run_ingest_receipts is
  'The six operations openapi.internal.yaml publishes (#303). Closed, so a typo in a service is a refused write rather than a silently separate idempotency namespace.';

-- The cascade's index, and the read behind "what did this run's executor send?". The unique
-- key above leads with organization_id, so it cannot serve either.
create index run_ingest_receipts_run_idx
  on ouroboros.run_ingest_receipts (run_id, created_at desc);

comment on index ouroboros.run_ingest_receipts_run_idx is
  'One run''s submissions, newest first (#303) — and the index the runs cascade deletes through, which is why there is no second index on run_id alone.';

-- V010's trigger, second user after `token_usage`: a receipt naming a run in another
-- workspace would be a receipt filed in a ledger it does not belong to, and the unique key
-- is per workspace — so the two columns disagreeing would put two workspaces' keys into one
-- namespace.
create trigger run_ingest_receipts_run_in_organization
  before insert or update of organization_id, run_id on ouroboros.run_ingest_receipts
  for each row execute function ouroboros.run_in_organization();

-- ---------------------------------------------------------------------------
-- Grants.
--
-- V022's block, for V022's reason: `ouroboros_app` is the role a deployment that separates
-- *migrating* from *running* connects the API as.
--
--   * **`run_ingest_receipts` is append-only to the application.** A receipt records what a
--     caller was told, and a replay's whole guarantee is that it gets *that* answer back —
--     so `update` would only ever be used to make a receipt say something the caller was
--     never told. A submission that should have answered differently is a new key.
--   * **It may not be deleted.** A receipt removed is a replay that suddenly does the work
--     again. Rows leave with their run.
--   * **`runs` needs no new grant.** The two counters are columns on a table the application
--     already writes; V008's grants cover them, which is half of why they are columns.
--
-- The `revoke`s are no-ops today, because `create table` grants nothing to anybody but the
-- owner, and that is exactly why they are written: a later migration that hands this table
-- `all privileges` should have to delete a line to do it.
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert on ouroboros.run_ingest_receipts to ouroboros_app;

revoke update, delete on ouroboros.run_ingest_receipts from ouroboros_app;
revoke update, delete on ouroboros.run_ingest_receipts from public;
