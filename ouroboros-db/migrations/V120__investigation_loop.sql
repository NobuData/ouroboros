-- V120__investigation_loop.sql — the investigation loop's durable state: its checkpoint, the cancel
-- a person asked for, the reason a run failed, the model usage it paid for and the deliverable
-- inputs its playbook produced (#620, CM.1).
--
-- V106 gave an investigation a lifecycle and V108 a ledger. The loop that moves one through the
-- other runs in the engine, for minutes, and spends real money — so three things have to outlive
-- the process running it:
--
--   1. **`investigation_loops`** — one row per investigation the loop has started: the loop
--      version, the **attempt** (1, then 2 after a restart), the **checkpoint** the engine wrote
--      after its last step, the working time so far, a **cancel request**, and — once failed —
--      the **failure reason**. A restarted worker resumes from the checkpoint instead of paying
--      twice; a cancel is read back with every checkpoint write, so it is honoured between
--      operations.
--   2. **`investigation_usage`** — one row per model call the loop made, exactly as the
--      invocation gateway reported it (hop, connection, model, tokens, cost). `actuals.spend_cents`
--      is **computed from these rows** by `investigation_spend_cents()`, so the figure on the
--      card and the rows behind it cannot disagree.
--   3. **`investigation_deliverable_inputs`** — what the kind's playbook produced besides the
--      brief: matrix rows for a gap analysis, the roadmap-doc input, the fix-draft input. They are
--      *inputs*: CM.2 (#621) builds the matrix, CM.5 (#624) the roadmap doc, and the fix draft is
--      the watch chain's (#623).
--   4. **`brief_claims.demoted`** — whether an open question was offered by synthesis as a
--      finding and could not point at a ledger record (decision V3's demotion, on the record
--      rather than only in a log).
--
-- ---------------------------------------------------------------------------
-- One writer at a time
-- ---------------------------------------------------------------------------
--
-- A re-dispatched investigation may briefly have two workers: the one that was presumed dead and
-- the one that replaced it. `attempt` rises on every (re)start and `checkpoint_seq` on every
-- write, and `investigation_loops_checkpoint_forward` refuses a write that moves either
-- backwards — the older worker's next checkpoint fails, and it stops.
--
-- ---------------------------------------------------------------------------
-- A failure is designed, and keeps what was paid for
-- ---------------------------------------------------------------------------
--
--   tool_exhaustion    the tools returned nothing citable
--   budget_breach      the spend ceiling was reached
--   synthesis_failure  the model could not be reached, or answered nothing usable
--   engine_error       the loop itself broke, or was restarted too many times
--
-- A reason is recorded exactly when the investigation is `failed` by the loop
-- (`investigation_loops_failure_when_failed`). Nothing is deleted on the way: the ledger, the
-- checkpoint, the usage rows and the actuals of a failed or cancelled investigation all stay.
--
-- Revert forward:
--   alter table ouroboros.brief_claims drop column demoted;
--   drop table ouroboros.investigation_deliverable_inputs, ouroboros.investigation_usage,
--              ouroboros.investigation_loops;
--   then drop every function this file creates.

-- ---------------------------------------------------------------------------
-- investigation_loops — one row per investigation the loop has started.
-- ---------------------------------------------------------------------------
create table ouroboros.investigation_loops (
  investigation_id    uuid        primary key
                                  references ouroboros.investigations (id) on delete cascade,

  -- The researcher that runs it — provenance's `researcher`.
  loop_version        text        not null
                                  constraint investigation_loops_loop_version_format
                                    check (loop_version ~ '^loop-v[1-9][0-9]{0,3}$'),

  -- 1 for the first start; one more for every restart from the checkpoint.
  attempt             integer     not null default 1
                                  constraint investigation_loops_attempt_positive
                                    check (attempt >= 1),

  -- What the engine needs to continue: its plan, where it is in it, what it has gathered. Opaque
  -- here — the shape is the loop version's — but an object, and bounded.
  checkpoint          jsonb
                      constraint investigation_loops_checkpoint_shape
                        check (checkpoint is null
                               or (jsonb_typeof(checkpoint) = 'object'
                                   and octet_length(checkpoint::text) <= 2097152)),

  -- How many checkpoints have been written. Only ever rises.
  checkpoint_seq      integer     not null default 0
                                  constraint investigation_loops_checkpoint_seq_nonnegative
                                    check (checkpoint_seq >= 0),

  checkpointed_at     timestamptz,

  -- Working time so far, across attempts — what actuals.duration_ms reports.
  duration_ms         bigint      not null default 0
                                  constraint investigation_loops_duration_nonnegative
                                    check (duration_ms >= 0),

  -- A person asked for it to stop. Read back by the engine with every checkpoint write.
  cancel_requested_at timestamptz,
  cancel_requested_by text        references ouroboros."user" ("id") on delete set null,

  -- Why it failed, and a sentence for a person. Both or neither.
  failure_reason      text
                      constraint investigation_loops_failure_reason
                        check (failure_reason in ('tool_exhaustion', 'budget_breach',
                                                  'synthesis_failure', 'engine_error')),
  failure_detail      text
                      constraint investigation_loops_failure_detail_bounded
                        check (btrim(failure_detail) <> '' and length(failure_detail) <= 500),

  started_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint investigation_loops_checkpoint_paired
    check ((checkpoint is null) = (checkpointed_at is null)
           and (checkpoint is not null or checkpoint_seq = 0)),
  constraint investigation_loops_failure_paired
    check ((failure_reason is null) = (failure_detail is null)),
  constraint investigation_loops_cancel_by_needs_request
    check (cancel_requested_by is null or cancel_requested_at is not null)
);

comment on table ouroboros.investigation_loops is
  'The investigation loop''s durable state (#620, CM.1): loop version, attempt, the checkpoint a restarted worker resumes from, working time, a cancel request and the failure reason. One row per investigation the loop has started; partials are never deleted.';
comment on column ouroboros.investigation_loops.attempt is
  '1 on the first start, one more on every restart. A checkpoint from an older attempt is refused.';
comment on column ouroboros.investigation_loops.checkpoint is
  'The engine''s resume state for this loop version — an object of at most 2 MiB, null before the first write.';
comment on column ouroboros.investigation_loops.checkpoint_seq is
  'How many checkpoints have been written; only rises (investigation_loops_checkpoint_forward).';
comment on column ouroboros.investigation_loops.duration_ms is
  'Working time so far across attempts — the source of actuals.duration_ms.';
comment on column ouroboros.investigation_loops.cancel_requested_at is
  'When a person asked the run to stop; the engine reads it with each checkpoint and stops between operations.';
comment on column ouroboros.investigation_loops.failure_reason is
  'tool_exhaustion | budget_breach | synthesis_failure | engine_error — set exactly when the loop failed the investigation.';

-- Attempt, checkpoint_seq and duration only move forward; the loop version never changes; and a
-- failure reason is recorded only on a failed investigation.
create function ouroboros.investigation_loops_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.loop_version <> old.loop_version then
      raise exception 'investigation % was started by %, not %', old.investigation_id,
        old.loop_version, new.loop_version
        using errcode = 'check_violation', constraint = 'investigation_loops_loop_version_fixed';
    end if;
    if new.attempt < old.attempt or new.checkpoint_seq < old.checkpoint_seq
       or new.duration_ms < old.duration_ms then
      raise exception 'the loop state of investigation % only moves forward', old.investigation_id
        using errcode = 'check_violation', constraint = 'investigation_loops_checkpoint_forward';
    end if;
  end if;

  if new.failure_reason is not null
     and not exists (select 1 from ouroboros.investigations i
                      where i.id = new.investigation_id and i.status = 'failed') then
    raise exception 'investigation % has a failure reason but has not failed', new.investigation_id
      using errcode = 'check_violation', constraint = 'investigation_loops_failure_when_failed';
  end if;
  return new;
end;
$$;

comment on function ouroboros.investigation_loops_guard() is
  'Keeps an investigation loop''s attempt, checkpoint_seq and duration moving forward, its loop version fixed, and a failure reason only on a failed investigation (#620).';

create trigger investigation_loops_guard
  before insert or update on ouroboros.investigation_loops
  for each row execute function ouroboros.investigation_loops_guard();

create trigger investigation_loops_touch_updated_at
  before update on ouroboros.investigation_loops
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- investigation_usage — one row per model call, as the gateway reported it.
-- ---------------------------------------------------------------------------
create table ouroboros.investigation_usage (
  investigation_id uuid          not null
                                 references ouroboros.investigations (id) on delete cascade,

  -- 1, 2, 3, … in the order the loop made the calls. The engine numbers them, so a checkpoint
  -- written twice records each call once.
  seq              integer       not null
                                 constraint investigation_usage_seq_positive check (seq >= 1),

  -- Which step of the loop made the call.
  stage            text          not null
                                 constraint investigation_usage_stage
                                   check (stage in ('plan', 'select', 'digest', 'synthesize')),

  -- The routing alias the call was made on.
  alias            text          not null
                                 constraint investigation_usage_alias_present
                                   check (btrim(alias) <> '' and length(alias) <= 200),

  -- The hop of the resolved chain that served it, and what served it.
  hop              integer       not null
                                 constraint investigation_usage_hop_nonnegative check (hop >= 0),
  connection       text          not null
                                 constraint investigation_usage_connection_present
                                   check (btrim(connection) <> '' and length(connection) <= 200),
  model            text          not null
                                 constraint investigation_usage_model_present
                                   check (btrim(model) <> '' and length(model) <= 200),

  input_tokens     bigint        not null
                                 constraint investigation_usage_input_tokens_nonnegative
                                   check (input_tokens >= 0),
  output_tokens    bigint        not null
                                 constraint investigation_usage_output_tokens_nonnegative
                                   check (output_tokens >= 0),

  -- What it cost, in cents; null when nothing prices it — unpriced, never free.
  cost_cents       numeric(14,4)
                   constraint investigation_usage_cost_nonnegative check (cost_cents >= 0),

  recorded_at      timestamptz   not null default now(),

  constraint investigation_usage_pkey primary key (investigation_id, seq)
);

comment on table ouroboros.investigation_usage is
  'The model calls an investigation made (#620, CM.1), one row per usage event of the invocation gateway: stage, alias, hop, connection, model, tokens and cost. actuals.spend_cents is investigation_spend_cents() over these rows. Never edited.';
comment on column ouroboros.investigation_usage.seq is
  'The call''s number within the investigation, assigned by the loop — the idempotency key of a re-sent checkpoint.';
comment on column ouroboros.investigation_usage.cost_cents is
  'Cents, or null when the model is unpriced. A null is not a zero.';

create trigger investigation_usage_immutable
  before update on ouroboros.investigation_usage
  for each row execute function ouroboros.citation_ledger_refuse_update();

-- investigation_spend_cents(investigation) — what an investigation spent on models, in whole cents.
--   investigation — investigations.id
--   returns 0 when it made no model call; null when it made calls and none of them is priced;
--   otherwise the priced calls' total, rounded up to a cent
create function ouroboros.investigation_spend_cents(investigation uuid)
returns integer language sql stable as $$
  select case
           when count(*) = 0 then 0
           when count(u.cost_cents) = 0 then null
           else ceil(sum(u.cost_cents))::integer
         end
    from ouroboros.investigation_usage u
   where u.investigation_id = investigation;
$$;

comment on function ouroboros.investigation_spend_cents(uuid) is
  'An investigation''s model spend in whole cents, from investigation_usage (#620): 0 with no calls, null when no call is priced, otherwise the priced total rounded up. The one definition actuals.spend_cents is written from.';

-- ---------------------------------------------------------------------------
-- investigation_deliverable_inputs — what the playbook produced besides the brief.
-- ---------------------------------------------------------------------------
create table ouroboros.investigation_deliverable_inputs (
  investigation_id uuid        not null,
  brief_id         uuid        not null,

  deliverable      text        not null
                               constraint investigation_deliverable_inputs_deliverable
                                 check (deliverable in ('matrix', 'roadmap_doc', 'fix_draft')),

  -- The input, in the deliverable's own shape — matrix rows with their cited cells, a roadmap
  -- outline, a fix hypothesis. An object, bounded.
  payload          jsonb       not null
                               constraint investigation_deliverable_inputs_payload_shape
                                 check (jsonb_typeof(payload) = 'object'
                                        and octet_length(payload::text) <= 524288),

  created_at       timestamptz not null default now(),

  constraint investigation_deliverable_inputs_pkey primary key (brief_id, deliverable),
  constraint investigation_deliverable_inputs_brief_fk
    foreign key (brief_id, investigation_id)
    references ouroboros.briefs (id, investigation_id) on delete cascade
);

comment on table ouroboros.investigation_deliverable_inputs is
  'What an investigation''s playbook produced besides its brief (#620, CM.1; decision V10): the matrix rows, roadmap-doc input or fix-draft input of one brief version. Inputs to CM.2 (#621), CM.5 (#624) and the watch chain (#623); never edited.';
comment on column ouroboros.investigation_deliverable_inputs.payload is
  'The deliverable''s input as an object of at most 512 KiB; every source it cites is a source_records id of the same investigation, checked by the writer.';

create index investigation_deliverable_inputs_investigation_idx
  on ouroboros.investigation_deliverable_inputs (investigation_id);

create trigger investigation_deliverable_inputs_immutable
  before update on ouroboros.investigation_deliverable_inputs
  for each row execute function ouroboros.citation_ledger_refuse_update();

-- ---------------------------------------------------------------------------
-- brief_claims.demoted — the demotion, on the record.
-- ---------------------------------------------------------------------------
alter table ouroboros.brief_claims
  add column demoted boolean not null default false,
  add constraint brief_claims_demoted_is_open_question
    check (not demoted or claim_type = 'open_question');

comment on column ouroboros.brief_claims.demoted is
  'True when synthesis offered the claim as a finding and it cited no ledger record, so it was written as an open question instead (#620, decision V3). Only ever true for an open_question.';

-- ---------------------------------------------------------------------------
-- The application role. Loop state is written and moved forward; usage and deliverable inputs
-- are written once and read.
-- ---------------------------------------------------------------------------
grant select, insert, update on ouroboros.investigation_loops to ouroboros_app;
grant select, insert on ouroboros.investigation_usage to ouroboros_app;
grant select, insert on ouroboros.investigation_deliverable_inputs to ouroboros_app;
