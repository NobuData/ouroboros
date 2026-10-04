-- V097__decision_kinds_mvp_source_resolved.sql — the six remaining MVP kind declarations, and the
-- out-of-band closure every kind needs (#461, BN.1, decisions X1/X2/X4).
--
-- V093 shipped the three declarations mockup 16 fixes word for word and said every other kind's
-- declaration arrives with its emitter. BN.1 is those emitters, so this migration is:
--
--   1. **Six declarations, v1 each** — `plan_sign_off`, `fact_review`, `run_needs_human`,
--      `split_approval`, `resize_review` and `spend_approval`. Each composes its question and why
--      from facts its plane already has (the BN.1 adapters in ouroboros-rest name them).
--      `fact_review` is `info`, so knowledge housekeeping never outranks a blocked loop;
--      `resize_review` is the one auto-resolvable kind (mockup 16's *auto-accepted by policy*);
--      `spend_approval` is declared so its shape is fixed now, but nothing emits it until AF.4
--      (#237) enforces caps — the REST registry holds it dormant.
--   2. **`policy(source_resolved)`** (X4) — a PR merged directly on GitHub, a run cancelled from the
--      console, a fact reviewed on the knowledge page: each leaves a card asking permission for
--      something already settled. The item closes itself with a resolution whose resolver is the
--      reserved policy `source_resolved` and whose action is the reserved action
--      `source_resolved`, so the resolved list still accounts for it. V095 refused that row twice
--      — a policy may answer only an auto-resolvable kind, and the action must be one the kind's
--      `answered_by` lists — and both refusals are right for every *answer*. A source closure is
--      not an answer: it decides nothing, it records that the question stopped being one. So the
--      two triggers exempt exactly the reserved triple (resolver `policy`, policy
--      `source_resolved`, action `source_resolved`, no note), a CHECK holds the action and the
--      policy together so neither half can be borrowed, and `decision_item_source_resolve` is
--      the one writer. A merge-class kind is still never *answered* by a policy: closing
--      `merge_approval` because the PR merged elsewhere approves nothing.
--   3. **The weekly metrics leave source closures out.** *11 decisions · median answer time 41s*
--      counts questions somebody answered; a card closed because its source settled elsewhere was
--      never answered, and its "latency" is how long the question sat stale. Both views are
--      recreated with that one filter, and the `decisions_resolved` caveat says so (copy only, so
--      the metric keeps its version).
--
-- ---------------------------------------------------------------------------
-- Reverting
-- ---------------------------------------------------------------------------
--
-- Flyway's community edition has no undo migrations, so this repository reverts forward. The
-- inverse: recreate V095's two metric views, V095's bodies of
-- decision_resolutions_policy_may_answer and decision_resolutions_action_answers, and
--
--   drop function ouroboros.decision_item_source_resolve(uuid, text, jsonb);
--   alter table ouroboros.decision_resolutions
--     drop constraint decision_resolutions_source_resolved_pair;
--   -- decision_kinds is immutable for every role; a revert disables decision_kinds_immutable,
--   -- deletes the six v1 rows (and every item filed against them), and re-enables it.

-- ---------------------------------------------------------------------------
-- 1. The reserved pair: the action and the policy name each other, or neither is used.
-- ---------------------------------------------------------------------------
alter table ouroboros.decision_resolutions
  add constraint decision_resolutions_source_resolved_pair
    check ((action_id = 'source_resolved')
           = (resolver = 'policy' and resolved_by_policy is not distinct from 'source_resolved')
           and (action_id <> 'source_resolved' or note is null));

comment on constraint decision_resolutions_source_resolved_pair on ouroboros.decision_resolutions is
  'The out-of-band closure (#461, X4): action source_resolved exactly when the resolver is policy source_resolved, and it carries no note. Neither half can be borrowed — no human resolution and no other policy may use the reserved action, and the reserved policy answers nothing else.';

-- ---------------------------------------------------------------------------
-- 2. V095's two answer rules, with the closure exempt.
-- ---------------------------------------------------------------------------
create or replace function ouroboros.decision_resolutions_policy_may_answer() returns trigger
language plpgsql
as $$
declare
  kind      text;
  automatic boolean;
begin
  if new.resolver is distinct from 'policy' then
    return new;
  end if;

  -- An out-of-band closure decides nothing, so it may close any kind (#461). The pair CHECK
  -- holds the action to it.
  if new.resolved_by_policy = 'source_resolved' and new.action_id = 'source_resolved' then
    return new;
  end if;

  select i.kind_id, (k.resolution_semantics ->> 'auto_resolvable')::boolean into kind, automatic
    from ouroboros.decision_items i
    join ouroboros.decision_kinds k on k.kind_id = i.kind_id and k.version = i.kind_version
   where i.id = new.item_id;

  if automatic is false then
    raise exception 'decision kind % is not auto-resolvable, so policy % cannot answer it',
      kind, new.resolved_by_policy
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.decision_resolutions_policy_may_answer() is
  'BEFORE INSERT trigger for decision_resolutions (#458, #461): a policy resolution is refused unless the item''s pinned kind is auto_resolvable — V093''s guarantee that no policy turns a human (or merge-class) decision into an automatic one. The one exemption is the out-of-band closure (policy source_resolved with action source_resolved), which answers nothing. Raises class 23 naming the trigger.';

create or replace function ouroboros.decision_resolutions_action_answers() returns trigger
language plpgsql
as $$
declare
  semantics jsonb;
  actions   jsonb;
  takes     boolean;
begin
  -- The out-of-band closure is no declared action (#461); the pair CHECK holds it to its policy
  -- and to carrying no note.
  if new.action_id = 'source_resolved' and new.resolver = 'policy'
     and new.resolved_by_policy = 'source_resolved' then
    return new;
  end if;

  select k.resolution_semantics, k.actions into semantics, actions
    from ouroboros.decision_items i
    join ouroboros.decision_kinds k on k.kind_id = i.kind_id and k.version = i.kind_version
   where i.id = new.item_id;

  if semantics is null then
    return new;
  end if;

  if not (semantics -> 'answered_by') ? new.action_id then
    raise exception 'action % does not answer this item (answered by %)',
      new.action_id, semantics -> 'answered_by'
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  select (a ->> 'takes_note')::boolean into takes
    from jsonb_array_elements(actions) a
   where a ->> 'id' = new.action_id;

  if takes and new.note is null then
    raise exception 'action % takes a note, and this resolution has none', new.action_id
      using errcode = 'check_violation', constraint = tg_name;
  elsif not takes and new.note is not null then
    raise exception 'action % takes no note, and this resolution carries one', new.action_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.decision_resolutions_action_answers() is
  'BEFORE INSERT trigger for decision_resolutions (#458, #461): the action is one the item''s pinned kind lists in resolution_semantics.answered_by — never a link, never another kind''s — and the resolution carries a note exactly when that action takes one. The out-of-band closure (action source_resolved by policy source_resolved) is the one action no kind declares. Raises class 23 naming the trigger.';

-- ---------------------------------------------------------------------------
-- 3. The one writer of a closure.
-- ---------------------------------------------------------------------------
create function ouroboros.decision_item_source_resolve(
  p_item_id uuid,
  p_channel text,
  p_outcome jsonb default '{}'::jsonb
) returns boolean
language plpgsql
as $$
declare
  org text;
begin
  -- Locked, so a person answering at the same instant and this closure cannot both write: the
  -- second sees a resolved item and does nothing (the primary key would refuse it anyway).
  select i.organization_id into org
    from ouroboros.decision_items i
   where i.id = p_item_id and i.status in ('open', 'snoozed')
     for update;

  if org is null then
    return false;
  end if;

  insert into ouroboros.decision_resolutions
    (item_id, organization_id, action_id, resolver, resolved_by_policy, channel, outcome)
  values
    (p_item_id, org, 'source_resolved', 'policy', 'source_resolved', p_channel,
     coalesce(p_outcome, '{}'::jsonb))
  on conflict (item_id) do nothing;

  return found;
end;
$$;

comment on function ouroboros.decision_item_source_resolve(uuid, text, jsonb) is
  'Close a decision item whose source was settled out of band (#461, X4): a PR merged or closed on its host, a run that ended, a fact reviewed elsewhere. Writes the resolution policy(source_resolved) with the reserved action, the channel the settlement came through and an outcome receipt ({"source": "pr_merged"}). True when it closed the item; false when the item was not open or snoozed (already answered, expired, or not there) — so a watcher may call it as often as it likes. Invoker''s rights.';

-- ---------------------------------------------------------------------------
-- 4. The weekly metrics count answers, not closures.
-- ---------------------------------------------------------------------------
create or replace view ouroboros.decision_metrics_weekly_by_kind
  with (security_invoker = true) as
select r.organization_id,
       (date_trunc('week', r.resolved_at at time zone 'UTC'))::date            as week,
       i.kind_id,
       count(*)::integer                                                         as decisions,
       percentile_cont(0.5) within group (order by r.answer_latency)            as median_answer_latency
  from ouroboros.decision_resolutions r
  join ouroboros.decision_items i on i.id = r.item_id
 where r.action_id <> 'source_resolved'
 group by r.organization_id, (date_trunc('week', r.resolved_at at time zone 'UTC'))::date, i.kind_id;

comment on view ouroboros.decision_metrics_weekly_by_kind is
  'Per workspace, UTC ISO week (Monday) and decision kind (#458): decisions resolved and their median answer latency — what BO.1''s head estimate (~90 seconds for what is open) is computed from. Out-of-band closures (source_resolved, #461) answered nothing and are not counted.';

create or replace view ouroboros.decision_metrics_weekly
  with (security_invoker = true) as
with weekly as (
  select r.organization_id,
         (date_trunc('week', r.resolved_at at time zone 'UTC'))::date          as week,
         count(*)::integer                                                       as decisions,
         percentile_cont(0.5) within group (order by r.answer_latency)          as median_answer_latency,
         max(r.loop_wait)                                                        as max_loop_wait,
         (count(*) filter (where r.resolver = 'policy'))::integer                as policy_resolutions
    from ouroboros.decision_resolutions r
   where r.action_id <> 'source_resolved'
   group by r.organization_id, (date_trunc('week', r.resolved_at at time zone 'UTC'))::date
)
select w.organization_id,
       w.week,
       w.decisions,
       w.median_answer_latency,
       w.max_loop_wait,
       w.policy_resolutions,
       round(w.policy_resolutions::numeric / w.decisions, 4)                    as auto_accept_share,
       (select jsonb_object_agg(k.kind_id, extract(epoch from k.median_answer_latency)
                                order by k.kind_id)
          from ouroboros.decision_metrics_weekly_by_kind k
         where k.organization_id = w.organization_id and k.week = w.week)       as per_kind_median_answer_seconds
  from weekly w;

comment on view ouroboros.decision_metrics_weekly is
  'The Needs-You stat card (#458, BM.2): per workspace and UTC ISO week (Monday), decisions resolved, the median answer latency, the longest loop wait (null when no loop waited), policy resolutions and their share of the week, and each kind''s median answer latency in seconds. Every figure is over decision_resolutions — snoozed time included, since snooze never resets an item''s age — except out-of-band closures (source_resolved, #461), which answered nothing.';

update ouroboros.metric_definitions
   set caveats = 'Items that expired unanswered are not counted, nor items closed because their source was settled elsewhere (a PR merged on its host, a run cancelled from the console). An item answered by a policy counts like one answered by a person; the auto-accept share says how many.'
 where metric_id = 'decisions_resolved';

-- ---------------------------------------------------------------------------
-- 5. The six declarations. Each renders from the payloads in constraints.sql's V097 section:
--
--   plan_sign_off   {subject: Rework the OTA bootloader handoff, stage_label: Plan review,
--                    plan_files: 9}
--   fact_review     {reason: awaiting review, text: CAN frames are DMA-backed on helios-firmware,
--                    provenance_line: from PR #514 review cycle}
--   run_needs_human {subject: OTA rollback flag is never cleared, stage_label: Build,
--                    reason: attempt limit reached}
--   split_approval  {subject: Telemetry v2, draft_count: 6, target: acme-robotics/helios-firmware}
--   resize_review   {ticket_key: #486, from_effort: L, to_effort: M, confidence: 82}
--   spend_approval  {subject: OTA rollback flag is never cleared, spent: $2.61, cap: $2.50}
-- ---------------------------------------------------------------------------
insert into ouroboros.decision_kinds
  (kind_id, version, severity_default, question_template, why_template, payload_schema, actions,
   resolution_semantics, ref_shape, escalation_window, merge_class)
values
  ('plan_sign_off', 1, 'warn',
   'Sign off a plan before the loop builds it?',
   '{subject} is waiting at {stage_label}: its plan touches {plan_files} files. Signing off lets the loop continue.',
   '{
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "plan_sign_off v1",
      "type": "object",
      "properties": {
        "subject":     {"type": "string", "minLength": 1, "maxLength": 120,
                        "description": "The work waiting, as its ticket names it."},
        "stage_label": {"type": "string", "minLength": 1, "maxLength": 80,
                        "description": "The human-gate stage the run entered, as the pinned workflow labels it."},
        "plan_files":  {"type": "integer", "minimum": 0,
                        "description": "How many files the plan declares."}
      },
      "required": ["subject", "stage_label", "plan_files"],
      "additionalProperties": false
    }',
   '[
      {"id": "sign_off", "label": "Sign off", "style": "primary",
       "required_role": "approver",
       "consequence_text": "Records your sign-off on the plan; the loop leaves the gate and builds it.",
       "takes_note": false, "handler_binding": "workflow.sign_off_plan"},
      {"id": "view_plan", "label": "View plan →", "style": "ghost",
       "required_role": "viewer",
       "consequence_text": "Opens the plan in the run console; nothing is decided.",
       "takes_note": false, "handler_binding": "navigate.run_plan"},
      {"id": "return_to_loop", "label": "Return to loop with note", "style": "ghost",
       "required_role": "member",
       "consequence_text": "Sends the loop back to planning with your note as steering.",
       "takes_note": true, "handler_binding": "run.return_with_note"}
    ]',
   '{"answered_by": ["sign_off", "return_to_loop"], "closes_source": ["sign_off"],
     "auto_resolvable": false}',
   '{"required": ["run"], "optional": ["ticket"], "tags": []}',
   interval '30 minutes', false),

  ('fact_review', 1, 'info',
   'Should the loops trust this fact?',
   '“{text}” — {reason}, {provenance_line}.',
   '{
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "fact_review v1",
      "type": "object",
      "properties": {
        "reason":          {"type": "string", "enum": ["awaiting review", "flagged stale"],
                            "description": "Why the fact waits on a person: a new proposal, or a confirmed fact the staleness sweep flagged."},
        "text":            {"type": "string", "minLength": 1, "maxLength": 600,
                            "description": "The fact, as the knowledge page shows it."},
        "provenance_line": {"type": "string", "minLength": 1, "maxLength": 200,
                            "description": "Where it came from — from PR #514 review cycle."}
      },
      "required": ["reason", "text", "provenance_line"],
      "additionalProperties": false
    }',
   '[
      {"id": "confirm", "label": "Confirm", "style": "primary",
       "required_role": "member",
       "consequence_text": "Confirms the fact (or re-confirms a stale one); loops are told it from now on.",
       "takes_note": false, "handler_binding": "facts.confirm"},
      {"id": "retire", "label": "Retire", "style": "ghost",
       "required_role": "member",
       "consequence_text": "Rejects the proposal or expires the stale fact, with your reason; loops stop being told it.",
       "takes_note": true, "handler_binding": "facts.retire"},
      {"id": "open_fact", "label": "Open in Knowledge →", "style": "ghost",
       "required_role": "viewer",
       "consequence_text": "Opens the fact on the knowledge page; nothing is decided.",
       "takes_note": false, "handler_binding": "navigate.knowledge_fact"}
    ]',
   '{"answered_by": ["confirm", "retire"], "closes_source": ["confirm", "retire"],
     "auto_resolvable": false}',
   '{"required": [], "optional": [], "tags": ["knowledge"]}',
   interval '7 days', false),

  ('run_needs_human', 1, 'err',
   'Take over a loop that needs a human?',
   '{subject} stopped at {stage_label}: {reason}.',
   '{
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "run_needs_human v1",
      "type": "object",
      "properties": {
        "subject":     {"type": "string", "minLength": 1, "maxLength": 120,
                        "description": "The work, as its ticket names it."},
        "stage_label": {"type": "string", "minLength": 1, "maxLength": 80,
                        "description": "The stage the run was on when it handed itself to a person."},
        "reason":      {"type": "string", "minLength": 1, "maxLength": 200,
                        "description": "Why it stopped, as the run plane recorded it."}
      },
      "required": ["subject", "stage_label", "reason"],
      "additionalProperties": false
    }',
   '[
      {"id": "retry_with_note", "label": "Retry with note", "style": "primary",
       "required_role": "member",
       "consequence_text": "Retries the stage with your note as steering.",
       "takes_note": true, "handler_binding": "run.retry_with_note"},
      {"id": "open_run", "label": "Open run →", "style": "ghost",
       "required_role": "viewer",
       "consequence_text": "Opens the run console; nothing is decided.",
       "takes_note": false, "handler_binding": "navigate.run_console"},
      {"id": "cancel_run", "label": "Cancel loop", "style": "ghost",
       "required_role": "member",
       "consequence_text": "Cancels the loop; its branch is kept.",
       "takes_note": false, "handler_binding": "run.cancel"}
    ]',
   '{"answered_by": ["retry_with_note", "cancel_run"], "closes_source": ["retry_with_note", "cancel_run"],
     "auto_resolvable": false}',
   '{"required": ["run"], "optional": ["pr", "ticket"], "tags": []}',
   interval '30 minutes', false),

  ('split_approval', 1, 'info',
   'Approve a split into {draft_count} tickets?',
   'The planner split {subject} into {draft_count} draft tickets. Approving pushes them to {target}.',
   '{
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "split_approval v1",
      "type": "object",
      "properties": {
        "subject":     {"type": "string", "minLength": 1, "maxLength": 120,
                        "description": "What was split — the batch''s outline title or prompt."},
        "draft_count": {"type": "integer", "minimum": 1,
                        "description": "How many draft tickets the planner proposed."},
        "target":      {"type": "string", "minLength": 1, "maxLength": 200,
                        "description": "Where pushing files them — the target source''s name."}
      },
      "required": ["subject", "draft_count", "target"],
      "additionalProperties": false
    }',
   '[
      {"id": "approve_split", "label": "Approve & push", "style": "primary",
       "required_role": "admin",
       "consequence_text": "Pushes the selected drafts to the tracker as tickets.",
       "takes_note": false, "handler_binding": "planning.push_batch"},
      {"id": "open_batch", "label": "Open in Planning →", "style": "ghost",
       "required_role": "viewer",
       "consequence_text": "Opens the drafts on the planning page; nothing is decided.",
       "takes_note": false, "handler_binding": "navigate.planning_batch"},
      {"id": "discard", "label": "Discard", "style": "ghost",
       "required_role": "admin",
       "consequence_text": "Abandons the batch; nothing is filed.",
       "takes_note": false, "handler_binding": "planning.abandon_batch"}
    ]',
   '{"answered_by": ["approve_split", "discard"], "closes_source": ["approve_split", "discard"],
     "auto_resolvable": false}',
   '{"required": [], "optional": ["ticket"], "tags": []}',
   interval '1 day', false),

  ('resize_review', 1, 'info',
   'Accept a re-size of {ticket_key} from {from_effort} to {to_effort}?',
   'The estimator re-sized {ticket_key} from {from_effort} to {to_effort} at {confidence}% confidence. Accepting keeps the new size; keeping restores the old one.',
   '{
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "resize_review v1",
      "type": "object",
      "properties": {
        "ticket_key":  {"type": "string", "minLength": 1, "maxLength": 64,
                        "description": "The ticket''s display key — #486."},
        "from_effort": {"type": "string", "enum": ["XS", "S", "M", "L", "XL"]},
        "to_effort":   {"type": "string", "enum": ["XS", "S", "M", "L", "XL"]},
        "confidence":  {"type": "integer", "minimum": 0, "maximum": 100,
                        "description": "The new estimate''s confidence, in percent."}
      },
      "required": ["ticket_key", "from_effort", "to_effort", "confidence"],
      "additionalProperties": false
    }',
   '[
      {"id": "accept_resize", "label": "Accept new size", "style": "primary",
       "required_role": "member",
       "consequence_text": "Keeps the estimator''s new size.",
       "takes_note": false, "handler_binding": "estimation.accept_resize"},
      {"id": "keep_size", "label": "Keep the old size", "style": "ghost",
       "required_role": "member",
       "consequence_text": "Restores the previous size as the ticket''s estimate.",
       "takes_note": false, "handler_binding": "estimation.keep_size"},
      {"id": "open_ticket", "label": "Open ticket →", "style": "ghost",
       "required_role": "viewer",
       "consequence_text": "Opens the ticket and its estimate history; nothing is decided.",
       "takes_note": false, "handler_binding": "navigate.ticket"}
    ]',
   '{"answered_by": ["accept_resize", "keep_size"], "closes_source": ["accept_resize", "keep_size"],
     "auto_resolvable": true}',
   '{"required": ["ticket"], "optional": [], "tags": []}',
   interval '1 day', false),

  ('spend_approval', 1, 'warn',
   'Approve more spend on a loop past its cap?',
   '{subject} has spent {spent} against a {cap} per-run cap; the loop is paused until you decide.',
   '{
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "spend_approval v1",
      "type": "object",
      "properties": {
        "subject": {"type": "string", "minLength": 1, "maxLength": 120,
                    "description": "The work, as its ticket names it."},
        "spent":   {"type": "string", "pattern": "^\\$[0-9]+\\.[0-9]{2}$",
                    "description": "What the run has spent, in dollars as the card prints it — $2.61."},
        "cap":     {"type": "string", "pattern": "^\\$[0-9]+\\.[0-9]{2}$",
                    "description": "The per-run cap it crossed — $2.50 (spend_guard.per_run_cap_cents)."}
      },
      "required": ["subject", "spent", "cap"],
      "additionalProperties": false
    }',
   '[
      {"id": "approve_spend", "label": "Approve spend", "style": "primary",
       "required_role": "approver",
       "consequence_text": "Lets the loop continue past its per-run cap.",
       "takes_note": false, "handler_binding": "spend.approve_overage"},
      {"id": "open_run", "label": "Open run →", "style": "ghost",
       "required_role": "viewer",
       "consequence_text": "Opens the run console and its spend; nothing is decided.",
       "takes_note": false, "handler_binding": "navigate.run_console"},
      {"id": "stop_loop", "label": "Stop loop", "style": "ghost",
       "required_role": "member",
       "consequence_text": "Cancels the loop at its current spend; its branch is kept.",
       "takes_note": false, "handler_binding": "run.cancel"}
    ]',
   '{"answered_by": ["approve_spend", "stop_loop"], "closes_source": ["approve_spend", "stop_loop"],
     "auto_resolvable": false}',
   '{"required": ["run"], "optional": ["ticket"], "tags": []}',
   interval '30 minutes', false);

grant execute on function ouroboros.decision_item_source_resolve(uuid, text, jsonb) to ouroboros_app;
