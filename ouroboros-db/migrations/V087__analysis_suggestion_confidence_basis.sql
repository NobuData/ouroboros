-- V087 — a suggestion's confidence keeps its arithmetic (BV.4, #513).
--
-- [`docs/mockups/18-build-analyzer.html`](../../docs/mockups/18-build-analyzer.html). A card's
-- `conf 91%` is a formula, not a feeling: BV.4's composer derives it from the cited findings'
-- sample size, effect size and stability, and the popover shows that arithmetic. A finding has
-- always stored its `confidence_basis` (V081); a suggestion stored only the number. So:
--
--   * `analysis_suggestions.confidence_basis` — `{formula, inputs, value}`: the composer's
--     formula id, every input it read, and the value it produced, which must be the
--     `confidence` column. Nullable only for rows written before this migration — the composer
--     always writes it.
--   * `record_analysis_suggestion()` gains `p_confidence_basis` (last, defaulting to null, so a
--     nine-argument call still resolves). Like the rest of the composition it is taken while the
--     suggestion is `open` and kept once it is resolved.
--   * `analysis_suggestions_lifecycle_guard()` freezes it with the other composed fields: what a
--     person dismissed or applied is what they saw, popover included.

-- Whether a suggestion's confidence basis has the shape the popover renders.
--   b — the confidence_basis; null is answered null so the nullable column's check passes
-- Returns true for {formula: non-blank text, inputs: object, value: integer 0–100}.
create function ouroboros.analysis_suggestion_confidence_basis_valid(b jsonb)
returns boolean language sql immutable as $$
  select case when b is null then null else coalesce(
    jsonb_typeof(b) = 'object'
    and ouroboros.analysis_json_text(b -> 'formula') is not null
    and jsonb_typeof(b -> 'inputs') = 'object'
    and ouroboros.analysis_json_count(b -> 'value') between 0 and 100,
    false)
  end
$$;

comment on function ouroboros.analysis_suggestion_confidence_basis_valid(jsonb) is
  'A suggestion''s confidence basis (#513): {formula, inputs: object, value: integer 0–100}. Null in, null out.';

alter table ouroboros.analysis_suggestions
  add column confidence_basis jsonb
    constraint analysis_suggestions_confidence_basis_shape
      check (ouroboros.analysis_suggestion_confidence_basis_valid(confidence_basis)),
  add constraint analysis_suggestions_confidence_basis_value
    check (confidence_basis is null or (confidence_basis ->> 'value')::integer = confidence);

comment on column ouroboros.analysis_suggestions.confidence_basis is
  'How the composer computed confidence (#513): {formula, inputs, value}, value = confidence. Null only on rows written before V087.';

-- The A4 lifecycle, as V081 wrote it, with confidence_basis frozen beside the other composed
-- fields once a suggestion is resolved.
create or replace function ouroboros.analysis_suggestions_lifecycle_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'a suggestion is born open, not %', new.status
        using errcode = 'check_violation', constraint = 'analysis_suggestions_born_open';
    end if;
    return new;
  end if;

  if (new.organization_id, new.repo_ref, new.identity_key, new.kind)
     is distinct from (old.organization_id, old.repo_ref, old.identity_key, old.kind) then
    raise exception 'suggestion % keeps its workspace, repo, kind and identity', old.id
      using errcode = 'check_violation', constraint = 'analysis_suggestions_identity_frozen';
  end if;

  if old.status <> 'open' then
    if new.status <> old.status then
      raise exception 'suggestion % is already %; it cannot become %', old.id, old.status, new.status
        using errcode = 'check_violation', constraint = 'analysis_suggestions_terminal';
    end if;
    -- resolved_by may only go to null: the user foreign key's own set-null.
    if (new.title, new.evidence_line, new.confidence, new.confidence_basis, new.impact,
        new.needs_spike, new.action_binding, new.resolved_at, new.resolution_reason,
        new.applied_event_id, new.draft_batch_id)
       is distinct from
       (old.title, old.evidence_line, old.confidence, old.confidence_basis, old.impact,
        old.needs_spike, old.action_binding, old.resolved_at, old.resolution_reason,
        old.applied_event_id, old.draft_batch_id)
       or (new.resolved_by is not null and new.resolved_by is distinct from old.resolved_by) then
      raise exception 'suggestion % was % as composed; it is not revised', old.id, old.status
        using errcode = 'check_violation', constraint = 'analysis_suggestions_resolved_frozen';
    end if;
    return new;
  end if;

  if new.status = 'dismissed' and new.resolved_by is null then
    raise exception 'dismissing suggestion % needs the person dismissing it', old.id
      using errcode = 'check_violation', constraint = 'analysis_suggestions_dismiss_actor';
  end if;

  -- A missing event or batch is the check constraints' to report; a present one must be right.
  if new.applied_event_id is not null and not exists (
       select 1 from ouroboros.audit_events e
        where e.id = new.applied_event_id
          and e.organization_id = new.organization_id
          and e.action = 'analysis_suggestion.applied'
          and e.subject_type = 'analysis_suggestion'
          and e.subject_id = new.id::text) then
    raise exception 'applying suggestion % needs its analysis_suggestion.applied audit event', old.id
      using errcode = 'check_violation', constraint = 'analysis_suggestions_applied_event';
  end if;

  if new.draft_batch_id is not null and not exists (
       select 1 from ouroboros.draft_batches b
        where b.id = new.draft_batch_id and b.organization_id = new.organization_id) then
    raise exception 'suggestion % can only be drafted into a batch of its own workspace', old.id
      using errcode = 'check_violation', constraint = 'analysis_suggestions_draft_batch_scope';
  end if;

  return new;
