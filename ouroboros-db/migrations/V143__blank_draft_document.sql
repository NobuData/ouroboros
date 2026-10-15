-- ===========================================================================
-- V143 — a draft built on a blank workflow is a DSL document (#1744)
-- ===========================================================================
--
-- **+ New workflow** (`POST /api/v1/workflows {name}`) stored its draft as `{}`. V110's writer,
-- `apply_draft_batch()`, folds a batch over the stored draft and starts from
-- `workflow_draft_base()` — `{"dsl_version": "1.0", "nodes": [], "edges": []}` — only when no
-- draft row exists. No operation writes `dsl_version`, so a draft the copilot built on a blank
-- workflow never had one: ouroboros-rest, which reads a stored draft with the empty document's
-- keys filled in, said every operation applied cleanly, and then the publish gate and the dry
-- run's pre-check both refused the stored row at `/dsl_version`.
--
-- The rule is now one rule, on both sides:
--
--   | where                                   | the document an operation applies to       |
--   |-----------------------------------------|--------------------------------------------|
--   | `apply_draft_batch()` (here)            | `workflow_blank_document() || stored`      |
--   | `asDraftDocument()` (ouroboros-rest)    | `{...EMPTY_DRAFT, ...stored}`              |
--
-- — the empty document's keys, with whatever the stored draft has taking precedence. A draft
-- that already carries `dsl_version`, `nodes` and `edges` (every draft but a blank one) is
-- untouched by it.
--
-- **Existing rows.** A draft row that lacks any of the three keys gets them the same way. That
-- repairs the blank drafts and the copilot drafts built on one, and it makes their stored row
-- equal the log's replay again: `workflow_draft_replay()` always started from the empty
-- document, so a log over `{}` had been in `workflow_draft_replay_mismatches` since its first
-- batch. ouroboros-rest now creates a blank workflow on the empty document itself, so no new
-- row needs this.
--
-- Revert forward:
--   create or replace ouroboros.apply_draft_batch() as V110 wrote it;
--   drop function ouroboros.workflow_blank_document();
--   the backfilled keys are a valid document's and stay.

-- workflow_blank_document() — DSL v1 with no trigger, no stages and no edges.
--   returns the document a workflow never published starts from
create function ouroboros.workflow_blank_document()
returns jsonb language sql immutable as $$
  select '{"dsl_version": "1.0", "nodes": [], "edges": []}'::jsonb;
$$;

comment on function ouroboros.workflow_blank_document() is
  'The empty DSL document {"dsl_version": "1.0", "nodes": [], "edges": []} (#1744): the base of a workflow never published (workflow_draft_base), and the keys apply_draft_batch() fills in under a stored draft that lacks them.';

create or replace function ouroboros.workflow_draft_base(p_workflow_id uuid)
returns jsonb language sql stable as $$
  select coalesce(
           (select v.definition
              from ouroboros.workflows w
              join ouroboros.workflow_versions v
                on v.workflow_id = w.id and v.version = w.current_version
             where w.id = p_workflow_id),
           ouroboros.workflow_blank_document());
$$;

-- apply_draft_batch(org, workflow, actor, user, session, suggestion, ops) — V110's writer, with
-- the stored draft read over the empty document's keys. Arguments, result and errors are
-- V110's; see its header.
create or replace function ouroboros.apply_draft_batch(p_organization_id text, p_workflow_id uuid,
                                                       p_actor text, p_actor_user_id text,
                                                       p_session_id uuid, p_suggestion_id uuid,
                                                       p_ops jsonb)
returns table (draft_rev integer, batch_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
#variable_conflict use_column
declare
  wf       ouroboros.workflows%rowtype;
  draft    ouroboros.workflow_versions%rowtype;
  doc      jsonb;
  rev      integer;
  batch    uuid := gen_random_uuid();
  entry    record;
begin
  select * into wf from ouroboros.workflows w
   where w.id = p_workflow_id and w.organization_id = p_organization_id
     for update;
  if not found then
    raise exception 'workflow % is not a workflow of workspace %', p_workflow_id, p_organization_id
      using errcode = 'foreign_key_violation';
  end if;

  if p_session_id is not null and not exists (
       select 1 from ouroboros.copilot_sessions s
        where s.id = p_session_id and s.workflow_id = p_workflow_id
          and s.organization_id = p_organization_id) then
    raise exception 'copilot session % does not edit workflow %', p_session_id, p_workflow_id
      using errcode = 'foreign_key_violation';
  end if;

  if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) = 0 then
    raise exception 'a batch is a non-empty array of operations' using errcode = 'check_violation';
  end if;

  select * into draft from ouroboros.workflow_versions v
   where v.workflow_id = p_workflow_id and v.version is null
     for update;
  -- A stored draft is read over the empty document, so a blank `{}` gains `dsl_version`,
  -- `nodes` and `edges` exactly as ouroboros-rest's asDraftDocument() reads it (#1744).
  doc := case when found then ouroboros.workflow_blank_document() || draft.definition
              else ouroboros.workflow_draft_base(p_workflow_id) end;

  for entry in select e.op from jsonb_array_elements(p_ops) as e(op) loop
    doc := ouroboros.workflow_draft_apply_op(doc, entry.op);
  end loop;

  rev := wf.draft_rev + 1;

  insert into ouroboros.draft_operations
      (organization_id, workflow_id, base_version, draft_rev, batch_id, seq, op, actor,
       actor_user_id, session_id, suggestion_id)
  select p_organization_id, p_workflow_id, wf.current_version, rev, batch, e.ord::integer, e.op,
         p_actor, p_actor_user_id, p_session_id, p_suggestion_id
    from jsonb_array_elements(p_ops) with ordinality as e(op, ord);

  if draft.id is null then
    insert into ouroboros.workflow_versions (workflow_id, version, definition, edited_in)
    values (p_workflow_id, null, doc,
            case p_actor when 'canvas' then 'visual' when 'code' then 'code' end);
  else
    update ouroboros.workflow_versions v
       set definition = doc,
           edited_in  = case p_actor when 'canvas' then 'visual' when 'code' then 'code'
                                     else v.edited_in end
     where v.id = draft.id;
  end if;

  update ouroboros.workflows w
     set draft_rev = rev,
         provenance_summary = jsonb_set(w.provenance_summary, array[p_actor],
                                        to_jsonb((w.provenance_summary ->> p_actor)::integer + 1))
   where w.id = p_workflow_id;

  return query select rev, batch;
end;
$$;

comment on function ouroboros.apply_draft_batch(text, uuid, text, text, uuid, uuid, jsonb) is
  'The one writer of draft_operations (#556): locks the workflow, applies the operations to the stored draft read over the empty document''s keys (#1744; creating it from the base if absent), records each with its actor, batch and the next draft_rev, and counts the batch in provenance_summary — atomically, so the log and the draft cannot be written apart. Runs as its owner so the application can apply batches without being able to insert operations directly.';

-- The drafts written before this: a blank `{}`, and any draft built on one.
update ouroboros.workflow_versions
   set definition = ouroboros.workflow_blank_document() || definition
 where version is null
   and not definition ?& array['dsl_version', 'nodes', 'edges'];
