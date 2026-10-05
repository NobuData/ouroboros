-- V104__workspace_purge_resumable.sql — a workspace purge that can be resumed (#490, BR.6).
--
-- V090's `workspace_tombstones` row was written at the *end* of a purge, after the organization
-- row was gone. A purge that failed between removing the organization and writing the tombstone
-- was therefore never retried: `workspace_lifecycle` cascades from `organization`, so the sweep
-- no longer saw the workspace as due, and the tombstone and `audit.workspace.purged` were lost.
-- A purge retried after the DEK was destroyed also recorded `dek_versions_destroyed = 0`.
--
-- The tombstone becomes the purge's **progress record** as well as its completion record:
--
--   - It is written **first**, before anything is destroyed, with the number of DEK versions
--     about to go. `purged_at` is null while the purge is in progress.
--   - The sweep resumes every tombstone whose `purged_at` is null, whether or not the
--     organization still exists, so no step after the shred can be skipped by a crash.
--   - Completion sets `purged_at` once, in the transaction that queues `audit.workspace.purged`.
--     A completed tombstone is immutable.
--   - Restore refuses a workspace whose tombstone exists: once its keys may be gone, it cannot
--     come back half-shredded.
--
-- ---------------------------------------------------------------------------
-- Reverting
-- ---------------------------------------------------------------------------
--
--   drop trigger workspace_tombstones_completed_immutable on ouroboros.workspace_tombstones;
--   drop function ouroboros.workspace_tombstones_completed_immutable();
--   drop index ouroboros.workspace_tombstones_in_progress_idx;
--   revoke update on ouroboros.workspace_tombstones from ouroboros_app;
--   delete from ouroboros.workspace_tombstones where purged_at is null;
--   alter table ouroboros.workspace_tombstones
--     drop column started_at,
--     alter column purged_at set default now(),
--     alter column purged_at set not null;

alter table ouroboros.workspace_tombstones
  add column started_at timestamptz not null default now(),
  alter column purged_at drop default,
  alter column purged_at drop not null;

-- Every tombstone V090 wrote was a completed purge; it started no later than it finished.
update ouroboros.workspace_tombstones set started_at = purged_at where purged_at is not null;

alter table ouroboros.workspace_tombstones
  add constraint workspace_tombstones_purged_after_started
    check (purged_at is null or purged_at >= started_at);

-- The sweep's resume read: every purge that began and has not finished.
create index workspace_tombstones_in_progress_idx
  on ouroboros.workspace_tombstones (started_at)
  where purged_at is null;

-- A purge in progress updates its own record — the artifact count, then completion. Nothing may
-- rewrite a completed one.
create function ouroboros.workspace_tombstones_completed_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.purged_at is not null then
    raise exception 'workspace tombstone % is complete and cannot change', old.organization_id
      using errcode = 'check_violation',
            constraint = 'workspace_tombstones_completed_immutable';
  end if;

  if new.organization_id <> old.organization_id
     or new.started_at <> old.started_at
     or new.dek_versions_destroyed <> old.dek_versions_destroyed then
    raise exception 'workspace tombstone % keeps its identity, start and key count', old.organization_id
      using errcode = 'check_violation',
            constraint = 'workspace_tombstones_completed_immutable';
  end if;

  return new;
end;
$$;

create trigger workspace_tombstones_completed_immutable
  before update on ouroboros.workspace_tombstones
  for each row execute function ouroboros.workspace_tombstones_completed_immutable();

grant update on ouroboros.workspace_tombstones to ouroboros_app;

comment on table ouroboros.workspace_tombstones is
  'The progress and completion record of a workspace purge (#489, #490). Written before anything is destroyed (purged_at null while in progress, resumed by the next sweep) and completed once: the tenant''s DEK was destroyed (dek_versions_destroyed, counted before the shred), its artifact objects deleted and its rows removed (rows_remaining, which the purge asserts is zero). Holds no tenant data beyond the workspace''s name and slug.';
comment on column ouroboros.workspace_tombstones.started_at is
  'When the purge began — before the DEK was destroyed.';
comment on column ouroboros.workspace_tombstones.purged_at is
  'When the purge completed. Null while it is in progress; set once, with audit.workspace.purged.';
