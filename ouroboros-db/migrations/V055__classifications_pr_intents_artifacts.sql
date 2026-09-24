-- V055__classifications_pr_intents_artifacts.sql — `failure_classifications`,
-- `run_pr_intents`, `pr_waivers` and `test_artifacts`: the Mark & Route card's decisions, the
-- PR toggles' stored intents, and the artifact registry that drives retention.
--
-- Filed as issue #327 (AS.4) of the Test Results roadmap
-- (docs/ROADMAP_MOCKUP_11_TEST_RESULTS.md, decisions T7 and T8, option 3-A). It feeds the
-- classification & routing service (AT.4, #332), reads & artifact serving (#333), the Mark &
-- Route card (#340) and the artifacts card (#341).
--
--
-- A classification is a decision, not form state (decision T7).
-- ---------------------------------------------------------------------------
--
-- Someone looked at a failing case, judged it a product bug rather than a flake, and wrote
-- *"Keep k_msgq, but move PID velocity sampling off the telemetry path"*. That sentence goes
-- into the next attempt's planning context and changes what an agent does, so it is a row: the
-- occurrence it is about, the `class`, the correction `note`, who decided (`actor`,
-- `created_by`), when, and `routed` — what was **actually dispatched** because of it.
--
-- The occurrence is the `test_cases` row — one case in one attempt, the same row V054's
-- `test_case_history` projects — referenced by the composite `(test_case_id, organization_id)`
-- with cascade. Only a case that did not pass cleanly (`failed`, `error` or `flaky`) can be
-- classified; a passed or skipped case has nothing to mark.
--
-- **`actor` is the honesty mechanism.** A class picked by a `human`, by a `heuristic` rule and
-- by a `model` are three different epistemic states, and the card's affix — `heuristic` versus
-- `AI pick · 84%` — reads directly off it:
--
--     actor       rule_id     confidence
--     human       null        null
--     heuristic   required    null   — a deterministic rule with an invented percentage is
--                                      worse than no number (option 5-A)
--     model       null        0–100, nullable
--
-- A `human` decision names its author when it is written. `created_by` is `on delete set null`
-- afterwards, on V048's argument: removing somebody must not remove the record of what they
-- decided.
--
-- **`routed` is the receipt, not a toast.** Null until something is dispatched; once written,
-- an object carrying at least one of
--
--     control_id      the run_controls row (AP.4 steer) — must be a control of the case's run
--     rerun_job_id    the build_jobs row (AH.4 re-run) — must be a job of the case's workspace
--                     and, when it names a run, of the case's run
--     target_attempt  the attempt the correction lands in (Build N + 1), >= 1
--
-- so a card cannot say "routed ✓" with nothing behind it. Other keys may ride along for #332.
-- It is written once: null → receipt, then frozen.
--
-- **Re-classifying keeps history.** A new classification of a case supersedes the current one:
-- `failure_classifications_supersede` points the prior row's `superseded_by` at the new row in
-- the same statement, so a case has exactly one current decision (`superseded_by is null`) and
-- every earlier one is kept, in order. Nothing else about a classification can change —
-- `failure_classifications_frozen` refuses it — so the audit trail is appended to, never
-- overwritten.
--
--
-- PR toggles are intents, not gates (decision T8).
-- ---------------------------------------------------------------------------
--
-- `run_pr_intents` holds the card's two toggles per run — **Block PR #514 until green**
-- (`block_until_green`) and **Auto re-run physical suite after fix** (`auto_rerun_physical`).
-- `pr_waivers` holds **Waive & annotate PR**: an `author`, a `reason` that is NOT NULL and not
-- blank — a waiver without a reason is not a waiver — the waived cases by durable `case_key`,
-- and `created_at`. Waivers are append-only.
--
-- **Activation point.** Nothing in this migration enforces anything on a pull request. These
-- rows are stored now so nothing the user sets is lost, and they are inert until mockup 12's
-- PR plane (AV.2, #344) consumes them:
--
--   * `block_until_green` is evaluated by the gate engine (#358) and enforced by the merge
--     executor's server-side re-check (#360). Until then it blocks nothing, and every surface
--     that shows it labels it as an intent.
--   * `auto_rerun_physical` is read by the routing service (#332) after a correction round.
--   * A waiver is referenced by `pr_criteria.waiver_ref` (#354) and posted to the host PR as an
--     idempotent annotation by #359. Until then `annotation_state` is `pending_pr_plane` — the
--     only value this migration allows. #359 widens the vocabulary when it can post.
--
--
-- Artifacts need a registry because retention is a policy, not a cleanup script (option 3-A).
-- ---------------------------------------------------------------------------
--
-- `test_artifacts` is one row per file an attempt uploaded: `name`, `kind`, `size_bytes`,
-- `checksum`, where it is stored and until when it is kept.
--
--   * `storage_ref` is `{"driver": ..., "key": ...}`. The driver is data (`local`, `s3`, …),
--     so moving from the local volume to S3 is a row update, not a migration.
--   * `retained_until` is the date `retained 30d` renders and the sweep acts on
--     (`test_artifacts_retention_idx`). It can be extended while the artifact is live.
--   * `expired_at` is the **tombstone**. The sweep deletes the stored bytes and sets it; the
--     row stays, so the card can say `expired` rather than show nothing. Once set it never
--     clears, and a tombstoned artifact's retention is final.
--   * `truncated` with `truncation_note` carries the upload manifest's word that a file was cut
--     short; a truncated artifact always says why.
--
-- The application may not delete an artifact row — expiry is a tombstone, never a delete. Rows
-- leave only with their attempt.

-- ---------------------------------------------------------------------------
-- The shape of a dispatch receipt — shared by the CHECK and the triggers below, which run
-- before it and must not cast a malformed id.
-- ---------------------------------------------------------------------------
create function ouroboros.failure_classifications_routed_shaped(p_routed jsonb)
returns boolean
language sql
immutable
as $$
  -- Coalesced: a CHECK that evaluates to null passes, and a missing receipt is not a shaped one.
  select coalesce(jsonb_typeof(p_routed) = 'object'
     and (p_routed ? 'control_id' or p_routed ? 'rerun_job_id' or p_routed ? 'target_attempt')
     and (not p_routed ? 'control_id'
          or (jsonb_typeof(p_routed -> 'control_id') = 'string'
              and p_routed ->> 'control_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
     and (not p_routed ? 'rerun_job_id'
          or (jsonb_typeof(p_routed -> 'rerun_job_id') = 'string'
              and p_routed ->> 'rerun_job_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
     and (not p_routed ? 'target_attempt'
          -- A case, not an and: only a number may reach the cast.
          or case when jsonb_typeof(p_routed -> 'target_attempt') = 'number'
                  then (p_routed -> 'target_attempt')::numeric >= 1
                       and (p_routed -> 'target_attempt')::numeric
                           = trunc((p_routed -> 'target_attempt')::numeric)
                  else false
             end), false)
$$;

comment on function ouroboros.failure_classifications_routed_shaped(jsonb) is
  'True when a routed receipt is an object carrying at least one of control_id (a uuid string), rerun_job_id (a uuid string) and target_attempt (a whole number >= 1) (#327). Other keys are allowed.';

-- ---------------------------------------------------------------------------
-- failure_classifications — one Mark & Route decision about one failing case occurrence.
-- ---------------------------------------------------------------------------
create table ouroboros.failure_classifications (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The occurrence: one case in one attempt. Cascade: a decision about nothing is nothing.
  test_case_id     uuid        not null,

  class            text        not null,

  -- The correction note — injected into the next attempt's planning context.
  note             text,

  actor            text        not null,

  -- Heuristic only: the rule that picked the class.
  rule_id          text,

  -- Model only: 0–100. Null for human and heuristic.
  confidence       numeric,

  -- The dispatch receipt. Null until something was dispatched.
  routed           jsonb,

  created_by       text        references ouroboros."user" ("id") on delete set null,
  created_at       timestamptz not null default now(),

  -- The classification that replaced this one; null for the current decision.
  superseded_by    uuid,

  constraint failure_classifications_id_organization_key unique (id, organization_id),

  constraint failure_classifications_test_case_fk
    foreign key (test_case_id, organization_id)
    references ouroboros.test_cases (id, organization_id) on delete cascade,

  constraint failure_classifications_superseded_by_fk
    foreign key (superseded_by, organization_id)
    references ouroboros.failure_classifications (id, organization_id),

  constraint failure_classifications_class
    check (class in ('product_bug', 'test_update', 'flake_retry', 'infra_rig')),

  constraint failure_classifications_actor
    check (actor in ('human', 'heuristic', 'model')),

  constraint failure_classifications_note_shape
    check (note is null or (btrim(note) <> '' and length(note) <= 4096)),

  constraint failure_classifications_rule_id_heuristic_only
    check ((actor = 'heuristic') = (rule_id is not null)),

  constraint failure_classifications_rule_id_shape
    check (rule_id is null or (btrim(rule_id) <> '' and length(rule_id) <= 128)),

  constraint failure_classifications_confidence_model_only
    check (confidence is null or actor = 'model'),

  constraint failure_classifications_confidence_range
    check (confidence is null or (confidence >= 0 and confidence <= 100)),

  constraint failure_classifications_routed_shape
    check (routed is null or ouroboros.failure_classifications_routed_shaped(routed)),

  constraint failure_classifications_not_self_superseded
    check (superseded_by is distinct from id)
);

comment on table ouroboros.failure_classifications is
  'One Mark & Route decision about one failing test case occurrence (#327, AS.4, decision T7): class, correction note, actor with rule or confidence, author and the routed dispatch receipt. Re-classifying supersedes the current row (superseded_by) and keeps it; nothing else is ever rewritten.';
comment on column ouroboros.failure_classifications.test_case_id is
  'The occurrence classified — a test_cases row (one case in one attempt), composite with organization_id, cascade. Must be failed, error or flaky.';
comment on column ouroboros.failure_classifications.class is
  'product_bug | test_update | flake_retry | infra_rig — the four radios of the Mark & Route card.';
comment on column ouroboros.failure_classifications.note is
  'The correction note, injected into the next attempt''s planning context. Optional; never blank.';
comment on column ouroboros.failure_classifications.actor is
  'human | heuristic | model — who picked the class, and what the card''s affix reads off. The honesty mechanism of decision T7.';
comment on column ouroboros.failure_classifications.rule_id is
  'The heuristic rule that picked the class. Required for actor = heuristic and null otherwise.';
comment on column ouroboros.failure_classifications.confidence is
  'The model''s confidence, 0–100 (AI pick · 84%). Null for human and heuristic actors — a rule with an invented percentage is worse than no number.';
comment on column ouroboros.failure_classifications.routed is
  'What was actually dispatched: an object with at least one of control_id (a run_controls row of the case''s run), rerun_job_id (a build_jobs row of the workspace) and target_attempt (>= 1). Null until dispatched; written once.';
comment on column ouroboros.failure_classifications.created_by is
  'Who decided. Required at insert for actor = human; set null if the person is removed, so the decision outlives them.';
comment on column ouroboros.failure_classifications.superseded_by is
  'The classification that replaced this one, set by failure_classifications_supersede. Null exactly for the current decision of a case.';

-- "The current decision for this case" and "every decision for this case, in order".
create index failure_classifications_test_case_idx
  on ouroboros.failure_classifications (test_case_id, created_at);

-- The self-reference's lookups when a row is checked or removed.
create index failure_classifications_superseded_by_idx
  on ouroboros.failure_classifications (superseded_by)
  where superseded_by is not null;

-- ---------------------------------------------------------------------------
-- A receipt names things that exist, in the case's own run and workspace.
--
-- **`security definer`**, on V048's argument: the triggers call it as the writer, and
-- `ouroboros_app` holds no grant on `build_jobs` — the farm's table — yet a receipt naming a
-- re-run job has to be checked against it. `search_path` is pinned with `pg_temp` last, it
-- answers only yes or no, and `execute` is revoked from `public` and granted to the one role
-- whose writes fire it.
-- ---------------------------------------------------------------------------
create function ouroboros.failure_classifications_routed_valid(
  p_organization_id text,
  p_test_case_id    uuid,
  p_routed          jsonb
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
  with c as (
    select t.run_id
      from ouroboros.test_cases tc
      join ouroboros.test_suites s on s.id = tc.test_suite_id
      join ouroboros.test_runs t   on t.id = s.test_run_id
     where tc.id = p_test_case_id
       and tc.organization_id = p_organization_id
  )
  -- A case, not an or: only a shaped receipt may reach the uuid casts.
  select case
           when p_routed is null
                or not ouroboros.failure_classifications_routed_shaped(p_routed) then true
           else (not p_routed ? 'control_id'
           or exists (select 1
                        from ouroboros.run_controls rc, c
                       where rc.id = (p_routed ->> 'control_id')::uuid
                         and rc.run_id = c.run_id))
          and (not p_routed ? 'rerun_job_id'
               or exists (select 1
                            from ouroboros.build_jobs j, c
                           where j.id = (p_routed ->> 'rerun_job_id')::uuid
                             and j.organization_id = p_organization_id
                             and (j.run_id is null or j.run_id = c.run_id)))
         end
$$;

comment on function ouroboros.failure_classifications_routed_valid(text, uuid, jsonb) is
  'True when a routed receipt names only things that exist (#327): control_id a run_controls row of the case''s run, rerun_job_id a build_jobs row of the workspace (and of the case''s run when the job names one). True for null, and for a malformed receipt, which failure_classifications_routed_shape refuses by its own name.';

-- ---------------------------------------------------------------------------
-- Insert: a new decision is current, about a failing case, and authored if human.
-- ---------------------------------------------------------------------------
create function ouroboros.failure_classifications_before_insert()
returns trigger
language plpgsql
as $$
declare
  case_status text;
begin
  -- Serialises concurrent classifications of one case, so the supersede below always sees
  -- the decision it replaces. Released at commit.
  perform pg_advisory_xact_lock(
    hashtextextended('failure_classifications:' || new.test_case_id::text, 0));

  select tc.status into case_status
    from ouroboros.test_cases tc
   where tc.id = new.test_case_id
     and tc.organization_id = new.organization_id;

  -- No such case in this workspace is failure_classifications_test_case_fk's to report.
  if found and case_status not in ('failed', 'error', 'flaky') then
    raise exception 'test case % is %, and only a failed, error or flaky case can be classified',
      new.test_case_id, case_status
      using errcode = 'check_violation', constraint = 'failure_classifications_case_failing';
  end if;

  if new.superseded_by is not null then
    raise exception 'a new classification is the current one; superseded_by is set when it is replaced'
      using errcode = 'check_violation', constraint = 'failure_classifications_superseded_on_insert';
  end if;

  if new.actor = 'human' and new.created_by is null then
    raise exception 'a human classification names its author'
      using errcode = 'check_violation', constraint = 'failure_classifications_human_author';
  end if;

  if not ouroboros.failure_classifications_routed_valid(
           new.organization_id, new.test_case_id, new.routed) then
    raise exception 'routed receipt % names a control or job that is not of this case''s run',
      new.routed
      using errcode = 'check_violation', constraint = 'failure_classifications_routed_exists';
  end if;

  return new;
end;
$$;

comment on function ouroboros.failure_classifications_before_insert() is
  'Refuses a classification of a case that is not failed, error or flaky; one inserted already superseded; a human one without created_by; and a routed receipt naming a control or job outside the case''s run (#327). Takes a per-case advisory lock so concurrent re-classifications supersede in order.';

create trigger failure_classifications_before_insert
  before insert on ouroboros.failure_classifications
  for each row execute function ouroboros.failure_classifications_before_insert();

-- ---------------------------------------------------------------------------
-- Re-classifying supersedes the current decision rather than overwriting it.
-- ---------------------------------------------------------------------------
create function ouroboros.failure_classifications_supersede()
returns trigger
language plpgsql
as $$
begin
  update ouroboros.failure_classifications
     set superseded_by = new.id
   where test_case_id = new.test_case_id
     and organization_id = new.organization_id
     and superseded_by is null
     and id <> new.id;

  return null;
end;
$$;

comment on function ouroboros.failure_classifications_supersede() is
  'Points the case''s current classification at the one just inserted (#327), so re-classifying keeps the prior decision and a case has exactly one current row.';

create trigger failure_classifications_supersede
  after insert on ouroboros.failure_classifications
  for each row execute function ouroboros.failure_classifications_supersede();

-- ---------------------------------------------------------------------------
-- Update: only the receipt and the supersession are written, each once.
-- ---------------------------------------------------------------------------
create function ouroboros.failure_classifications_frozen()
returns trigger
language plpgsql
as $$
declare
  successor record;
begin
  -- Everything but the three columns below is the decision itself.
  if (to_jsonb(new) - array['routed', 'superseded_by', 'created_by'])
     is distinct from (to_jsonb(old) - array['routed', 'superseded_by', 'created_by']) then
    raise exception 'classification % is a recorded decision and cannot be rewritten; classify again',
      old.id
      using errcode = 'check_violation', constraint = 'failure_classifications_frozen';
  end if;

  -- The author can be forgotten (the foreign key's own set null), never replaced.
  if new.created_by is distinct from old.created_by and new.created_by is not null then
    raise exception 'the author of classification % cannot be changed', old.id
      using errcode = 'check_violation', constraint = 'failure_classifications_frozen';
  end if;

  if new.routed is distinct from old.routed then
    if old.routed is not null then
      raise exception 'classification % has already been routed; a receipt is written once', old.id
        using errcode = 'check_violation', constraint = 'failure_classifications_routed_once';
    end if;

    if not ouroboros.failure_classifications_routed_valid(
             new.organization_id, new.test_case_id, new.routed) then
      raise exception 'routed receipt % names a control or job that is not of this case''s run',
        new.routed
        using errcode = 'check_violation', constraint = 'failure_classifications_routed_exists';
    end if;
  end if;

  if new.superseded_by is distinct from old.superseded_by then
    if old.superseded_by is not null then
      raise exception 'classification % was already superseded by %', old.id, old.superseded_by
        using errcode = 'check_violation', constraint = 'failure_classifications_supersede_once';
    end if;

    -- Another workspace's row is failure_classifications_superseded_by_fk's to report.
    select f.test_case_id, f.created_at into successor
      from ouroboros.failure_classifications f
     where f.id = new.superseded_by
       and f.organization_id = new.organization_id;

    if found and (successor.test_case_id <> old.test_case_id
                  or successor.created_at < old.created_at) then
      raise exception 'classification % can only be superseded by a later classification of the same case',
        old.id
        using errcode = 'check_violation', constraint = 'failure_classifications_supersede_same_case';
    end if;
  end if;

  return new;
end;
$$;

comment on function ouroboros.failure_classifications_frozen() is
  'Holds a classification to what was decided (#327): only routed (null → a valid receipt, once), superseded_by (null → a later classification of the same case, once) and created_by (to null, by the foreign key) may change.';

create trigger failure_classifications_frozen
  before update on ouroboros.failure_classifications
  for each row execute function ouroboros.failure_classifications_frozen();

-- ---------------------------------------------------------------------------
-- run_pr_intents — the PR toggles of one run (decision T8: intents, not gates).
-- ---------------------------------------------------------------------------
create table ouroboros.run_pr_intents (
  run_id               uuid        primary key,

  organization_id      text        not null
                                   references ouroboros.organization ("id") on delete cascade,

  -- Block PR until green. Stored intent; enforced by #358 / #360 once the PR plane lands.
  block_until_green    boolean     not null default false,

  -- Auto re-run physical suite after fix. Read by #332 after a correction round.
  auto_rerun_physical  boolean     not null default false,

  updated_by           text        references ouroboros."user" ("id") on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint run_pr_intents_run_fk
    foreign key (run_id, organization_id)
    references ouroboros.runs ("id", organization_id) on delete cascade
);

comment on table ouroboros.run_pr_intents is
  'The Mark & Route card''s PR toggles for one run (#327, AS.4, decision T8). INTENTS, NOT GATES: nothing enforces them until mockup 12''s PR plane — block_until_green is evaluated by #358 and enforced by #360 (AV.2, #344). See V055''s header.';
comment on column ouroboros.run_pr_intents.block_until_green is
  'Block PR until green — a stored intent. Blocks nothing until the gate engine (#358) and merge executor re-check (#360) consume it.';
comment on column ouroboros.run_pr_intents.auto_rerun_physical is
  'Auto re-run physical suite after fix — read by the routing service (#332) after a correction round.';
comment on column ouroboros.run_pr_intents.updated_by is
  'Who last set the toggles; set null if the person is removed.';

create trigger run_pr_intents_touch_updated_at
  before update on ouroboros.run_pr_intents
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- pr_waivers — Waive & annotate PR: an authored, reasoned record, append-only.
-- ---------------------------------------------------------------------------
create table ouroboros.pr_waivers (
  id                uuid        primary key default gen_random_uuid(),

  organization_id   text        not null
                                references ouroboros.organization ("id") on delete cascade,

  run_id            uuid        not null,

  -- Required at insert; set null if the person is removed, so the waiver outlives them.
  author            text        references ouroboros."user" ("id") on delete set null,

  -- A waiver without a reason is not a waiver.
  reason            text        not null,

  -- The waived cases, by durable case_key (decision T2). Empty for a criterion-level waiver.
  case_keys         text[]      not null default '{}',

  -- pending_pr_plane until #359 posts the annotation (AV.2, #344).
  annotation_state  text        not null default 'pending_pr_plane',

  created_at        timestamptz not null default now(),

  constraint pr_waivers_run_fk
    foreign key (run_id, organization_id)
    references ouroboros.runs ("id", organization_id) on delete cascade,

  constraint pr_waivers_reason_present
    check (btrim(reason) <> '' and length(reason) <= 4096),

  constraint pr_waivers_case_keys_shape
    check (array_position(case_keys, null) is null
           and array_to_string(case_keys, ',') ~ '^([0-9a-f]{64}(,[0-9a-f]{64})*)?$'),

  constraint pr_waivers_annotation_state
    check (annotation_state in ('pending_pr_plane'))
);

comment on table ouroboros.pr_waivers is
  'Waive & annotate PR (#327, AS.4, decision T8): author, required reason, waived case_keys and when. Append-only. The annotation half is deferred to the PR plane — #359 posts it, #354''s pr_criteria.waiver_ref references it — so annotation_state is pending_pr_plane until then.';
comment on column ouroboros.pr_waivers.author is
  'Who waived. Required at insert; set null if the person is removed.';
comment on column ouroboros.pr_waivers.reason is
  'Why — required and never blank. A waiver without a reason is not a waiver.';
comment on column ouroboros.pr_waivers.case_keys is
  'The waived cases by durable case_key; each must be a case of one of the run''s attempts. Empty for a waiver of a criterion rather than of cases.';
comment on column ouroboros.pr_waivers.annotation_state is
  'pending_pr_plane — the only value until #359 can post the annotation to the host PR and widens this vocabulary.';

create index pr_waivers_run_idx
  on ouroboros.pr_waivers (run_id, created_at);

create function ouroboros.pr_waivers_before_insert()
returns trigger
language plpgsql
as $$
declare
  unknown text;
begin
  if new.author is null then
    raise exception 'a waiver names its author'
      using errcode = 'check_violation', constraint = 'pr_waivers_author_present';
  end if;

  -- A malformed key is pr_waivers_case_keys_shape's to refuse, by its own name.
  select k into unknown
    from unnest(new.case_keys) k
   where k ~ '^[0-9a-f]{64}$'
     and not exists (
           select 1
             from ouroboros.test_cases tc
             join ouroboros.test_suites s on s.id = tc.test_suite_id
             join ouroboros.test_runs t   on t.id = s.test_run_id
            where t.run_id = new.run_id
              and tc.organization_id = new.organization_id
              and tc.case_key = k)
   limit 1;

  if found then
    raise exception 'case % is not a case of run %', unknown, new.run_id
      using errcode = 'check_violation', constraint = 'pr_waivers_case_keys_of_run';
  end if;

  return new;
end;
$$;

comment on function ouroboros.pr_waivers_before_insert() is
  'Refuses a waiver without an author, or one naming a case_key that is not a case of one of the run''s attempts (#327).';

create trigger pr_waivers_before_insert
  before insert on ouroboros.pr_waivers
  for each row execute function ouroboros.pr_waivers_before_insert();

-- ---------------------------------------------------------------------------
-- test_artifacts — the registry: where each file is, until when, and whether it is gone.
-- ---------------------------------------------------------------------------
create table ouroboros.test_artifacts (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  test_run_id      uuid        not null,

  name             text        not null,
  kind             text        not null,
  size_bytes       bigint      not null,

  -- {"driver": "local" | "s3" | …, "key": "…"} — the driver is data, not schema.
  storage_ref      jsonb       not null,

  -- "<algorithm>:<hex digest>", e.g. sha256:…
  checksum         text        not null,

  -- The retention policy's date — what the sweep acts on.
  retained_until   timestamptz not null,

  -- The tombstone: the bytes are gone, the row is kept, the card says "expired".
  expired_at       timestamptz,

  -- From the upload manifest: the file was cut short, and why.
  truncated        boolean     not null default false,
  truncation_note  text,

  created_at       timestamptz not null default now(),

  constraint test_artifacts_test_run_name_key unique (test_run_id, name),

  constraint test_artifacts_test_run_fk
    foreign key (test_run_id, organization_id)
    references ouroboros.test_runs (id, organization_id) on delete cascade,

  constraint test_artifacts_name_present
    check (btrim(name) <> '' and length(name) <= 255),

  constraint test_artifacts_kind
    check (kind in ('junit', 'hil', 'coverage', 'log', 'capture', 'other')),

  constraint test_artifacts_size_non_negative
    check (size_bytes >= 0),

  constraint test_artifacts_storage_ref_shape
    -- Coalesced: a missing key makes every term null, and a null CHECK passes.
    check (coalesce(jsonb_typeof(storage_ref) = 'object'
                    and jsonb_typeof(storage_ref -> 'driver') = 'string'
                    and storage_ref ->> 'driver' ~ '^[a-z][a-z0-9_]*$'
                    and jsonb_typeof(storage_ref -> 'key') = 'string'
                    and btrim(storage_ref ->> 'key') <> '', false)),

  constraint test_artifacts_checksum_shape
    check (checksum ~ '^[a-z0-9]+:[0-9a-f]{32,128}$'),

  constraint test_artifacts_retained_after_created
    check (retained_until >= created_at),

  constraint test_artifacts_expired_after_created
    check (expired_at is null or expired_at >= created_at),

  constraint test_artifacts_truncation_note
    check (truncated = (truncation_note is not null)
           and (truncation_note is null or btrim(truncation_note) <> ''))
);

comment on table ouroboros.test_artifacts is
  'One file an attempt uploaded (#327, AS.4, option 3-A) — the artifacts card and the registry the retention sweep acts on. Expiry is a tombstone (expired_at), never a delete; rows leave only with their attempt.';
comment on column ouroboros.test_artifacts.kind is
  'junit | hil | coverage | log | capture | other.';
comment on column ouroboros.test_artifacts.storage_ref is
  'Where the bytes are: {"driver": ..., "key": ...}. The driver is data (local, s3, …), so moving storage is a row update, not a migration. Kept after expiry, for the audit.';
comment on column ouroboros.test_artifacts.checksum is
  'Algorithm-prefixed hex digest of the stored bytes, e.g. sha256:<64 hex>.';
comment on column ouroboros.test_artifacts.retained_until is
  'The retention policy''s date (retained 30d). The sweep expires live artifacts past it; it may be extended while the artifact is live and is final once expired.';
comment on column ouroboros.test_artifacts.expired_at is
  'The tombstone: when the sweep removed the bytes. Null while live; once set it never clears, so an expired artifact is distinguishable from one that never existed.';
comment on column ouroboros.test_artifacts.truncated is
  'The upload manifest reported the file cut short. Exactly when true, truncation_note says why.';

-- The sweep: live artifacts whose retention has passed.
create index test_artifacts_retention_idx
  on ouroboros.test_artifacts (retained_until)
  where expired_at is null;

create function ouroboros.test_artifacts_lifecycle()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - array['storage_ref', 'retained_until', 'expired_at'])
     is distinct from (to_jsonb(old) - array['storage_ref', 'retained_until', 'expired_at']) then
    raise exception 'artifact % describes an uploaded file and cannot be rewritten', old.id
      using errcode = 'check_violation', constraint = 'test_artifacts_frozen';
  end if;

  if old.expired_at is not null
     and (new.expired_at, new.retained_until, new.storage_ref)
         is distinct from (old.expired_at, old.retained_until, old.storage_ref) then
    raise exception 'artifact % expired at % and its tombstone is final', old.id, old.expired_at
      using errcode = 'check_violation', constraint = 'test_artifacts_tombstone_final';
  end if;

  return new;
end;
$$;

comment on function ouroboros.test_artifacts_lifecycle() is
  'Holds an artifact row to its upload (#327): only storage_ref (a storage move), retained_until (an extension) and expired_at (the tombstone) change, and nothing changes once expired.';

create trigger test_artifacts_lifecycle
  before update on ouroboros.test_artifacts
  for each row execute function ouroboros.test_artifacts_lifecycle();

-- ---------------------------------------------------------------------------
-- Grants.
--
-- V022's block, for V022's reason.
--
--   * **A classification is inserted, then receives its receipt and its successor.** Column
--     grants on routed and superseded_by; the triggers above hold both to written-once.
--   * **Intents are upserted** per run and leave with it.
--   * **Waivers are append-only.** #359 grants what it needs to post the annotation.
--   * **Artifacts are registered, moved, extended and tombstoned** — never deleted.
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert on ouroboros.failure_classifications to ouroboros_app;
grant update (routed, superseded_by) on ouroboros.failure_classifications to ouroboros_app;
grant select, insert, update on ouroboros.run_pr_intents to ouroboros_app;
grant select, insert on ouroboros.pr_waivers to ouroboros_app;
grant select, insert, update on ouroboros.test_artifacts to ouroboros_app;
revoke execute on function ouroboros.failure_classifications_routed_valid(text, uuid, jsonb)
  from public;
grant execute on function ouroboros.failure_classifications_routed_shaped(jsonb),
                          ouroboros.failure_classifications_routed_valid(text, uuid, jsonb)
  to ouroboros_app;