end;
$$;

comment on function ouroboros.analysis_suggestions_lifecycle_guard() is
  'The A4 lifecycle (#507, #513): born open; applied/dismissed/drafted are terminal and freeze the composed content (confidence_basis included) and resolution (resolved_by may still be set null by its foreign key); a dismissal needs an actor; an apply needs this suggestion''s analysis_suggestion.applied audit event; a draft needs a batch of the same workspace; workspace, repo, kind and identity never change.';

-- The composer's write, as V081 wrote it, with the confidence basis beside the confidence.
drop function ouroboros.record_analysis_suggestion(uuid, text, uuid[], text, text, integer, jsonb, jsonb, boolean);

-- Records one composed suggestion from a run's findings: inserts it, or — when a suggestion
-- with the same identity already exists in the repo — updates that one, so re-analysis never
-- duplicates. An open suggestion takes the new composition; a resolved one keeps what was
-- resolved and only moves last_run_id. Either way the run's findings are linked.
--   p_run_id           — the run that composed it
--   p_kind             — build_process | workflow | ticket_draft
--   p_finding_ids      — the run's findings it cites; at least one, all of p_run_id
--   p_title            — the composed title
--   p_evidence_line    — the composed Evidence line
--   p_confidence       — 0–100
--   p_impact           — the impact (null only for a ticket draft)
--   p_action_binding   — {plane, change}
--   p_needs_spike      — whether it drafts a spike instead of applying
--   p_confidence_basis — {formula, inputs, value}; value = p_confidence (#513)
-- Returns the suggestion's id.
create function ouroboros.record_analysis_suggestion(
  p_run_id uuid, p_kind text, p_finding_ids uuid[], p_title text, p_evidence_line text,
  p_confidence integer, p_impact jsonb, p_action_binding jsonb, p_needs_spike boolean default false,
  p_confidence_basis jsonb default null)
returns uuid language plpgsql as $$
declare
  run_org  text;
  run_repo ouroboros.repo_ref;
  keys     text[];
  found_n  integer;
  sid      uuid;
begin
  select organization_id, repo_ref into run_org, run_repo
    from ouroboros.analysis_runs where id = p_run_id;
  if not found then
    raise exception 'analysis run % does not exist', p_run_id
      using errcode = 'foreign_key_violation';
  end if;

  select array_agg(identity_key), count(*) into keys, found_n
    from ouroboros.analysis_findings
   where run_id = p_run_id and id = any (p_finding_ids);

  if found_n = 0
     or found_n <> (select count(distinct f) from unnest(p_finding_ids) f) then
    raise exception 'a suggestion cites at least one finding, all of run %', p_run_id
      using errcode = 'check_violation', constraint = 'analysis_suggestions_cite_findings';
  end if;

  insert into ouroboros.analysis_suggestions as s
      (organization_id, repo_ref, kind, identity_key, last_run_id, title, evidence_line,
       confidence, confidence_basis, impact, needs_spike, action_binding)
  values (run_org, run_repo, p_kind, ouroboros.analysis_suggestion_identity(p_kind, keys),
          p_run_id, p_title, p_evidence_line, p_confidence, p_confidence_basis, p_impact,
          coalesce(p_needs_spike, false), p_action_binding)
  on conflict (organization_id, repo_ref, identity_key) do update
     set last_run_id      = excluded.last_run_id,
         title            = case when s.status = 'open' then excluded.title            else s.title end,
         evidence_line    = case when s.status = 'open' then excluded.evidence_line    else s.evidence_line end,
         confidence       = case when s.status = 'open' then excluded.confidence       else s.confidence end,
         confidence_basis = case when s.status = 'open' then excluded.confidence_basis else s.confidence_basis end,
         impact           = case when s.status = 'open' then excluded.impact           else s.impact end,
         needs_spike      = case when s.status = 'open' then excluded.needs_spike      else s.needs_spike end,
         action_binding   = case when s.status = 'open' then excluded.action_binding   else s.action_binding end
  returning id into sid;

  insert into ouroboros.analysis_suggestion_findings (suggestion_id, finding_id, organization_id, repo_ref)
  select sid, f, run_org, run_repo from unnest(p_finding_ids) f
  on conflict do nothing;

  return sid;
end;
$$;

comment on function ouroboros.record_analysis_suggestion(uuid, text, uuid[], text, text, integer, jsonb, jsonb, boolean, jsonb) is
  'The composer''s write (#507, #513): upserts a suggestion on its derived identity and links the run''s findings, so re-analysis updates rather than duplicates. An open suggestion takes the new composition (confidence_basis included); a resolved one keeps its status and content and only moves last_run_id. Returns the suggestion id.';
