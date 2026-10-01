-- V079__intervention_events.sql — `intervention_events`, `intervention_cause_rules` and
-- `intervention_overrides`: every moment a human had to step in, mapped to a cause by a versioned
-- rule, correctable by a person, and auditable either way (#434, BI.3, decision I5).
--
-- Mockup 15's *"Where loops still need humans"* card — `Flaky env / rig 8`, `Ambiguous ticket 5`,
-- `Policy gate (refactor) 4`, `Model disagreement 2`, `Other 1`, and *"Fix the top row and
-- interventions drop ~40%"* — is the easiest card on the page to fake. So every bar segment is a
-- count of rows here, and every row names the record it came from.
--
-- ===========================================================================
-- THE EVENTS — one row per moment, named by its source record
-- ===========================================================================
--
--   source            source_ref                    detected_at            signals
--   needs_human_run   the run's id                  runs.finished_at       the run's context (below)
--   classification    failure_classifications.id    created_at             class:…, subtype:…
--                     (actor = human only — a heuristic or model pick is not a person stepping in)
--   waiver            pr_waivers.id                 created_at             none
--   guardrail         '<run id>/<check>'            first failing          check:<check>
--   policy_gate       '<run id>/review_required'    evaluation's instant   check:review_required
--   vote_block        the vote's id (#371)          the vote's instant     vote:blocking
--
-- A guardrail stop is the **first** `fail` of one check on one loop — a check that re-evaluates
-- and fails again is the same stop — and the `review_required` check is the policy gate, so it is
-- recorded under that source. Both are #433's interventions extractor's definitions, unchanged.
--
-- **`unique (source, source_ref)` is what makes the hooks idempotent.** Every hook calls
-- `sync_intervention_events(run)`, which re-derives the run's events from its source records and
-- upserts them on that key: replaying a run's records during a backfill re-derives the same rows
-- and creates none. Sync never deletes an event — a loop that stopped for a person did, even if
-- it was later resumed.
--
-- **A needs-human stop's cause comes from the run's records.** The stop itself says only that the
-- loop handed off; why is in what else the run holds. Its signals are the run's *context*: the
-- current classification of every case it ran (any actor — a heuristic `infra_rig` hint is
-- evidence of why), the checks it failed, and the signals of its table-less events (a blocking
-- vote). The roadmap's example is exactly this: `needs_human(run#1832) + AT.4{infra_rig} → infra_rig`.
-- Sync refreshes the context whenever a hook fires for the run, so a classification that arrives
-- after the handoff re-explains it.
--
-- One loop can therefore produce more than one event — a handoff and the classification that
-- explains it are two moments a person was needed — which is what the registry's caveat says.
--
-- ===========================================================================
-- THE RULES — declarative, versioned, first match wins
-- ===========================================================================
--
--   priority  rule_id                  matches                         cause
--   10        infra-rig-classification class:infra_rig                 infra_rig
--   20        rig-offline-guardrail    check:rig_offline               infra_rig
--   30        unclear-requirements     subtype:unclear_requirements    ambiguous_ticket
--   40        workflow-human-gate      gate:human                      policy_gate
--   50        review-required          check:review_required           policy_gate
--   60        blocking-vote            vote:blocking                   model_disagreement
--   1000      residue                  anything                        other
--
-- `intervention_cause()` picks the lowest-priority rule whose source (null = any) and signal
-- (null = any) match the event. The residue rule matches everything, so **an unmatched event lands
-- in `other` rather than being dropped**. Changing what a rule matches or maps to requires its
-- `version` to increase (`intervention_cause_rules_version_guard`), and every event records the
-- rule and version that assigned it.
--
-- Three signals are **reserved** — in the vocabulary, mapped by a rule, and emitted by no hook yet,
-- because the record they read does not exist yet:
--
--   * `check:rig_offline` — V048's guardrail vocabulary has no rig-offline check;
--   * `gate:human`        — the workflow DSL's gates are check predicates, not human approvals;
--   * `vote:blocking`     — AZ.1's votes (#371) are not built. Its hook calls
--                           `record_intervention_event(…, 'vote_block', …, '{vote:blocking}')`.
--
-- **A rule-origin cause is the rules' answer, structurally.** `intervention_events_apply_rules`
-- recomputes `cause`, `rule_id` and `rule_version` from the signals on every insert and every
-- update of a rule-origin row, whatever the writer supplied. `apply_intervention_rules()` is the
-- rule run — it re-derives every rule-origin event after a rule changes.
--
-- ===========================================================================
-- HUMAN RE-CATEGORIZATION — never overwritten by a later rule run
-- ===========================================================================
--
-- A person (member and above — the REST route's gate) re-categorizes through
-- `recategorize_intervention()`, which writes an `intervention_overrides` row (actor, from, to,
-- reason) and sets `cause_origin = 'human'` in one statement. The trigger holds both halves:
--
--   * a human cause cannot be set without an override row naming it, written in the same
--     transaction — so the audit trail cannot be skipped;
--   * a `human` row cannot go back to `rule`, and a rule run skips it — so the correction is not
--     a fiction that lasts until the next nightly job. Sync still refreshes its signals; only the
--     cause is the person's.
--
-- Overrides are append-only.
--
-- ===========================================================================
-- THE REGISTRY — `human_interventions` gains the cause dimension (version 2)
-- ===========================================================================
--
-- #433's interventions family counted needs-human handoffs and first guardrail failures as one
-- total, waiting on this migration for causes. It now counts these events, one row per cause
-- (`dimension_kind = 'cause'`), read through `intervention_cause_daily`. What the metric means
-- changed, so its version moves to 2, and its existing undimensioned rows — rollup output, never
-- source data — are deleted with the family's bookkeeping so the next tick backfills it.

-- ---------------------------------------------------------------------------
-- The vocabularies
-- ---------------------------------------------------------------------------
create function ouroboros.intervention_signals_known(p_signals text[])
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(bool_and(s ~ ('^(class:(product_bug|test_update|flake_retry|infra_rig)'
                                || '|subtype:unclear_requirements'
                                || '|check:(allowed_paths|ci_config|secrets|review_required|rig_offline)'
                                || '|gate:human'
                                || '|vote:blocking)$')), true)
    from unnest(p_signals) as s
$$;

comment on function ouroboros.intervention_signals_known(text[]) is
  'True when every signal is in the closed vocabulary the cause rules read (#434): class:<failure class>, subtype:unclear_requirements, check:<guardrail check or the reserved rig_offline>, gate:human (reserved), vote:blocking (#371). A null element is not known.';

-- ---------------------------------------------------------------------------
-- intervention_cause_rules
-- ---------------------------------------------------------------------------
create table ouroboros.intervention_cause_rules (
  rule_id     text        primary key
                          constraint intervention_cause_rules_rule_id_format
                            check (rule_id ~ '^[a-z][a-z0-9-]{0,62}$'),

  -- Bumped with every change to what the rule matches or maps to.
  version     integer     not null default 1
                          constraint intervention_cause_rules_version_positive
                            check (version >= 1),

  -- Evaluation order: the lowest-priority matching rule wins.
  priority    integer     not null
                          constraint intervention_cause_rules_priority_key unique
                          constraint intervention_cause_rules_priority_positive
                            check (priority > 0),

  -- The source the rule applies to; null for any.
  source      text
              constraint intervention_cause_rules_source_known
                check (source in ('needs_human_run', 'classification', 'waiver', 'policy_gate',
                                  'guardrail', 'vote_block')),

  -- The signal the event must carry; null for any.
  signal      text
              constraint intervention_cause_rules_signal_known
                check (signal is null or ouroboros.intervention_signals_known(array[signal])),

  cause       text        not null
              constraint intervention_cause_rules_cause_known
                check (cause in ('infra_rig', 'ambiguous_ticket', 'policy_gate',
                                 'model_disagreement', 'other')),

  -- What the rule is for, in a sentence. Copy: editable at the same version.
  description text        not null
              constraint intervention_cause_rules_description_present
                check (btrim(description) <> ''),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- A rule that matches everything is the residue, and the residue is `other`.
  constraint intervention_cause_rules_catch_all_is_other
    check (source is not null or signal is not null or cause = 'other')
);

comment on table ouroboros.intervention_cause_rules is
  'The intervention-cause mapping (#434, decision I5) — declarative and versioned. intervention_cause() returns the lowest-priority rule whose source and signal (null = any) match an event; the residue rule maps everything else to other. A change to priority, source, signal or cause requires a version bump.';
comment on column ouroboros.intervention_cause_rules.signal is
  'The signal an event must carry for the rule to match (intervention_signals_known), or null for any.';

create trigger intervention_cause_rules_touch_updated_at
  before update on ouroboros.intervention_cause_rules
  for each row execute function ouroboros.touch_updated_at();

-- The version rule — V076's, for the cause rules.
create function ouroboros.intervention_cause_rules_version_guard()
returns trigger language plpgsql as $$
begin
  if new.version < old.version then
    raise exception 'intervention rule % version cannot go backwards (% → %)',
      old.rule_id, old.version, new.version
      using errcode = 'check_violation', constraint = 'intervention_cause_rules_version_guard';
  end if;

  if (new.priority, new.source, new.signal, new.cause)
       is distinct from (old.priority, old.source, old.signal, old.cause)
     and new.version <= old.version then
    raise exception 'intervention rule % changed what it maps without bumping version (still %)',
      old.rule_id, old.version
      using errcode = 'check_violation', constraint = 'intervention_cause_rules_version_guard';
  end if;

  return new;
end;
$$;

comment on function ouroboros.intervention_cause_rules_version_guard() is
  'Refuses an update to intervention_cause_rules that changes priority, source, signal or cause without increasing version, or that lowers version (#434).';

create trigger intervention_cause_rules_version_guard
  before update on ouroboros.intervention_cause_rules
  for each row execute function ouroboros.intervention_cause_rules_version_guard();

insert into ouroboros.intervention_cause_rules (rule_id, priority, source, signal, cause, description)
values
  ('infra-rig-classification', 10, null, 'class:infra_rig', 'infra_rig',
   'A failure classified infra_rig (#332) — the environment or the rig failed, not the code.'),
  ('rig-offline-guardrail', 20, null, 'check:rig_offline', 'infra_rig',
   'A rig-offline guardrail stop. Reserved: the guardrail vocabulary has no rig-offline check yet.'),
  ('unclear-requirements', 30, null, 'subtype:unclear_requirements', 'ambiguous_ticket',
   'A failure a person classified as unclear requirements (#332''s subtype) — the ticket was underspecified.'),
  ('workflow-human-gate', 40, null, 'gate:human', 'policy_gate',
   'A workflow human-gate stop. Reserved: the workflow DSL has no human-approval gate yet.'),
  ('review-required', 50, null, 'check:review_required', 'policy_gate',
   'The review-required policy check failed — the workflow''s policy asked for a person.'),
  ('blocking-vote', 60, null, 'vote:blocking', 'model_disagreement',
   'A blocking second-model review vote (#371) — the models disagreed.'),
  ('residue', 1000, null, null, 'other',
   'Anything no other rule matched. Recorded, never dropped.');

-- ---------------------------------------------------------------------------
-- intervention_cause — the rules, as a function
-- ---------------------------------------------------------------------------
create function ouroboros.intervention_cause(p_source text, p_signals text[],
                                             out cause text, out rule_id text,
                                             out rule_version integer)
language plpgsql
stable
as $$
begin
  select r.cause, r.rule_id, r.version
    into cause, rule_id, rule_version
    from ouroboros.intervention_cause_rules r
   where (r.source is null or r.source = p_source)
     and (r.signal is null or r.signal = any (coalesce(p_signals, '{}')))
   order by r.priority
   limit 1;

  if not found then
    raise exception 'no intervention rule matched source % — the residue rule is missing', p_source
      using errcode = 'check_violation', constraint = 'intervention_cause_rules_residue';
  end if;
end;
$$;

comment on function ouroboros.intervention_cause(text, text[]) is
  'The cause, rule and rule version the cause rules assign an event with this source and these signals (#434): the lowest-priority matching rule. Raises when nothing matches, which only a missing residue rule allows.';

-- ---------------------------------------------------------------------------
-- intervention_events
-- ---------------------------------------------------------------------------
create table ouroboros.intervention_events (
  id              uuid        primary key default gen_random_uuid(),

  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The loop a person stepped into. Composite with the workspace; cascades with it.
  run_id          uuid        not null,

  source          text        not null
                  constraint intervention_events_source_known
                    check (source in ('needs_human_run', 'classification', 'waiver',
                                      'policy_gate', 'guardrail', 'vote_block')),

  -- The source record, in the shape the header's table gives. Text, because a guardrail stop is
  -- a (run, check) pair and a vote has no table yet.
  source_ref      text        not null
                  constraint intervention_events_source_ref_shape
                    check (btrim(source_ref) = source_ref and source_ref <> ''
                           and length(source_ref) <= 200),

  detected_at     timestamptz not null,

  -- What the rules read — see intervention_signals_known.
  signals         text[]      not null default '{}'
                  constraint intervention_events_signals_known
                    check (ouroboros.intervention_signals_known(signals)),

  cause           text        not null
                  constraint intervention_events_cause_known
                    check (cause in ('infra_rig', 'ambiguous_ticket', 'policy_gate',
                                     'model_disagreement', 'other')),

  cause_origin    text        not null default 'rule'
                  constraint intervention_events_cause_origin_known
                    check (cause_origin in ('rule', 'human')),

  -- The rule and version that assigned the cause; null exactly for a human cause.
  rule_id         text        references ouroboros.intervention_cause_rules (rule_id),
  rule_version    integer,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint intervention_events_id_organization_key unique (id, organization_id),

  constraint intervention_events_run_fk
    foreign key (run_id, organization_id)
    references ouroboros.runs ("id", organization_id) on delete cascade,

  -- What makes every hook idempotent.
  constraint intervention_events_source_key unique (source, source_ref),

  constraint intervention_events_rule_stamp
    check ((cause_origin = 'rule') = (rule_id is not null)
           and (rule_id is null) = (rule_version is null))
);

comment on table ouroboros.intervention_events is
  'Every moment a person had to step into a loop (#434, BI.3, decision I5) — a needs-human handoff, a human failure classification, a waiver, a guardrail or policy-gate stop, a blocking vote — with the cause a versioned rule assigned or a person re-categorized it to. Unique on (source, source_ref), so replaying a run''s records creates nothing new. Written by sync_intervention_events().';
comment on column ouroboros.intervention_events.source_ref is
  'The source record: the run id (needs_human_run), failure_classifications.id, pr_waivers.id, ''<run id>/<check>'' (guardrail, policy_gate) or the vote id (vote_block).';
comment on column ouroboros.intervention_events.signals is
  'The facts the cause rules read. A needs-human handoff carries its run''s context; every other event its own record''s.';
comment on column ouroboros.intervention_events.cause_origin is
  'rule — computed from the signals on every write; human — set by recategorize_intervention() with an override row, and never overwritten by a rule run.';
comment on column ouroboros.intervention_events.rule_id is
  'The rule that assigned the cause, with rule_version. Null exactly when a person set it.';

-- The card and the extractor: one workspace, a window of detections.
create index intervention_events_organization_detected_idx
  on ouroboros.intervention_events (organization_id, detected_at);
create index intervention_events_run_idx
  on ouroboros.intervention_events (run_id);

create trigger intervention_events_touch_updated_at
  before update on ouroboros.intervention_events
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- intervention_overrides — the re-categorization audit
-- ---------------------------------------------------------------------------
create table ouroboros.intervention_overrides (
  id              uuid        primary key default gen_random_uuid(),

  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  event_id        uuid        not null,

  -- Who. Required at insert; set null if the person is removed, so the record outlives them.
  actor_id        text        references ouroboros."user" ("id") on delete set null,

  from_cause      text        not null
                  constraint intervention_overrides_from_cause_known
                    check (from_cause in ('infra_rig', 'ambiguous_ticket', 'policy_gate',
                                          'model_disagreement', 'other')),
  to_cause        text        not null
                  constraint intervention_overrides_to_cause_known
                    check (to_cause in ('infra_rig', 'ambiguous_ticket', 'policy_gate',
                                        'model_disagreement', 'other')),

  -- Why. A correction without a reason is not auditable.
  reason          text        not null
                  constraint intervention_overrides_reason_present
                    check (btrim(reason) <> '' and length(reason) <= 2000),

  created_at      timestamptz not null default now(),

  constraint intervention_overrides_event_fk
    foreign key (event_id, organization_id)
    references ouroboros.intervention_events ("id", organization_id) on delete cascade,

  constraint intervention_overrides_changes_cause
    check (from_cause <> to_cause)
);

comment on table ouroboros.intervention_overrides is
  'Every human re-categorization of an intervention event (#434) — actor, from-cause, to-cause, reason, when. Append-only; written by recategorize_intervention() in the same statement as the event''s change.';

create index intervention_overrides_event_idx
  on ouroboros.intervention_overrides (event_id, created_at);

-- An override is written by a named person, from the event's current cause, and never changed
-- afterwards (the actor's set-null is the one exception).
create function ouroboros.intervention_overrides_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.actor_id is null then
      raise exception 'an intervention override names the person who made it'
        using errcode = 'check_violation', constraint = 'intervention_overrides_actor_required';
    end if;

    if not exists (select 1 from ouroboros.intervention_events e
                    where e.id = new.event_id and e.cause = new.from_cause) then
      raise exception 'intervention override from % does not match event %''s current cause',
        new.from_cause, new.event_id
        using errcode = 'check_violation', constraint = 'intervention_overrides_from_current';
    end if;

    return new;
  end if;

  if (new.id, new.organization_id, new.event_id, new.from_cause, new.to_cause, new.reason,
      new.created_at)
       is distinct from
     (old.id, old.organization_id, old.event_id, old.from_cause, old.to_cause, old.reason,
      old.created_at)
     or new.actor_id is not null and new.actor_id is distinct from old.actor_id then
    raise exception 'intervention overrides are append-only'
      using errcode = 'check_violation', constraint = 'intervention_overrides_append_only';
  end if;

  return new;
end;
$$;

comment on function ouroboros.intervention_overrides_guard() is
  'Holds intervention_overrides to its contract (#434): an insert names its actor and starts from the event''s current cause; nothing is updated afterwards except the actor''s set-null on user deletion.';

create trigger intervention_overrides_guard
  before insert or update on ouroboros.intervention_overrides
  for each row execute function ouroboros.intervention_overrides_guard();

-- ---------------------------------------------------------------------------
-- intervention_events_apply_rules — the rules and the human protection, structurally
-- ---------------------------------------------------------------------------
create function ouroboros.intervention_events_apply_rules()
returns trigger language plpgsql as $$
declare
  assigned record;
begin
  if tg_op = 'INSERT' and new.cause_origin <> 'rule' then
    raise exception 'an intervention event is born with a rule''s cause; a person re-categorizes it afterwards'
      using errcode = 'check_violation', constraint = 'intervention_events_born_of_rule';
  end if;

  if tg_op = 'UPDATE' then
    if (new.organization_id, new.run_id, new.source, new.source_ref)
         is distinct from (old.organization_id, old.run_id, old.source, old.source_ref) then
      raise exception 'intervention event % cannot change what it is about', old.id
        using errcode = 'check_violation', constraint = 'intervention_events_identity_frozen';
    end if;

    if old.cause_origin = 'human' and new.cause_origin = 'rule' then
      raise exception 'intervention event % was re-categorized by a person; a rule cannot overwrite it',
        old.id
        using errcode = 'check_violation', constraint = 'intervention_events_human_kept';
    end if;
  end if;

  if new.cause_origin = 'rule' then
    assigned := ouroboros.intervention_cause(new.source, new.signals);
    new.cause        := assigned.cause;
    new.rule_id      := assigned.rule_id;
    new.rule_version := assigned.rule_version;
    return new;
  end if;

  -- A human cause, newly set or changed, is backed by an override written in this transaction.
  if (old.cause_origin, old.cause) is distinct from (new.cause_origin, new.cause)
     and not exists (select 1 from ouroboros.intervention_overrides o
                      where o.event_id = new.id and o.from_cause = old.cause
                        and o.to_cause = new.cause and o.created_at = now()) then
    raise exception 'intervention event %''s cause was set to % without an override row', new.id, new.cause
      using errcode = 'check_violation', constraint = 'intervention_events_override_required';
  end if;

  return new;
end;
$$;

comment on function ouroboros.intervention_events_apply_rules() is
  'BEFORE INSERT OR UPDATE on intervention_events (#434): a rule-origin row''s cause, rule_id and rule_version are always intervention_cause(source, signals); a row is born rule-origin; a human row never returns to rule; a human cause change needs an intervention_overrides row from this transaction; source, source_ref, run and workspace are frozen.';

create trigger intervention_events_apply_rules
  before insert or update on ouroboros.intervention_events
  for each row execute function ouroboros.intervention_events_apply_rules();

-- ---------------------------------------------------------------------------
-- Writing events
-- ---------------------------------------------------------------------------

-- The one upsert every path uses. Refreshes signals (and an earlier detection) on conflict;
-- a human-set cause stays — the trigger only recomputes rule-origin rows.
create function ouroboros.upsert_intervention_event(p_organization_id text, p_run_id uuid,
                                                    p_source text, p_source_ref text,
                                                    p_detected_at timestamptz, p_signals text[])
returns uuid
language sql
as $$
  insert into ouroboros.intervention_events
    (organization_id, run_id, source, source_ref, detected_at, signals, cause)
  values (p_organization_id, p_run_id, p_source, p_source_ref, p_detected_at,
          coalesce(p_signals, '{}'), 'other')
  on conflict (source, source_ref) do update
    set signals     = excluded.signals,
        detected_at = least(intervention_events.detected_at, excluded.detected_at)
    where (intervention_events.signals, intervention_events.detected_at)
          is distinct from (excluded.signals,
                            least(intervention_events.detected_at, excluded.detected_at))
  returning id
$$;

comment on function ouroboros.upsert_intervention_event(text, uuid, text, text, timestamptz, text[]) is
  'Inserts an intervention event, or refreshes its signals and keeps its earliest detection when (source, source_ref) exists (#434). The cause is the rules'' (or the person''s) — the trigger sets it. Returns null when nothing changed.';

-- The hook body: re-derive every event of one run from its source records. Idempotent.
create function ouroboros.sync_intervention_events(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
declare
  run     ouroboros.runs%rowtype;
  context text[];
begin
  select * into run from ouroboros.runs where id = p_run_id;
  if not found then
    return;
  end if;

  -- Human failure classifications of the run's cases.
  perform ouroboros.upsert_intervention_event(
            c.organization_id, run.id, 'classification', c.id::text, c.created_at,
            array_remove(array['class:' || c.class, 'subtype:' || c.subtype], null))
     from ouroboros.failure_classifications c
     join ouroboros.test_cases tc  on tc.id = c.test_case_id
     join ouroboros.test_suites ts on ts.id = tc.test_suite_id
     join ouroboros.test_runs tr   on tr.id = ts.test_run_id
    where tr.run_id = run.id and c.actor = 'human';

  -- Waivers.
  perform ouroboros.upsert_intervention_event(
            w.organization_id, run.id, 'waiver', w.id::text, w.created_at, '{}')
     from ouroboros.pr_waivers w
    where w.run_id = run.id;

  -- The first failure of each guardrail check; review_required is the policy gate.
  perform ouroboros.upsert_intervention_event(
            run.organization_id, run.id,
            case when f."check" = 'review_required' then 'policy_gate' else 'guardrail' end,
            run.id::text || '/' || f."check", f.at, array['check:' || f."check"])
     from (select g."check", min(g.evaluated_at) as at
             from ouroboros.guardrail_evaluations g
            where g.run_id = run.id and g.verdict = 'fail'
            group by g."check") f;

  -- The needs-human handoff, explained by the run's context: the current classification of every
  -- case it ran, the checks it failed, and the signals of its table-less events.
  select coalesce(array_agg(distinct s order by s), '{}') into context
    from (select unnest(array_remove(array['class:' || c.class, 'subtype:' || c.subtype], null))
            from ouroboros.failure_classifications c
            join ouroboros.test_cases tc  on tc.id = c.test_case_id
            join ouroboros.test_suites ts on ts.id = tc.test_suite_id
            join ouroboros.test_runs tr   on tr.id = ts.test_run_id
           where tr.run_id = run.id and c.superseded_by is null
          union
          select 'check:' || g."check"
            from ouroboros.guardrail_evaluations g
           where g.run_id = run.id and g.verdict = 'fail'
          union
          select unnest(e.signals)
            from ouroboros.intervention_events e
           where e.run_id = run.id and e.source = 'vote_block') as t(s);

  if run.status = 'needs_human' then
    perform ouroboros.upsert_intervention_event(
              run.organization_id, run.id, 'needs_human_run', run.id::text, run.finished_at,
              context);
  else
    -- A loop resumed after its handoff keeps its event; only the explanation is refreshed.
    update ouroboros.intervention_events
       set signals = context
     where source = 'needs_human_run' and source_ref = run.id::text
       and signals is distinct from context;
  end if;
end;
$$;

comment on function ouroboros.sync_intervention_events(uuid) is
  'Re-derives one run''s intervention events from its source records (#434) — human classifications, waivers, first guardrail failures per check (review_required as policy_gate) and the needs-human handoff with the run''s context — upserting on (source, source_ref). Idempotent: a replay creates nothing. Never deletes an event. Every source-plane hook calls it.';

-- A source with no table of its own yet — #371's blocking votes — writes through here.
create function ouroboros.record_intervention_event(p_run_id uuid, p_source text,
                                                    p_source_ref text,
                                                    p_detected_at timestamptz,
                                                    p_signals text[])
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
declare
  org      text;
  event_id uuid;
begin
  select organization_id into org from ouroboros.runs where id = p_run_id;
  if not found then
    raise exception 'run % does not exist', p_run_id
      using errcode = 'foreign_key_violation', constraint = 'intervention_events_run_fk';
  end if;

  -- intervention_events_sync_run re-explains the run's handoff once the vote is a row.
  perform ouroboros.upsert_intervention_event(org, p_run_id, p_source, p_source_ref,
                                              p_detected_at, p_signals);

  select id into event_id from ouroboros.intervention_events
   where source = p_source and source_ref = p_source_ref;

  return event_id;
end;
$$;

comment on function ouroboros.record_intervention_event(uuid, text, text, timestamptz, text[]) is
  'Records one intervention event for a source with no table this migration can read — #371''s blocking votes call it with (run, ''vote_block'', vote id, voted at, ''{vote:blocking}''); intervention_events_sync_run then re-explains the run''s handoff (#434). Idempotent on (source, source_ref). Returns the event id.';

-- The rule run: re-derive every rule-origin event. Human-set causes are skipped.
create function ouroboros.apply_intervention_rules(p_organization_id text default null)
returns integer
language sql
as $$
  with touched as (
    update ouroboros.intervention_events e
       set cause_origin = 'rule'
     where e.cause_origin = 'rule'
       and (p_organization_id is null or e.organization_id = p_organization_id)
       and (e.cause, e.rule_id, e.rule_version)
           is distinct from (select row(a.cause, a.rule_id, a.rule_version)
                               from ouroboros.intervention_cause(e.source, e.signals) a)
    returning 1
  )
  select count(*)::integer from touched
$$;

comment on function ouroboros.apply_intervention_rules(text) is
  'The rule run (#434): re-derives the cause of every rule-origin event (in one workspace, or all) whose rule answer changed, and returns how many changed. Events a person re-categorized are never touched.';

-- A person's correction: the override row and the event's change, in one statement.
create function ouroboros.recategorize_intervention(p_organization_id text, p_event_id uuid,
                                                    p_actor_id text, p_to_cause text,
                                                    p_reason text)
returns setof ouroboros.intervention_events
language plpgsql
as $$
declare
  from_cause text;
begin
  -- Locked, so two people correcting the same event at once are ordered, and the second's
  -- from-cause is the first's to-cause.
  select e.cause into from_cause
    from ouroboros.intervention_events e
   where e.id = p_event_id and e.organization_id = p_organization_id
     for update;

  if not found then
    return;
  end if;

  -- The override first: the event's trigger requires it to exist.
  insert into ouroboros.intervention_overrides
    (organization_id, event_id, actor_id, from_cause, to_cause, reason)
  values (p_organization_id, p_event_id, p_actor_id, from_cause, p_to_cause, p_reason);

  return query
    update ouroboros.intervention_events e
       set cause = p_to_cause, cause_origin = 'human', rule_id = null, rule_version = null
     where e.id = p_event_id
    returning e.*;
end;
$$;

comment on function ouroboros.recategorize_intervention(text, uuid, text, text, text) is
  'Re-categorizes one intervention event of a workspace (#434): writes the intervention_overrides row (actor, from the current cause, to, reason) and sets cause_origin = human, atomically. Returns the event, or no row when it is not the workspace''s. The REST route holds the caller to member and above.';

-- ---------------------------------------------------------------------------
-- The hooks on the source planes
--
-- **`security definer`** on the functions that read across planes — sync, the classification
-- hook and record_intervention_event — on V055's argument: a hook runs as the writer, and the
-- writer's role need not read every plane a run's context is drawn from. `search_path` is pinned
-- with `pg_temp` last, and `execute` is revoked from `public` and granted to the service role.
-- ---------------------------------------------------------------------------
create function ouroboros.intervention_hook_run()
returns trigger language plpgsql as $$
begin
  perform ouroboros.sync_intervention_events(new.run_id);
  return null;
end;
$$;

comment on function ouroboros.intervention_hook_run() is
  'AFTER INSERT hook for a source row carrying run_id — pr_waivers, guardrail_evaluations — that re-syncs the run''s intervention events (#434).';

create function ouroboros.intervention_hook_needs_human()
returns trigger language plpgsql as $$
begin
  perform ouroboros.sync_intervention_events(new.id);
  return null;
end;
$$;

comment on function ouroboros.intervention_hook_needs_human() is
  'AFTER INSERT OR UPDATE OF status hook on runs: a loop that just became needs_human gets its handoff event (#434).';

create function ouroboros.intervention_hook_classification()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
begin
  perform ouroboros.sync_intervention_events(tr.run_id)
     from ouroboros.test_cases tc
     join ouroboros.test_suites ts on ts.id = tc.test_suite_id
     join ouroboros.test_runs tr   on tr.id = ts.test_run_id
    where tc.id = new.test_case_id;
  return null;
end;
$$;

comment on function ouroboros.intervention_hook_classification() is
  'AFTER INSERT hook on failure_classifications: re-syncs the case''s run, recording a human classification and re-explaining the run''s handoff (#434).';

create trigger runs_sync_interventions
  after insert or update of status on ouroboros.runs
  for each row when (new.status = 'needs_human')
  execute function ouroboros.intervention_hook_needs_human();

-- Named to fire after failure_classifications_supersede, so the run's context reads the new
-- current decision rather than the one it replaced.
create trigger failure_classifications_sync_interventions
  after insert on ouroboros.failure_classifications
  for each row execute function ouroboros.intervention_hook_classification();

create trigger pr_waivers_sync_interventions
  after insert on ouroboros.pr_waivers
  for each row execute function ouroboros.intervention_hook_run();

create trigger guardrail_evaluations_sync_interventions
  after insert on ouroboros.guardrail_evaluations
  for each row when (new.verdict = 'fail')
  execute function ouroboros.intervention_hook_run();

-- A table-less event (a blocking vote) is part of its run's context, so writing one re-explains
-- the run's handoff. Sync never writes a vote_block row, so this does not recurse.
create trigger intervention_events_sync_run
  after insert on ouroboros.intervention_events
  for each row when (new.source = 'vote_block')
  execute function ouroboros.intervention_hook_run();

-- ---------------------------------------------------------------------------
-- intervention_cause_daily — the shape #433's interventions extractor reads
-- ---------------------------------------------------------------------------
create view ouroboros.intervention_cause_daily as
select e.organization_id,
       r.github_repo_id,
       (e.detected_at at time zone 'UTC')::date as day,
       e.cause,
       count(*)::integer                        as events
  from ouroboros.intervention_events e
  join ouroboros.runs r on r.id = e.run_id
 group by e.organization_id, r.github_repo_id, (e.detected_at at time zone 'UTC')::date, e.cause;

comment on view ouroboros.intervention_cause_daily is
  'Intervention events per (workspace, repository, UTC day, cause) (#434) — the rows the interventions rollup family writes as human_interventions, dimension = cause.';

-- ---------------------------------------------------------------------------
-- Backfill: every run with a source record today.
-- ---------------------------------------------------------------------------
select ouroboros.sync_intervention_events(r.id)
  from ouroboros.runs r
 where r.status = 'needs_human'
    or exists (select 1 from ouroboros.pr_waivers w where w.run_id = r.id)
    or exists (select 1 from ouroboros.guardrail_evaluations g
                where g.run_id = r.id and g.verdict = 'fail')
    or exists (select 1 from ouroboros.failure_classifications c
                 join ouroboros.test_cases tc  on tc.id = c.test_case_id
                 join ouroboros.test_suites ts on ts.id = tc.test_suite_id
                 join ouroboros.test_runs tr   on tr.id = ts.test_run_id
                where tr.run_id = r.id and c.actor = 'human');

-- ---------------------------------------------------------------------------
-- The registry: human_interventions, version 2, by cause
-- ---------------------------------------------------------------------------
delete from ouroboros.metric_daily where metric_id = 'human_interventions';
delete from ouroboros.metric_rollup_state where family = 'interventions';

update ouroboros.metric_definitions
   set formula_text   = 'Intervention events detected on this day, by cause: a loop handed to a person (needs-human), a person''s failure classification or waiver, the first failure of a guardrail or policy-gate check on a loop, and blocking review votes. Each event''s cause is the one a versioned mapping rule assigned, or the one a person re-categorized it to.',
       source_planes  = '{runs,tests,interventions}',
       caveats        = 'One stop can be more than one event: a needs-human handoff and the classification that explains it are two moments a person was needed. Counts moments, not minutes spent. A re-categorized event counts under the person''s cause.',
       dimension_kind = 'cause',
       version        = 2
 where metric_id = 'human_interventions';

-- ---------------------------------------------------------------------------
-- The service role's grants
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
-- The rules ship in migrations; the service reads them.
grant select on ouroboros.intervention_cause_rules to ouroboros_app;
grant select, insert, update on ouroboros.intervention_events to ouroboros_app;
grant select, insert on ouroboros.intervention_overrides to ouroboros_app;
grant select on ouroboros.intervention_cause_daily to ouroboros_app;
revoke execute on function ouroboros.sync_intervention_events(uuid),
                           ouroboros.record_intervention_event(uuid, text, text, timestamptz, text[]),
                           ouroboros.intervention_hook_classification()
  from public;
grant execute on function ouroboros.sync_intervention_events(uuid),
                          ouroboros.record_intervention_event(uuid, text, text, timestamptz, text[]),
                          ouroboros.intervention_hook_classification()
  to ouroboros_app;
