-- V061__classification_routing.sql — the four columns the Mark & Route card's actions need in
-- order to compose over machinery that already exists: a classification subtype, a steer's
-- stage-retry flag, a runner's health note and a build job's test selection.
--
-- Filed as issue #332 (AT.4) of the Test Results roadmap (docs/ROADMAP_MOCKUP_11_TEST_RESULTS.md,
-- decisions T6 and T7, option 5-A). Everything the routing service writes goes into tables
-- earlier migrations built — `failure_classifications` (V055), `run_controls` (V048/V050),
-- `runners` and `build_jobs` (V040) — and this adds only what those rows could not yet say.
--
--
-- `failure_classifications.subtype` — the #434 amendment.
-- ---------------------------------------------------------------------------
--
-- Mockup 15's *"Where loops still need humans"* maps every intervention to a cause from a
-- record (decision I5). An *ambiguous ticket* had no record: the closest signal was a correction
-- note about unclear requirements, and reading that out of note text is the guess the taxonomy
-- exists to avoid. So a person classifying a failure can now say it explicitly:
--
--     class         subtype
--     product_bug   unclear_requirements   — "this ticket was underspecified"
--
-- Nullable, and a closed vocabulary of one. It is part of the decision, so V055's
-- `failure_classifications_frozen` already holds it (that trigger compares every column but
-- `routed`, `superseded_by` and `created_by`). Existing rows are unaffected.
--
--
-- `run_controls.retry_stage` — the correction round's stage retry (decision T6).
-- ---------------------------------------------------------------------------
--
-- *Queue correction round → attempt 4* is an AP.4 steer carrying the correction note **plus** a
-- stage-retry request. Both are one control: a steer with `retry_stage = true` asks the executor
-- to append the text to the planning context and then start the current stage's **next**
-- attempt, rather than only appending. One row, so the receipt's single `control_id` names the
-- whole request, the ack names the attempt it opened, and the audit trail has one entry.
--
-- Steer-only, like V050's `remember`, and frozen at insert with the rest of what was asked —
-- `run_controls_transition()` is V050's verbatim but for the two row comparisons, which now
-- carry `retry_stage`.
--
--
-- `runners.health_note` — the infra path's flag (decision T7).
-- ---------------------------------------------------------------------------
--
-- Classifying a failure `infra_rig` flags the runner that ran the attempt: a sentence the farm
-- page can show beside the runner (*"rig power supply browned out mid-trial"*), when it was
-- written and by whom. It is a note, not a state: it changes nothing about dispatch — draining
-- is the administrator's separate, existing action — and a later note replaces it. The three
-- columns are set together or cleared together (`runners_health_note_complete`).
--
--
-- `build_jobs.test_selection` — which cases a re-run runs (decision T6).
-- ---------------------------------------------------------------------------
--
-- *Re-run failed (2)* dispatches a farm job carrying **only** the failed set; *Re-run full
-- suite* carries every case. The selection is snapshotted on the job like the rest of its
-- configuration:
--
--     {"scope": "failed" | "full",
--      "test_run_id": "<the attempt it re-runs>",
--      "case_keys": ["<64 hex>", …]}              — at least one, no duplicates
--
-- Null for every job that is not a re-run. Which runner-side filter it becomes is the runner's
-- business; this is the record of what was asked.

-- ---------------------------------------------------------------------------
-- failure_classifications.subtype
-- ---------------------------------------------------------------------------
alter table ouroboros.failure_classifications
  add column subtype text;

alter table ouroboros.failure_classifications
  add constraint failure_classifications_subtype
    check (subtype in ('unclear_requirements'));

comment on column ouroboros.failure_classifications.subtype is
  'unclear_requirements, or null — a refinement of the class a person states explicitly (#332, amended by #434), so mockup 15''s ambiguous_ticket cause maps from a record rather than from note text. Frozen with the rest of the decision.';

-- ---------------------------------------------------------------------------
-- run_controls.retry_stage
-- ---------------------------------------------------------------------------
alter table ouroboros.run_controls
  add column retry_stage boolean not null default false;

alter table ouroboros.run_controls
  add constraint run_controls_retry_stage_belongs_to_steer
    check (not retry_stage or kind = 'steer');

comment on column ouroboros.run_controls.retry_stage is
  'A correction round (#332, decision T6): the steer''s text goes into the planning context and the executor then starts the current stage''s next attempt. Steer-only, false unless set, frozen at insert.';
comment on constraint run_controls_retry_stage_belongs_to_steer on ouroboros.run_controls is
  'Only a steer can ask for a stage retry (#332): the correction note is what the next attempt is planned with.';

