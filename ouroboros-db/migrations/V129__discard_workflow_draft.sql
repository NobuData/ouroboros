-- V129__discard_workflow_draft.sql — dropping a workflow's draft, whole (#565, CE.1).
--
-- Mockup 20's head carries two buttons: **Promote to workflow** and **Discard draft**. Promote
-- is WF-P.3's publish. Discard is new, and V110 (#556) left no way to do it: the draft is not
-- one row but four things that must agree, and the application may write only one of them.
--
--   | what                                   | why it must move with the draft                  |
--   |----------------------------------------|--------------------------------------------------|
--   | `workflow_versions` (`version is null`) | the draft itself                                 |
--   | `draft_operations` of the current base | the log **is** the draft, as operations: replay  |
--   |                                        | folds every row whose `base_version` is the      |
--   |                                        | workflow's `current_version`                     |
--   | `workflows.draft_rev`                  | the N of `v0.N`; the next batch is recorded at   |
--   |                                        | `draft_rev + 1`                                  |
--   | `workflows.provenance_summary`         | batches per actor *on this draft*                |
--
-- Take any one without the others and the schema's own invariants break:
--
--   * **the row alone** — `draft_rev` stays 3 with no draft, so `workflow_draft_replay_mismatches`
--     reports the workflow (stored `null`, replayed three batches) for ever;
--   * **the row and the counter** — the next first edit is recorded at `draft_rev = 1`, which
--     `draft_operations_revision_seq_key` refuses, because the discarded draft's first batch is
--     still there; and were the key not there, replay would fold the discarded operations under
--     the new ones and the new draft would never equal its own log.
--
-- So discarding a draft removes its log. That is a deliberate, narrow exception to *the log is
-- history*, and the argument for it is what the log is a history **of**: the draft. V110 keeps
-- an earlier base's operations after a publish because that draft became a version somebody
-- can still read; a discarded draft became nothing. What a person may still want to know —
-- what the copilot did in the conversation that was discarded — is on the transcript
-- (`copilot_messages.tool_trace`, each operation with its outcome), which this function does
-- not touch. `draft_operations_no_update` still refuses every rewrite; only this function, and
-- a workflow's or a workspace's own cascade, removes a row.
--
-- A suggestion that was applied to the discarded draft keeps its `applied_op_batch_id`: it is
-- a record of what was pressed, the column has no foreign key, and
-- `dry_run_suggestions_transition` checks the batch only at the moment of the Apply.
--
-- **The conversation closes with the draft.** The workflow's active copilot session, if it has
-- one, moves to `discarded` with `closed_at` in the same statement — one function rather than
-- two writes so that there is never a draft-less workflow with a live conversation about the
-- draft it no longer has. Its messages are kept (the retention sweep removes them later, on
-- `custom:copilot-chat`). `closed_at` is `clock_timestamp()` rather than `now()`: a session
-- started by a transaction that began after this one would otherwise close before it was
-- created, which `copilot_sessions_closed_after_created` refuses.
--
-- **The workflow stays.** With a published version it is that version again; with none it is
-- an empty unpublished workflow, still listed, whose next edit starts a draft from the empty
-- document exactly as a first edit always has (`workflow_draft_base()`).
--
-- Runs as its owner for V110's reason: the application role may not delete from
-- `draft_operations`, and must not be able to.
--
-- Revert forward:
--   drop function ouroboros.discard_workflow_draft(text, uuid);

-- discard_workflow_draft(org, workflow) — drop the draft, its log and its counters, and close
-- the conversation about it.
--   p_organization_id — the workspace; the workflow must be one of its own
--   p_workflow_id     — the workflow whose draft is dropped
--   returns one row: whether a draft row was removed, how many logged operations went with it,
--     and the copilot session that was closed (null when none was active)
--   raises foreign_key_violation when the workflow is not the workspace's — and then nothing
--     is written. A workflow with neither a draft nor an active session is not an error here:
--     the row says so (false, 0, null) and the caller decides what that means.
create function ouroboros.discard_workflow_draft(p_organization_id text, p_workflow_id uuid)
returns table (draft_discarded boolean, operations_removed integer, session_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
#variable_conflict use_column
declare
  wf        ouroboros.workflows%rowtype;
  dropped   integer;
  removed   integer;
  closed    uuid;
begin
  -- The lock apply_draft_batch() takes: no batch is applied between the delete and the reset.
  select * into wf from ouroboros.workflows w
   where w.id = p_workflow_id and w.organization_id = p_organization_id
     for update;
  if not found then
    raise exception 'workflow % is not a workflow of workspace %', p_workflow_id, p_organization_id
      using errcode = 'foreign_key_violation';
  end if;

  delete from ouroboros.workflow_versions v
   where v.workflow_id = p_workflow_id and v.version is null;
  get diagnostics dropped = row_count;

  -- The current draft's log, and only it: operations over an earlier base are the history of
  -- a draft that was published.
  delete from ouroboros.draft_operations o
   where o.workflow_id = p_workflow_id
     and o.base_version is not distinct from wf.current_version;
  get diagnostics removed = row_count;

  update ouroboros.workflows w
     set draft_rev = 0,
         provenance_summary = '{"canvas": 0, "code": 0, "copilot": 0, "suggestion": 0}'
   where w.id = p_workflow_id
     and (w.draft_rev <> 0
          or w.provenance_summary
             <> '{"canvas": 0, "code": 0, "copilot": 0, "suggestion": 0}'::jsonb);

  -- At most one row: copilot_sessions_one_active.
  update ouroboros.copilot_sessions s
     set status = 'discarded', closed_at = clock_timestamp()
   where s.workflow_id = p_workflow_id and s.organization_id = p_organization_id
     and s.status = 'active'
  returning s.id into closed;

  return query select dropped > 0, removed, closed;
end;
$$;

comment on function ouroboros.discard_workflow_draft(text, uuid) is
  'Discard draft (#565): under the workflow''s lock, deletes its draft row and the current base''s draft_operations, returns draft_rev to 0 and provenance_summary to zeros, and moves the active copilot session (if any) to discarded with closed_at — atomically, so workflow_draft_replay_mismatches stays empty and the next first edit is recorded at draft_rev 1 over the base. The workflow, its published versions, earlier bases'' operations and the session''s messages are kept. Runs as its owner because the application role cannot delete from draft_operations.';

revoke execute on function ouroboros.discard_workflow_draft(text, uuid) from public;
grant execute on function ouroboros.discard_workflow_draft(text, uuid) to ouroboros_app;
