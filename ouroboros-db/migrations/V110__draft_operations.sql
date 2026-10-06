-- V110__draft_operations.sql — per-operation provenance on a workflow's shared draft: what
-- changed, who changed it, and at which revision (#556, CC.2; amends WF-P.1, #132).
--
-- Mockup 20 makes an architectural claim in its caption — *"Copilot edits compile to the same
-- graph as the canvas and the code editor — nothing is a special case"* — and draws two things
-- that only hold if the claim does:
--
--   07  ⌖ exploit-verify   [reruns CVE PoC] [sandboxed] [added by copilot]   edit
--   history: 1 dry run · draft v0.3 (2 copilot edits applied)
--
-- This migration is where both come from:
--
--   1. **`draft_operations`** — one row per typed operation applied to a workflow's draft, in
--      the batch it was applied with, at the draft revision that batch produced, with its actor
--      (`canvas | code | copilot | suggestion`) and that actor's references. Provenance is a
--      property of the **draft**, not of the copilot: none of this lives in the copilot's
--      tables, so the canvas and the code editor read it exactly as the conversation does.
--   2. **`workflows.draft_rev`** and **`workflows.provenance_summary`** (the WF-P.1 amendment)
--      — the `v0.N` counter, and how many batches each actor applied to this draft, on the row
--      every surface already reads.
--   3. **`workflow_draft_node_provenance`** — per stage of the draft, which actor added it; a
--      stage a canvas or code operation has touched since reads `human`. The pill's source.
--   4. **`apply_draft_batch()`** — the one writer. It locks the workflow, applies the batch to
--      the stored draft, records every operation, and moves the counter and the summary, all
--      in one statement — so the log and the draft cannot be written apart.
--   5. **`workflow_draft_replay()`** and **`workflow_draft_replay_mismatches`** — the
--      consistency probe: the log replayed over the published version the draft is based on
--      must equal the stored draft, exactly.
--
-- ---------------------------------------------------------------------------
-- The operation vocabulary — what DSL v1 can express, and nothing else.
-- ---------------------------------------------------------------------------
--
-- An operation is `{kind, params}`, and `params` carries the DSL's own objects (WF-P.2, #133),
-- never a private shape:
--
--   | kind           | params                 | applied as                                     |
--   |----------------|------------------------|------------------------------------------------|
--   | `add_stage`    | `{node}` — a DSL node  | appended; its id must be new                   |
--   | `set_stage`    | `{node}` — a DSL node  | replaces the node with that id, in place       |
--   | `remove_stage` | `{id}`                 | removes the node and every edge touching it    |
--   | `add_edge`     | `{edge}` — a DSL edge  | appended; both ends must exist, pair unused    |
--   | `remove_edge`  | `{from, to}`           | removes the edge joining that ordered pair     |
--   | `set_trigger`  | `{trigger}` — DSL root | replaces the document's trigger                |
--
-- `set_stage` is the roadmap's `set_stage_config` widened to the whole node, so a title or a
-- position change is an operation too — a canvas drag that the log could not express would be
-- a draft the log could not replay. `set_guard` (the mockup's `$5/run` spend guard) is
-- **deliberately absent**: DSL v1 has no guard construct, so a guard operation could not be
-- stored in a validated shape. It joins the vocabulary with the DSL minor that adds guards.
--
-- The CHECK below holds the envelope — the kind, the exact parameter keys, a slug where an id
-- is named. Whether a node or an edge is a *valid DSL* node or edge is the schema's question,
-- and a Flyway migration cannot read a file: `scripts/draft-ops-parity.mjs` answers it over
-- every stored operation against `schemas/workflow-dsl/operations-v1.json`, which `$ref`s
-- `v1.json`'s own definitions — so a DSL change that would reject recorded history fails ci/db
-- as a parity failure rather than leaving the history silently unreplayable.
--
-- ---------------------------------------------------------------------------
-- Revisions, bases, and what "replay" replays.
-- ---------------------------------------------------------------------------
--
-- `v0.3` is `v{current_version or 0}.{draft_rev}`: the published version the draft is based on,
-- and how many batches have been applied on top of it. Publishing does not delete the draft
-- (WF-P.3 inserts the published row beside it), so the draft simply acquires a new base — and
-- `workflows_draft_rev_reset` returns `draft_rev` to 0 and the summary to zeros when
-- `current_version` moves. Every operation records `base_version`, the `current_version` it was
-- applied over, so the log of the *current* draft is the operations whose `base_version` is the
-- workflow's `current_version`.
--
-- Replay starts from that base — the published definition, or for a workflow never published
-- the empty document `{"dsl_version": "1.0", "nodes": [], "edges": []}` — and folds the current
-- log over it in `(draft_rev, seq)` order. Intermediate states need not be valid workflows (an
-- empty document has no trigger); only the stored draft is held to the DSL, by WF-P.3's save
-- and publish gates.
--
-- **The probe reports only drafts with a log** (`draft_rev > 0`). Until CD.1 (#559) and CD.5
-- (#563) route canvas and code saves through `apply_draft_batch()`, those editors still write
-- the draft whole; a draft they edited *after* operations were applied is exactly the
-- divergence the probe exists to name.
--
-- ---------------------------------------------------------------------------
-- Node provenance — added by whom, and cleared by a human touch.
-- ---------------------------------------------------------------------------
--
-- For each stage in the draft: the most recent `add_stage` of its id in the current log gives
-- the actor that added it. `canvas` and `code` read `human`; `copilot` and `suggestion` read as
-- themselves — **unless a `canvas` or `code` operation has touched that stage since**
-- (`set_stage` of its id), which reads `human`: a stage a person has reconfigured is no longer
-- the model's, and keeping the pill would attribute a person's decision to a model. A stage
-- with no `add_stage` in the current log came with the base and reads `published`. Edges do not
-- touch a stage — wiring a stage in is not reconfiguring it.
--
-- Revert forward:
--   drop view ouroboros.workflow_draft_replay_mismatches, ouroboros.workflow_draft_node_provenance;
--   drop table ouroboros.draft_operations;
--   drop trigger workflows_draft_rev_reset on ouroboros.workflows;
--   alter table ouroboros.workflows drop column draft_rev, drop column provenance_summary;
--   then drop every function this file creates.

-- ---------------------------------------------------------------------------
-- Shape helpers.
-- ---------------------------------------------------------------------------

-- draft_op_shape_valid(op) — whether an operation is a well-formed envelope of the vocabulary.
--   op — the jsonb value to inspect
--   returns true when op is exactly {kind, params} with params exactly the kind's keys
create function ouroboros.draft_op_shape_valid(op jsonb)
returns boolean language plpgsql immutable as $$
declare
  params jsonb;
  slug   text := '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$';
begin
  if not ouroboros.jsonb_keys_are(op, array['kind', 'params'])
     or jsonb_typeof(op -> 'kind') is distinct from 'string' then
    return false;
  end if;
  params := op -> 'params';

  case op ->> 'kind'
    when 'add_stage', 'set_stage' then
      return ouroboros.jsonb_keys_are(params, array['node'])
         and jsonb_typeof(params -> 'node') = 'object'
         and jsonb_typeof(params #> '{node,id}') = 'string'
         and (params #>> '{node,id}') ~ slug;
    when 'remove_stage' then
      return ouroboros.jsonb_keys_are(params, array['id'])
         and jsonb_typeof(params -> 'id') = 'string'
         and (params ->> 'id') ~ slug;
    when 'add_edge' then
      return ouroboros.jsonb_keys_are(params, array['edge'])
         and jsonb_typeof(params -> 'edge') = 'object'
         and jsonb_typeof(params #> '{edge,from}') = 'string'
         and jsonb_typeof(params #> '{edge,to}') = 'string';
    when 'remove_edge' then
      return ouroboros.jsonb_keys_are(params, array['from', 'to'])
         and jsonb_typeof(params -> 'from') = 'string'
         and jsonb_typeof(params -> 'to') = 'string';
    when 'set_trigger' then
      return ouroboros.jsonb_keys_are(params, array['trigger'])
         and jsonb_typeof(params -> 'trigger') = 'object';
    else
      return false;
  end case;
end;
$$;

comment on function ouroboros.draft_op_shape_valid(jsonb) is
  'True when a draft operation is exactly {kind, params} of the vocabulary add_stage{node} | set_stage{node} | remove_stage{id} | add_edge{edge} | remove_edge{from,to} | set_trigger{trigger} (#556). The DSL validity of node, edge and trigger is scripts/draft-ops-parity.mjs''s, against schemas/workflow-dsl/operations-v1.json.';

-- draft_provenance_summary_valid(summary) — {canvas, code, copilot, suggestion} of counts.
--   summary — the jsonb value to inspect
--   returns true when it has exactly the four actor keys, each a non-negative integer
create function ouroboros.draft_provenance_summary_valid(summary jsonb)
returns boolean language sql immutable as $$
  select ouroboros.jsonb_keys_are(summary, array['canvas', 'code', 'copilot', 'suggestion'])
     and ouroboros.jsonb_nonneg_int(summary -> 'canvas')
     and ouroboros.jsonb_nonneg_int(summary -> 'code')
     and ouroboros.jsonb_nonneg_int(summary -> 'copilot')
     and ouroboros.jsonb_nonneg_int(summary -> 'suggestion');
$$;

comment on function ouroboros.draft_provenance_summary_valid(jsonb) is
  'True when a draft provenance summary is exactly {canvas, code, copilot, suggestion} of non-negative integers (#556).';

-- ---------------------------------------------------------------------------
-- WF-P.1 amendment — the draft's revision and its provenance summary, on the workflow row.
-- ---------------------------------------------------------------------------
alter table ouroboros.workflows
  add column draft_rev integer not null default 0
    constraint workflows_draft_rev_nonnegative check (draft_rev >= 0),
  add column provenance_summary jsonb not null
    default '{"canvas": 0, "code": 0, "copilot": 0, "suggestion": 0}'
    constraint workflows_provenance_summary_shape
      check (ouroboros.draft_provenance_summary_valid(provenance_summary));

comment on column ouroboros.workflows.draft_rev is
  'The N of the draft''s v{current_version or 0}.N (#556): operation batches applied since the draft''s base. Written by apply_draft_batch(); back to 0 when current_version moves.';
comment on column ouroboros.workflows.provenance_summary is
  '{canvas, code, copilot, suggestion} — operation batches each actor applied to the current draft (#556). The dry-run footer''s "2 copilot edits applied" is copilot. Written by apply_draft_batch(); zeroed when current_version moves.';

-- A publish gives the draft a new base, and its revision starts again from it.
create function ouroboros.workflows_draft_rev_reset()
returns trigger language plpgsql as $$
begin
  if new.current_version is distinct from old.current_version then
    new.draft_rev := 0;
    new.provenance_summary := '{"canvas": 0, "code": 0, "copilot": 0, "suggestion": 0}';
  end if;
  return new;
end;
$$;

comment on function ouroboros.workflows_draft_rev_reset() is
  'Returns draft_rev to 0 and zeroes provenance_summary when a workflow''s current_version moves (#556): the draft''s log is counted from its base, and publishing changes the base.';

create trigger workflows_draft_rev_reset
  before update of current_version on ouroboros.workflows
  for each row execute function ouroboros.workflows_draft_rev_reset();

-- ---------------------------------------------------------------------------
-- draft_operations — the log.
-- ---------------------------------------------------------------------------
create table ouroboros.draft_operations (
  id              uuid        primary key default gen_random_uuid(),

  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The workflow whose draft this edited — of the same workspace, by composite key.
  workflow_id     uuid        not null,

  -- The published version the draft was based on when this was applied; null before the
  -- workflow's first publish. The current draft's log is the rows matching current_version.
  base_version    integer
                  constraint draft_operations_base_version_positive
                    check (base_version is null or base_version >= 1),

  -- The N of v{base}.N this operation's batch produced.
  draft_rev       integer     not null
                              constraint draft_operations_draft_rev_positive
                                check (draft_rev >= 1),

  -- Operations applied atomically together share one.
  batch_id        uuid        not null,

  -- Order within the batch, from 1.
  seq             integer     not null
                              constraint draft_operations_seq_positive check (seq >= 1),

  -- {kind, params} — see the header's table, and draft_op_shape_valid().
  op              jsonb       not null
                              constraint draft_operations_op_shape
                                check (ouroboros.draft_op_shape_valid(op)),

  actor           text        not null
                              constraint draft_operations_actor
                                check (actor in ('canvas', 'code', 'copilot', 'suggestion')),

  -- The person behind it, where there is one. Set null when they are deleted: the operation
  -- happened whoever has since left.
  actor_user_id   text        references ouroboros."user" ("id") on delete set null,

  -- The copilot conversation it came from (copilot, or a suggestion applied in one). Set null
  -- when the retention sweep removes a closed session — the provenance outlives the transcript.
  session_id      uuid,

  -- The suggestion an Apply executed. No foreign key yet: suggestions are CC.4's (#558), which
  -- adds it.
  suggestion_id   uuid,

  applied_at      timestamptz not null default now(),

  constraint draft_operations_workflow_fk
    foreign key (workflow_id, organization_id)
    references ouroboros.workflows (id, organization_id) on delete cascade,
  constraint draft_operations_session_fk
    foreign key (session_id, organization_id)
    references ouroboros.copilot_sessions (id, organization_id) on delete set null (session_id),

  -- A session belongs to conversational actors only, and a suggestion to an Apply.
  constraint draft_operations_session_actor
    check (session_id is null or actor in ('copilot', 'suggestion')),
  constraint draft_operations_suggestion_actor
    check (suggestion_id is null or actor = 'suggestion'),

  constraint draft_operations_batch_seq_key unique (batch_id, seq),
  constraint draft_operations_revision_seq_key
    unique nulls not distinct (workflow_id, base_version, draft_rev, seq)
);

comment on table ouroboros.draft_operations is
  'Per-operation provenance on a workflow''s shared draft (#556, CC.2; decision W2): each typed operation, its batch and revision, and its actor — canvas, code, copilot or suggestion. Written only by apply_draft_batch(); append-only. Replays over the draft''s base to the stored draft (workflow_draft_replay_mismatches).';
comment on column ouroboros.draft_operations.base_version is
  'The workflows.current_version the operation was applied over; null before the first publish.';
comment on column ouroboros.draft_operations.draft_rev is
  'The N of v{base}.N the operation''s batch produced. Shared by every operation of the batch.';
comment on column ouroboros.draft_operations.batch_id is
  'The atomic group: every operation applied in one apply_draft_batch() call.';
comment on column ouroboros.draft_operations.seq is
  'Position within the batch, from 1 — the order the operations were applied in.';
comment on column ouroboros.draft_operations.op is
  '{kind, params}: add_stage{node} | set_stage{node} | remove_stage{id} | add_edge{edge} | remove_edge{from,to} | set_trigger{trigger}, with DSL v1 objects as params (WF-P.2).';
comment on column ouroboros.draft_operations.actor is
  'canvas | code | copilot | suggestion — who applied it. A suggestion is an Apply from a dry-run suggestion: neither a person editing nor the conversation.';
comment on column ouroboros.draft_operations.session_id is
  'The copilot session, for copilot and suggestion operations; null once a closed session is swept.';
comment on column ouroboros.draft_operations.suggestion_id is
  'The suggestion an Apply executed (suggestion actor only). The foreign key arrives with CC.4 (#558).';

create index draft_operations_workflow_rev_idx
  on ouroboros.draft_operations (workflow_id, draft_rev);
create index draft_operations_session_idx
  on ouroboros.draft_operations (session_id) where session_id is not null;
create index draft_operations_actor_user_idx
  on ouroboros.draft_operations (actor_user_id) where actor_user_id is not null;

-- The log is history: nothing rewrites it. The one update allowed is a foreign key's own
-- set-null — a deleted person or a swept session — leaving every other column as it was.
create function ouroboros.draft_operations_refuse_update()
returns trigger language plpgsql as $$
begin
  if (new.actor_user_id is null or new.actor_user_id is not distinct from old.actor_user_id)
     and (new.session_id is null or new.session_id is not distinct from old.session_id)
     and row(new.id, new.organization_id, new.workflow_id, new.base_version, new.draft_rev,
             new.batch_id, new.seq, new.op, new.actor, new.suggestion_id, new.applied_at)
         is not distinct from
         row(old.id, old.organization_id, old.workflow_id, old.base_version, old.draft_rev,
             old.batch_id, old.seq, old.op, old.actor, old.suggestion_id, old.applied_at) then
    return new;
  end if;
  raise exception 'draft operations are history: % of workflow % cannot be rewritten',
    old.id, old.workflow_id
    using errcode = 'restrict_violation', constraint = tg_name,
          hint = 'Apply a new batch through ouroboros.apply_draft_batch() instead. See V110__draft_operations.sql (#556).';
end;
$$;

comment on function ouroboros.draft_operations_refuse_update() is
  'Refuses every update of draft_operations but a foreign key''s set-null of actor_user_id or session_id (#556): the log is history.';

create trigger draft_operations_no_update
  before update on ouroboros.draft_operations
  for each row execute function ouroboros.draft_operations_refuse_update();

-- ---------------------------------------------------------------------------
-- Applying an operation to a document — the one implementation the writer and replay share.
-- ---------------------------------------------------------------------------

-- workflow_draft_apply_op(doc, op) — the document after one operation.
--   doc — a DSL document (or the empty base): an object with `nodes` and `edges` arrays
--   op  — a shape-valid operation
--   returns the new document
--   raises check_violation when the operation cannot apply: a malformed envelope, an added
--     id that exists, a set or removed id that does not, an edge whose ends are missing or
--     whose pair is taken, a removed edge that is not there
create function ouroboros.workflow_draft_apply_op(doc jsonb, op jsonb)
returns jsonb language plpgsql immutable as $$
declare
  params jsonb := op -> 'params';
  target text;
  nodes  jsonb := coalesce(doc -> 'nodes', '[]');
  edges  jsonb := coalesce(doc -> 'edges', '[]');
  found  boolean;
  ends   integer;
begin
  if not ouroboros.draft_op_shape_valid(op) then
    raise exception 'not a draft operation: %', op using errcode = 'check_violation';
  end if;

  case op ->> 'kind'
    when 'add_stage', 'set_stage' then
      target := params #>> '{node,id}';
      found := exists (select 1 from jsonb_array_elements(nodes) n where n ->> 'id' = target);
      if op ->> 'kind' = 'add_stage' then
        if found then
          raise exception 'add_stage: stage % already exists', target using errcode = 'check_violation';
        end if;
        return jsonb_set(doc, '{nodes}', nodes || jsonb_build_array(params -> 'node'));
      end if;
      if not found then
        raise exception 'set_stage: no stage %', target using errcode = 'check_violation';
      end if;
      return jsonb_set(doc, '{nodes}',
        (select jsonb_agg(case when n ->> 'id' = target then params -> 'node' else n end
                          order by ord)
           from jsonb_array_elements(nodes) with ordinality as e(n, ord)));

    when 'remove_stage' then
      target := params ->> 'id';
      if not exists (select 1 from jsonb_array_elements(nodes) n where n ->> 'id' = target) then
        raise exception 'remove_stage: no stage %', target using errcode = 'check_violation';
      end if;
      return jsonb_set(jsonb_set(doc, '{nodes}',
        coalesce((select jsonb_agg(n order by ord)
                    from jsonb_array_elements(nodes) with ordinality as e(n, ord)
                   where n ->> 'id' <> target), '[]')),
        '{edges}',
        coalesce((select jsonb_agg(x order by ord)
                    from jsonb_array_elements(edges) with ordinality as e(x, ord)
                   where x ->> 'from' <> target and x ->> 'to' <> target), '[]'));

    when 'add_edge' then
      -- A self-loop names one stage, any other edge two.
      ends := cardinality(array(select distinct x from unnest(array[params #>> '{edge,from}',
                                                                    params #>> '{edge,to}']) x));
      if (select count(*) from jsonb_array_elements(nodes) n
           where n ->> 'id' in (params #>> '{edge,from}', params #>> '{edge,to}')) < ends then
        raise exception 'add_edge: % → % names a stage that does not exist',
          params #>> '{edge,from}', params #>> '{edge,to}' using errcode = 'check_violation';
      end if;
      if exists (select 1 from jsonb_array_elements(edges) x
                  where x ->> 'from' = params #>> '{edge,from}'
                    and x ->> 'to' = params #>> '{edge,to}') then
        raise exception 'add_edge: % → % is already joined',
          params #>> '{edge,from}', params #>> '{edge,to}' using errcode = 'check_violation';
      end if;
      return jsonb_set(doc, '{edges}', edges || jsonb_build_array(params -> 'edge'));

    when 'remove_edge' then
      if not exists (select 1 from jsonb_array_elements(edges) x
                      where x ->> 'from' = params ->> 'from' and x ->> 'to' = params ->> 'to') then
        raise exception 'remove_edge: no edge % → %', params ->> 'from', params ->> 'to'
          using errcode = 'check_violation';
      end if;
      return jsonb_set(doc, '{edges}',
        coalesce((select jsonb_agg(x order by ord)
                    from jsonb_array_elements(edges) with ordinality as e(x, ord)
                   where not (x ->> 'from' = params ->> 'from' and x ->> 'to' = params ->> 'to')),
                 '[]'));

    else -- set_trigger
      return jsonb_set(doc, '{trigger}', params -> 'trigger', true);
  end case;
end;
$$;

comment on function ouroboros.workflow_draft_apply_op(jsonb, jsonb) is
  'One draft operation applied to a DSL document (#556) — the single implementation apply_draft_batch() writes with and workflow_draft_replay() replays with. Raises check_violation when the operation cannot apply.';

-- workflow_draft_base(workflow) — the document the current draft's log starts from.
--   p_workflow_id — the workflow
--   returns the definition of its current_version, or the empty document when it has none
create function ouroboros.workflow_draft_base(p_workflow_id uuid)
returns jsonb language sql stable as $$
  select coalesce(
           (select v.definition
              from ouroboros.workflows w
              join ouroboros.workflow_versions v
                on v.workflow_id = w.id and v.version = w.current_version
             where w.id = p_workflow_id),
           '{"dsl_version": "1.0", "nodes": [], "edges": []}'::jsonb);
$$;

comment on function ouroboros.workflow_draft_base(uuid) is
  'The document a workflow''s current draft log replays from (#556): its current_version''s definition, or {"dsl_version": "1.0", "nodes": [], "edges": []} before its first publish.';

-- workflow_draft_replay(workflow) — the current log folded over the base.
--   p_workflow_id — the workflow
--   returns the document the log produces; the base itself when the log is empty
create function ouroboros.workflow_draft_replay(p_workflow_id uuid)
returns jsonb language plpgsql stable as $$
declare
  doc   jsonb := ouroboros.workflow_draft_base(p_workflow_id);
  entry record;
begin
  for entry in
    select o.op
      from ouroboros.draft_operations o
      join ouroboros.workflows w on w.id = o.workflow_id
     where o.workflow_id = p_workflow_id
       and o.base_version is not distinct from w.current_version
     order by o.draft_rev, o.seq
  loop
    doc := ouroboros.workflow_draft_apply_op(doc, entry.op);
  end loop;
  return doc;
end;
$$;

comment on function ouroboros.workflow_draft_replay(uuid) is
  'The current draft''s operation log replayed over its base, in (draft_rev, seq) order (#556) — what the stored draft must equal.';

-- ---------------------------------------------------------------------------
-- The writer.
-- ---------------------------------------------------------------------------

-- apply_draft_batch(org, workflow, actor, user, session, suggestion, ops) — apply a batch.
--   p_organization_id — the workspace; the workflow must be one of its own
--   p_workflow_id     — the workflow whose draft is edited
--   p_actor           — canvas | code | copilot | suggestion
--   p_actor_user_id   — the person, or null
--   p_session_id      — the copilot session (copilot/suggestion only), of the same workflow
--   p_suggestion_id   — the suggestion applied (suggestion only)
--   p_ops             — a non-empty JSON array of operations, applied in order
--   returns the revision the batch produced and its batch id
--   raises when the workflow is not the workspace's, the session not the workflow's, the
--     array empty, or any operation does not apply — and then nothing is written
create function ouroboros.apply_draft_batch(p_organization_id text, p_workflow_id uuid,
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
  doc := case when found then draft.definition
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
  'The one writer of draft_operations (#556): locks the workflow, applies the operations to the stored draft (creating it from the base if absent), records each with its actor, batch and the next draft_rev, and counts the batch in provenance_summary — atomically, so the log and the draft cannot be written apart. Runs as its owner so the application can apply batches without being able to insert operations directly.';

revoke execute on function ouroboros.apply_draft_batch(text, uuid, text, text, uuid, uuid, jsonb)
  from public;

-- ---------------------------------------------------------------------------
-- What the surfaces read.
-- ---------------------------------------------------------------------------
create view ouroboros.workflow_draft_node_provenance as
with drafts as (
  select w.id as workflow_id, w.organization_id, w.current_version, v.definition
    from ouroboros.workflows w
    join ouroboros.workflow_versions v on v.workflow_id = w.id and v.version is null
),
stages as (
  select d.workflow_id, d.organization_id, d.current_version, n ->> 'id' as node_id
    from drafts d, jsonb_array_elements(coalesce(d.definition -> 'nodes', '[]')) as n
),
touches as (
  select o.workflow_id, o.base_version, o.draft_rev, o.seq, o.actor, o.op ->> 'kind' as kind,
         o.op #>> '{params,node,id}' as node_id
    from ouroboros.draft_operations o
   where o.op ->> 'kind' in ('add_stage', 'set_stage')
)
select s.workflow_id, s.organization_id, s.node_id,
       case
         when added.actor is null then 'published'
         when added.actor in ('canvas', 'code') then 'human'
         when exists (select 1 from touches t
                       where t.workflow_id = s.workflow_id
                         and t.base_version is not distinct from s.current_version
                         and t.node_id = s.node_id
                         and t.actor in ('canvas', 'code')
                         and (t.draft_rev, t.seq) > (added.draft_rev, added.seq)) then 'human'
         else added.actor
       end as provenance,
       added.draft_rev as added_rev
  from stages s
  left join lateral (
    select t.actor, t.draft_rev, t.seq
      from touches t
     where t.workflow_id = s.workflow_id
       and t.base_version is not distinct from s.current_version
       and t.node_id = s.node_id
       and t.kind = 'add_stage'
     order by t.draft_rev desc, t.seq desc
     limit 1
  ) added on true;

comment on view ouroboros.workflow_draft_node_provenance is
  'Per stage of each workflow''s draft, who added it (#556): copilot | suggestion for a stage the conversation or an Apply added and no canvas/code operation has touched since; human for one a person added or has since reconfigured; published for one inherited from the draft''s base. The added-by-copilot pill''s source, read without any copilot table.';
comment on column ouroboros.workflow_draft_node_provenance.provenance is
  'human | copilot | suggestion | published.';
comment on column ouroboros.workflow_draft_node_provenance.added_rev is
  'The draft_rev whose batch added the stage; null for a published one.';

create view ouroboros.workflow_draft_replay_mismatches as
select w.id as workflow_id, w.organization_id, w.current_version, w.draft_rev,
       v.definition as stored, ouroboros.workflow_draft_replay(w.id) as replayed
  from ouroboros.workflows w
  left join ouroboros.workflow_versions v on v.workflow_id = w.id and v.version is null
 where w.draft_rev > 0
   and v.definition is distinct from ouroboros.workflow_draft_replay(w.id);

comment on view ouroboros.workflow_draft_replay_mismatches is
  'The consistency probe (#556): every workflow whose draft has an operation log (draft_rev > 0) and whose stored draft differs from that log replayed over its base. Empty is the invariant.';

-- ---------------------------------------------------------------------------
-- Grants. The application reads the log and the projections and applies batches; it never
-- inserts, edits or deletes an operation itself.
-- ---------------------------------------------------------------------------
grant select on ouroboros.draft_operations to ouroboros_app;
revoke insert, update, delete on ouroboros.draft_operations from ouroboros_app;
grant select on ouroboros.workflow_draft_node_provenance to ouroboros_app;
grant select on ouroboros.workflow_draft_replay_mismatches to ouroboros_app;
grant execute on function ouroboros.apply_draft_batch(text, uuid, text, text, uuid, uuid, jsonb)
  to ouroboros_app;
