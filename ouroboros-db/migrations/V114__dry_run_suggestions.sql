-- V114__dry_run_suggestions.sql — a dry run's improvement suggestions as records with a basis, and
-- the review-replay history the reviewer-pair suggestion stands on (#558, CC.4).
--
-- Mockup 20's dry-run card ends with two glowing callouts:
--
--   ✦ Make exploit-verify conditional — it stalled with nothing to do because #489 has no CVE. …  93%
--     [Apply to draft] [Explain] [Ignore]
--   ✦ Pin the pr-etiquette skill to both reviewers — in 10 replayed review pairs, the two models
--     disagreed on style nits 6 times; the shared skill removes the noise.                    81%
--
-- A suggestion that offers to modify a workflow is a **record with a basis**, not a sentence:
--
--   1. **`dry_run_suggestions`** — one suggestion of one dry run: whether a deterministic `rule`
--      (with its id and version) or the `llm` produced it, the rendered `title` and `body`, the
--      `evidence` the rule computed, the **`proposed_ops`** Apply executes — typed draft operations
--      in V110's shape, computed when the suggestion is made so Apply never re-derives intent from
--      prose — and a `confidence` stored **with** its `confidence_basis`, the scoring inputs that
--      produced it. `open → applied | ignored`, with the op batch an Apply produced.
--   2. **`review_replay_pairs`** — reviewer-pair replays over historical diffs: the data the 81%
--      card's basis is computed from. CF.5 (#574) produces it for real; until then it is seeded as
--      history, so the card's number is real in the seeded world rather than asserted.
--
-- `draft_operations.suggestion_id` (V110) gains the foreign key it was promised — deferred, so a
-- dry run swept with its suggestions sets the reference null at commit, which V110's append-only
-- trigger is amended here to allow.
--
-- A suggestion's `proposed_ops` are held to the DSL by ci/db's parity step
-- (`tests/lib/draft-operations.sql` → `scripts/draft-ops-parity.mjs`) and the draft they produce
-- by the seeded-definitions step; `dry_run_suggestion_preview()` is what folds them over a draft.
--
-- Revert forward:
--   alter table ouroboros.draft_operations drop constraint draft_operations_suggestion_fk;
--   drop table ouroboros.review_replay_pairs, ouroboros.dry_run_suggestions;
--   then drop every function this file creates and restore V110's draft_operations_refuse_update.

-- ---------------------------------------------------------------------------
-- Shape helpers.
-- ---------------------------------------------------------------------------

-- dry_run_suggestion_ops_valid(ops) — whether proposed operations are a non-empty array (at most
-- 50) of V110 draft operations.
--   ops — the jsonb value to inspect
--   returns true when every element passes draft_op_shape_valid()
create function ouroboros.dry_run_suggestion_ops_valid(ops jsonb)
returns boolean language sql immutable as $$
  select coalesce(jsonb_typeof(ops) = 'array'
                  and jsonb_array_length(ops) between 1 and 50
                  and not exists (select 1 from jsonb_array_elements(ops) op
                                   where not ouroboros.draft_op_shape_valid(op)),
                  false);
$$;

comment on function ouroboros.dry_run_suggestion_ops_valid(jsonb) is
  'True when proposed operations are a non-empty array of at most 50 V110 draft operations (#558). Their DSL validity is ci/db''s parity step.';

-- dry_run_confidence_basis_valid(basis) — whether a confidence basis names how the figure was
-- scored and what went into it: {method: non-blank string, inputs: non-empty object, …}.
--   basis — the jsonb value to inspect
--   returns true when well-formed and at most 8 KiB
create function ouroboros.dry_run_confidence_basis_valid(basis jsonb)
returns boolean language sql immutable as $$
  select coalesce(jsonb_typeof(basis) = 'object'
                  and ouroboros.jsonb_nonblank_string(basis -> 'method')
                  and jsonb_typeof(basis -> 'inputs') = 'object'
                  and basis -> 'inputs' <> '{}'::jsonb
                  and octet_length(basis::text) <= 8192,
                  false);
$$;

comment on function ouroboros.dry_run_confidence_basis_valid(jsonb) is
  'True when a confidence basis is an object with a non-blank method and a non-empty inputs object, at most 8 KiB (#558): a confidence without the inputs that produced it is decoration.';

-- ---------------------------------------------------------------------------
-- dry_run_suggestions — what a dry run suggests, with its basis.
-- ---------------------------------------------------------------------------
create table ouroboros.dry_run_suggestions (
  id                  uuid        primary key default gen_random_uuid(),

  organization_id     text        not null,

  -- The dry run whose outcome it reads. Cascade: a swept dry run takes its suggestions.
  dry_run_id          uuid        not null,

  -- A deterministic rule (with its id and version), or the copilot's LLM enrichment.
  source              text        not null
                                  constraint dry_run_suggestions_source
                                    check (source in ('rule', 'llm')),
  rule_id             text
                      constraint dry_run_suggestions_rule_id_format
                        check (rule_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(rule_id) <= 64),
  rule_version        integer
                      constraint dry_run_suggestions_rule_version_positive check (rule_version >= 1),

  -- "Make exploit-verify conditional".
  title               text        not null
                                  constraint dry_run_suggestions_title_present
                                    check (btrim(title) <> '' and length(title) <= 200),

  -- The evidence-composed text, as rendered.
  body                text        not null
                                  constraint dry_run_suggestions_body_present
                                    check (btrim(body) <> '' and length(body) <= 2000),

  -- What the rule computed — stage keys, counts, samples.
  evidence            jsonb       not null
                                  constraint dry_run_suggestions_evidence_shape
                                    check (jsonb_typeof(evidence) = 'object'
                                           and octet_length(evidence::text) <= 16384),

  -- The typed operations Apply executes, in V110's shape.
  proposed_ops        jsonb       not null
                                  constraint dry_run_suggestions_proposed_ops_shape
                                    check (ouroboros.dry_run_suggestion_ops_valid(proposed_ops)),

  -- 0–100, and never without the inputs that produced it.
  confidence          smallint    not null
                                  constraint dry_run_suggestions_confidence_range
                                    check (confidence between 0 and 100),
  confidence_basis    jsonb       not null
                                  constraint dry_run_suggestions_confidence_basis
                                    check (ouroboros.dry_run_confidence_basis_valid(confidence_basis)),

  status              text        not null default 'open'
                                  constraint dry_run_suggestions_status
                                    check (status in ('open', 'applied', 'ignored')),

  -- The draft_operations batch an Apply produced (actor `suggestion`, this suggestion's id).
  applied_op_batch_id uuid,
  resolved_by         text        references ouroboros."user" ("id") on delete set null,
  resolved_at         timestamptz,

  created_at          timestamptz not null default now(),

  constraint dry_run_suggestions_dry_run_fk
    foreign key (dry_run_id, organization_id)
    references ouroboros.dry_runs (id, organization_id) on delete cascade,

  -- A rule names itself; an LLM suggestion names no rule.
  constraint dry_run_suggestions_rule_named
    check ((source = 'rule') = (rule_id is not null and rule_version is not null)
           and (source = 'rule' or (rule_id is null and rule_version is null))),

  -- What is recorded follows the status.
  constraint dry_run_suggestions_resolution_coherent
    check (case status
             when 'open'    then applied_op_batch_id is null and resolved_by is null
                                 and resolved_at is null
             when 'applied' then applied_op_batch_id is not null and resolved_at is not null
             when 'ignored' then applied_op_batch_id is null and resolved_at is not null
           end),

  constraint dry_run_suggestions_resolved_after_created
    check (resolved_at is null or resolved_at >= created_at)
);

comment on table ouroboros.dry_run_suggestions is
  'A dry run''s improvement suggestions (#558, CC.4; decision W5): rule or LLM provenance, the rendered title and body, the evidence the rule computed, the typed proposed_ops Apply executes, and a confidence stored with its basis. open → applied (with the op batch) | ignored.';
comment on column ouroboros.dry_run_suggestions.proposed_ops is
  'The draft operations Apply executes — computed when the suggestion is made, never re-derived from the body.';
comment on column ouroboros.dry_run_suggestions.confidence_basis is
  '{method, inputs: {…}, …} — how the confidence was scored and from what, so the popover can say.';
comment on column ouroboros.dry_run_suggestions.applied_op_batch_id is
  'The draft_operations batch Apply produced: actor suggestion, suggestion_id this row.';

-- The card's callouts, per dry run.
create index dry_run_suggestions_dry_run_idx
  on ouroboros.dry_run_suggestions (dry_run_id, created_at);

-- open → applied | ignored, each once; Apply names a batch this suggestion produced; nothing about
-- the suggestion itself is edited.
create function ouroboros.dry_run_suggestions_transition()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'a suggestion is written open'
        using errcode = 'check_violation', constraint = tg_name;
    end if;
    return new;
  end if;

  if row(new.organization_id, new.dry_run_id, new.source, new.rule_id, new.rule_version,
         new.title, new.body, new.evidence, new.proposed_ops, new.confidence,
         new.confidence_basis, new.created_at)
     is distinct from
     row(old.organization_id, old.dry_run_id, old.source, old.rule_id, old.rule_version,
         old.title, old.body, old.evidence, old.proposed_ops, old.confidence,
         old.confidence_basis, old.created_at) then
    raise exception 'suggestion % is a record; only its resolution moves', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if new.status = old.status then
    -- A settled suggestion changes only by its resolver's deletion (the foreign key's set-null).
    if new.applied_op_batch_id is distinct from old.applied_op_batch_id
       or new.resolved_at is distinct from old.resolved_at
       or (new.resolved_by is distinct from old.resolved_by and new.resolved_by is not null) then
      raise exception 'suggestion % is % and its resolution is final', old.id, old.status
        using errcode = 'check_violation', constraint = tg_name;
    end if;
    return new;
  end if;

  if old.status <> 'open' then
    raise exception 'suggestion % is already %', old.id, old.status
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  -- A missing batch is the resolution CHECK's to report; a batch that is not this suggestion's
  -- Apply is this trigger's.
  if new.status = 'applied' and new.applied_op_batch_id is not null
     and not exists (select 1 from ouroboros.draft_operations o
                      where o.batch_id = new.applied_op_batch_id
                        and o.suggestion_id = new.id and o.actor = 'suggestion') then
    raise exception 'suggestion % names batch %, which is not an Apply of it',
      old.id, new.applied_op_batch_id
      using errcode = 'check_violation', constraint = tg_name,
            hint = 'Apply through ouroboros.apply_draft_batch(..., ''suggestion'', ..., <this suggestion>, proposed_ops) and record the batch it returns.';
  end if;
  return new;
end;
$$;

comment on function ouroboros.dry_run_suggestions_transition() is
  'Holds a dry-run suggestion to open → applied | ignored (#558): written open, settled once, the applied batch a suggestion-actor batch of this suggestion, and the suggestion itself never edited.';

create trigger dry_run_suggestions_transition
  before insert or update on ouroboros.dry_run_suggestions
  for each row execute function ouroboros.dry_run_suggestions_transition();

-- dry_run_suggestion_preview(suggestion) — the workflow's current draft with a suggestion's
-- proposed operations folded over it: what Apply would store.
--   p_suggestion_id — the suggestion
--   returns the resulting definition; raises when an operation does not apply (V110's
--   workflow_draft_apply_op), or null when the suggestion or the draft does not exist
create function ouroboros.dry_run_suggestion_preview(p_suggestion_id uuid)
returns jsonb language plpgsql stable as $$
declare
  doc jsonb;
  op  jsonb;
  ops jsonb;
begin
  select v.definition, s.proposed_ops into doc, ops
    from ouroboros.dry_run_suggestions s
    join ouroboros.dry_runs r          on r.id = s.dry_run_id
    join ouroboros.workflow_versions v on v.workflow_id = r.workflow_id and v.version is null
   where s.id = p_suggestion_id;
  if doc is null then
    return null;
  end if;
  for op in select e from jsonb_array_elements(ops) e loop
    doc := ouroboros.workflow_draft_apply_op(doc, op);
  end loop;
  return doc;
end;
$$;

comment on function ouroboros.dry_run_suggestion_preview(uuid) is
  'The workflow''s current draft with a suggestion''s proposed_ops applied (#558) — what Apply would store; raises when an operation does not apply.';

-- ---------------------------------------------------------------------------
-- draft_operations.suggestion_id — the foreign key V110 promised.
-- ---------------------------------------------------------------------------
-- Deferred: a dry run swept with its suggestions (dry_runs_sweep) clears the reference at commit.
alter table ouroboros.draft_operations
  add constraint draft_operations_suggestion_fk
    foreign key (suggestion_id) references ouroboros.dry_run_suggestions (id)
    on delete set null deferrable initially deferred;

-- V110's append-only rule, amended: the suggestion's set-null is the third foreign-key update a
-- recorded operation may take, alongside a deleted person's and a swept session's.
create or replace function ouroboros.draft_operations_refuse_update()
returns trigger language plpgsql as $$
begin
  if (new.actor_user_id is null or new.actor_user_id is not distinct from old.actor_user_id)
     and (new.session_id is null or new.session_id is not distinct from old.session_id)
     and (new.suggestion_id is null or new.suggestion_id is not distinct from old.suggestion_id)
     and row(new.id, new.organization_id, new.workflow_id, new.base_version, new.draft_rev,
             new.batch_id, new.seq, new.op, new.actor, new.applied_at)
         is not distinct from
         row(old.id, old.organization_id, old.workflow_id, old.base_version, old.draft_rev,
             old.batch_id, old.seq, old.op, old.actor, old.applied_at) then
    return new;
  end if;
  raise exception 'draft operations are history: % of workflow % cannot be rewritten',
    old.id, old.workflow_id
    using errcode = 'restrict_violation', constraint = tg_name,
          hint = 'Apply a new batch through ouroboros.apply_draft_batch() instead. See V110__draft_operations.sql (#556).';
end;
$$;

comment on function ouroboros.draft_operations_refuse_update() is
  'Refuses every update of draft_operations but a foreign key''s set-null of actor_user_id, session_id or suggestion_id (#556, amended by #558): the log is history.';

-- ---------------------------------------------------------------------------
-- review_replay_pairs — reviewer-pair replays over historical diffs.
-- ---------------------------------------------------------------------------
create table ouroboros.review_replay_pairs (
  id                  uuid        primary key default gen_random_uuid(),

  organization_id     text        not null,

  -- The workflow whose reviewer configuration was replayed.
  workflow_id         uuid        not null,

  -- One replay run groups its pairs.
  replay_set          uuid        not null,

  -- The historical change replayed — a ticket key (`#541`) or a commit.
  sample_ref          text        not null
                                  constraint review_replay_pairs_sample_ref_present
                                    check (btrim(sample_ref) <> '' and length(sample_ref) <= 128),

  -- The two reviewer stages, as the draft names them.
  reviewer_stages     text[]      not null
                                  constraint review_replay_pairs_reviewer_stages
                                    check (cardinality(reviewer_stages) = 2
                                           and reviewer_stages[1] <> reviewer_stages[2]
                                           and array_position(reviewer_stages, null) is null),

  agreed              boolean     not null,

  -- What the disagreement was about — exactly when they disagreed.
  disagreement_class  text
                      constraint review_replay_pairs_disagreement_class
                        check (disagreement_class in ('style', 'substance')),

  replayed_at         timestamptz not null,

  constraint review_replay_pairs_workflow_fk
    foreign key (workflow_id, organization_id)
    references ouroboros.workflows (id, organization_id) on delete cascade,

  constraint review_replay_pairs_class_when_disagreed
    check (agreed = (disagreement_class is null)),

  constraint review_replay_pairs_set_sample_key unique (replay_set, sample_ref)
);

comment on table ouroboros.review_replay_pairs is
  'Reviewer-pair replays over historical diffs (#558; produced for real by CF.5 #574): whether the two reviewer stages agreed, and if not whether on style or substance. The basis the reviewer-disagreement suggestion''s confidence is computed from; without these rows that suggestion has no basis.';

create index review_replay_pairs_workflow_idx
  on ouroboros.review_replay_pairs (workflow_id, replayed_at desc);

-- ---------------------------------------------------------------------------
-- The application role.
-- ---------------------------------------------------------------------------
grant select, insert, update on ouroboros.dry_run_suggestions to ouroboros_app;
grant select, insert on ouroboros.review_replay_pairs to ouroboros_app;
grant execute on function ouroboros.dry_run_suggestion_preview(uuid) to ouroboros_app;
