-- V138 — a ticket source can be removed.
--
-- V030 gave everything mirrored through a source `on delete cascade` to it: its tickets, and
-- through them their estimates, dependencies and dry-run records (V030, V035, V038, V111); its
-- pull request records and what hangs off them (V052, V056–V058, V065); its planning mirrors
-- (V036) and the draft batches that target it (V034). A roadmap document (V125) and the
-- regression watch (V124) keep their row and lose the pointer (`on delete set null`).
--
-- Removing a source nevertheless failed, on V125's roadmap_docs_targets_same_workspace. A
-- document that named both the source and a batch targeting it had the batch cascaded away
-- first; clearing target_source_id then fired the trigger, which re-checked batch_id — still
-- set, its own `set null` not yet applied — against a batch that was already gone, and raised
-- "draft batch … is not of workspace …".
--
-- The trigger now checks a pointer only when that pointer, or the workspace it is checked
-- against, is what the statement changed. What it refuses is unchanged: a document can still
-- never name another workspace's source or batch.

create or replace function ouroboros.roadmap_docs_targets_same_workspace()
returns trigger language plpgsql as $$
declare
  moved boolean := tg_op = 'INSERT' or new.organization_id is distinct from old.organization_id;
begin
  if new.target_source_id is not null
     and (moved or new.target_source_id is distinct from old.target_source_id)
     and not exists (select 1 from ouroboros.ticket_sources s
                      where s.id = new.target_source_id
                        and s.organization_id = new.organization_id) then
    raise exception 'ticket source % is not of workspace %', new.target_source_id, new.organization_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  if new.batch_id is not null
     and (moved or new.batch_id is distinct from old.batch_id)
     and not exists (select 1 from ouroboros.draft_batches b
                      where b.id = new.batch_id and b.organization_id = new.organization_id) then
    raise exception 'draft batch % is not of workspace %', new.batch_id, new.organization_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.roadmap_docs_targets_same_workspace() is
  'Refuses a roadmap doc whose target source or batch belongs to another workspace (#624). Checks a pointer only when it, or the workspace, changed — so the set-null that follows a removed source or batch is not refused over the other pointer (V138).';