create or replace function ouroboros.run_controls_transition()
returns trigger
language plpgsql
as $$
begin
  if new.requested_by is null and old.requested_by is not null
     and row(new.id, new.run_id, new.kind, new.payload, new.state, new.requested_at,
             new.delivered_at, new.acked_at, new.expires_at, new.ack_detail,
             new.idempotency_key, new.remember, new.retry_stage)
         is not distinct from
         row(old.id, old.run_id, old.kind, old.payload, old.state, old.requested_at,
             old.delivered_at, old.acked_at, old.expires_at, old.ack_detail,
             old.idempotency_key, old.remember, old.retry_stage)
  then
    return new;
  end if;

  if old.state in ('acked', 'expired', 'rejected') then
    raise exception
      'run control % is %, which is terminal', old.id, old.state
      using errcode = 'restrict_violation',
            constraint = 'run_controls_transition',
            hint = 'A control records an exchange that has finished (#301, decision R6). Submit another control rather than revising this one.';
  end if;

  if new.state is distinct from old.state
     and not (old.state = 'pending'   and new.state in ('delivered', 'expired', 'rejected')
           or old.state = 'delivered' and new.state in ('acked', 'expired'))
  then
    raise exception
      'run control % cannot move from % to %', old.id, old.state, new.state
      using errcode = 'restrict_violation',
            constraint = 'run_controls_transition',
            hint = 'Decision R6''s machine: pending → delivered | expired | rejected, delivered → acked | expired.';
  end if;

  if row(new.id, new.run_id, new.kind, new.payload, new.requested_by,
         new.requested_at, new.expires_at, new.idempotency_key, new.remember, new.retry_stage)
     is distinct from
     row(old.id, old.run_id, old.kind, old.payload, old.requested_by,
         old.requested_at, old.expires_at, old.idempotency_key, old.remember, old.retry_stage)
  then
    raise exception
      'run control % is a record of what was asked, and that cannot be revised', old.id
      using errcode = 'restrict_violation',
            constraint = 'run_controls_transition',
            hint = 'Only state, delivered_at, acked_at and ack_detail move after insert (#301). A queue whose entries can be edited in flight is a queue where "abort" was once "pause" and nobody can tell.';
  end if;

  return new;
end;
$$;

comment on function ouroboros.run_controls_transition() is
  'Decision R6''s state machine, enforced in the schema rather than in the service (#301, amended by V050 for #306 and V061 for #332): terminal states accept no update at all, transitions follow the five edges the diagram draws, and everything that describes what was ASKED — including the steer''s remember and retry_stage flags — is fixed at insert. The one exception is requested_by going from a person to null with nothing else moving, the foreign key''s own ON DELETE SET NULL. So the guarantee is: what was asked, and what happened to it, cannot be rewritten; who asked can be forgotten.';

-- ---------------------------------------------------------------------------
-- runners.health_note
-- ---------------------------------------------------------------------------
alter table ouroboros.runners
  add column health_note     text,
  add column health_noted_at timestamptz,
  -- Set null if the person is removed, so the note outlives them.
  add column health_noted_by text references ouroboros."user" ("id") on delete set null;

alter table ouroboros.runners
  add constraint runners_health_note_shape
    check (health_note is null or (btrim(health_note) <> '' and length(health_note) <= 1024)),
  -- The note and its instant travel together. `health_noted_by` may be null beside a note — the
  -- foreign key's own set null — but never set without one.
  add constraint runners_health_note_complete
    check ((health_note is null) = (health_noted_at is null)
           and (health_noted_by is null or health_note is not null));

comment on column ouroboros.runners.health_note is
  'A farm health note (#332, decision T7): written when a failure on this runner is classified infra_rig. Informational — dispatch never reads it. A later note replaces it.';
comment on column ouroboros.runners.health_noted_at is
  'When the health note was written. Set exactly when health_note is.';
comment on column ouroboros.runners.health_noted_by is
  'Who wrote the health note; set null if the person is removed.';

-- ---------------------------------------------------------------------------
-- build_jobs.test_selection
-- ---------------------------------------------------------------------------
create function ouroboros.build_jobs_test_selection_shaped(p_selection jsonb)
returns boolean
language sql
immutable
as $$
  -- Coalesced: a CHECK that evaluates to null passes, and a missing selection is not a shaped one.
  select coalesce(
       jsonb_typeof(p_selection) = 'object'
       and (select count(*) = 3 from jsonb_object_keys(p_selection))
       and p_selection ->> 'scope' in ('failed', 'full')
       and jsonb_typeof(p_selection -> 'test_run_id') = 'string'
       and p_selection ->> 'test_run_id'
           ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and jsonb_typeof(p_selection -> 'case_keys') = 'array'
       and jsonb_array_length(p_selection -> 'case_keys') >= 1
       -- A case only; only strings may reach the text comparisons.
       and (select bool_and(case when jsonb_typeof(k) = 'string'
                                 then (k #>> '{}') ~ '^[0-9a-f]{64}$'
                                 else false end)
                   and count(distinct k) = count(*)
              from jsonb_array_elements(p_selection -> 'case_keys') as k),
       false)
$$;

comment on function ouroboros.build_jobs_test_selection_shaped(jsonb) is
  'True when a test selection is exactly {scope: failed|full, test_run_id: uuid, case_keys: [64-hex, …]} with at least one key and no duplicates (#332).';

alter table ouroboros.build_jobs
  add column test_selection jsonb;

alter table ouroboros.build_jobs
  add constraint build_jobs_test_selection_shape
    check (test_selection is null or ouroboros.build_jobs_test_selection_shaped(test_selection));

comment on column ouroboros.build_jobs.test_selection is
  'The cases a re-run runs (#332, decision T6): {scope: failed|full, test_run_id, case_keys}. Null for every job that is not a re-run. Snapshotted at submit, like the rest of the job.';

grant execute on function ouroboros.build_jobs_test_selection_shaped(jsonb) to ouroboros_app;
