-- ===========================================================================
-- V156 — the workspace default pool and the template pool binding (#1834, FE.1)
-- ===========================================================================
--
-- The four shipped templates (V068) give their build and test stages `"config": {}`, and the
-- node copy says *"Builds the repository on the default pool"* — but no default pool existed.
-- Readiness answered `build_pool_required` and the engine refused the stage, so an unedited
-- template could never run a build. This migration makes the copy true.
--
--   object                               what it says
--   ──────────────────────────────────────────────────────────────────────────────────────────
--   runner_pools.is_default              this pool is the workspace's default — at most one per
--                                        workspace (runner_pools_one_default_idx)
--   runner_pools_default_first           BEFORE INSERT: a workspace's first pool becomes the
--                                        default
--   runner_pools_default_moves           AFTER DELETE: deleting the default hands it to the
--                                        oldest remaining pool, so it is never lost silently
--   runs.default_pool_id                 the pool a run's `$default` stages resolved to, pinned
--                                        at its first `$default` build so it never drifts mid-run
--   workflow_templates v2 (global)       every infra stage that names no pool carries
--                                        `"runner_pool": "$default"`
--
-- **`$default` cannot collide with a pool.** V040's `runner_pools_name_shape` admits only
-- `[a-z0-9-]`, so the reserved word is never a real pool's name.
--
-- **Settings changes the default.** ouroboros-rest's `PATCH /api/v1/farm/pools/:id`
-- `{isDefault: true}` clears the old default and sets the new one in one transaction; the
-- partial unique index is the line that cannot be crossed whatever the service believed.
--
-- **Published workflow versions are not touched.** A workspace's own versions are its data; only
-- the product's global template rows get a new version, through the version trigger like any
-- other publisher. An organization's template override is its own and is left alone.
--
-- To undo (forward only — for a rehearsal against a copy):
--   delete from workflow_templates where organization_id is null and version = 2;
--   recreate runs_with_stage with V151's body;
--   alter table ouroboros.runs drop column default_pool_id;
--   drop trigger runner_pools_default_moves / runner_pools_default_first and their functions;
--   alter table ouroboros.runner_pools drop column is_default;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- runner_pools.is_default
-- ---------------------------------------------------------------------------
alter table ouroboros.runner_pools
  add column is_default boolean not null default false;

comment on column ouroboros.runner_pools.is_default is
  'Whether this is the workspace default pool (#1834, FE.1) — where a workflow stage naming runner_pool "$default" builds. At most one per workspace (runner_pools_one_default_idx); the first pool a workspace creates becomes it (runner_pools_default_first), and deleting it hands it to the oldest remaining pool (runner_pools_default_moves).';

-- Backfill: every workspace that already has pools gets its oldest as the default.
update ouroboros.runner_pools pool
   set is_default = true
  from (select distinct on (organization_id) id
          from ouroboros.runner_pools
         order by organization_id, created_at, id) oldest
 where pool.id = oldest.id;

create unique index runner_pools_one_default_idx
  on ouroboros.runner_pools (organization_id)
  where is_default;

comment on index ouroboros.runner_pools_one_default_idx is
  'One default pool per workspace (#1834, FE.1). Partial: only the default row is indexed.';

-- ---------------------------------------------------------------------------
-- The first pool becomes the default
-- ---------------------------------------------------------------------------
create function ouroboros.runner_pools_default_first()
returns trigger
language plpgsql as $$
begin
  if new.is_default then
    return new;
  end if;

  -- Two first pools created at once would both see no default; the lock makes the second wait
  -- for the first to commit and then see it. Scoped to the workspace, held to the transaction.
  perform pg_advisory_xact_lock(hashtext('runner_pools_default:' || new.organization_id));

  if not exists (select 1
                   from ouroboros.runner_pools
                  where organization_id = new.organization_id
                    and is_default) then
    new.is_default := true;
  end if;

  return new;
end;
$$;

comment on function ouroboros.runner_pools_default_first() is
  'BEFORE INSERT trigger for runner_pools (#1834, FE.1): a workspace''s first pool — any pool inserted while the workspace has no default — becomes the default.';

create trigger runner_pools_default_first
  before insert on ouroboros.runner_pools
  for each row execute function ouroboros.runner_pools_default_first();

-- ---------------------------------------------------------------------------
-- Deleting the default moves it
-- ---------------------------------------------------------------------------
create function ouroboros.runner_pools_default_moves()
returns trigger
language plpgsql as $$
begin
  if not old.is_default then
    return null;
  end if;

  -- The oldest remaining pool. None remaining (or a workspace being deleted, whose pools all go
  -- in the same statement) leaves the workspace with no default, and readiness says so.
  update ouroboros.runner_pools
     set is_default = true
   where id = (select id
                 from ouroboros.runner_pools
                where organization_id = old.organization_id
                order by created_at, id
                limit 1);

  return null;
end;
$$;

comment on function ouroboros.runner_pools_default_moves() is
  'AFTER DELETE trigger for runner_pools (#1834, FE.1): deleting the default pool makes the oldest remaining pool of the workspace the default. With no pool left the workspace has no default and readiness answers build_pool_required — never silently.';

create trigger runner_pools_default_moves
  after delete on ouroboros.runner_pools
  for each row execute function ouroboros.runner_pools_default_moves();

-- ---------------------------------------------------------------------------
-- runs.default_pool_id — the pin
-- ---------------------------------------------------------------------------
alter table ouroboros.runs
  add column default_pool_id uuid,
  -- V047's shape: a pool of this run's own workspace, and SET NULL naming the one column so the
  -- not-null organization_id is left alone.
  add constraint runs_default_pool_fk
    foreign key (default_pool_id, organization_id)
    references ouroboros.runner_pools (id, organization_id)
    on delete set null (default_pool_id);

comment on column ouroboros.runs.default_pool_id is
  'The pool this run''s "$default" build stages resolved to (#1834, FE.1): the workspace default when its first such stage was submitted, pinned so a later change of default does not move a run mid-way. Null until a "$default" stage builds, and for a run that names its pools.';
comment on constraint runs_default_pool_fk on ouroboros.runs is
  'A run pins a pool of its own workspace (#1834). SET NULL names the one column, V047''s reason.';

create index runs_default_pool_idx
  on ouroboros.runs (default_pool_id, organization_id)
  where default_pool_id is not null;

comment on index ouroboros.runs_default_pool_idx is
  'What runs_default_pool_fk releases a pin through when a pool is deleted (#1834). Partial: most runs pin nothing.';

-- ---------------------------------------------------------------------------
-- `runs_with_stage` carries the new column too — V049's reason (V151's body, plus one).
-- ---------------------------------------------------------------------------
create or replace view ouroboros.runs_with_stage as
select run.id,
       run.organization_id,
       run.github_repo_id,
       run.issue_number,
       run.issue_title,
       run.workflow_tag,
       run.model,
       run.status,
       coalesce(current_stage.stage_label, run.stage_label) as stage_label,
       coalesce(current_stage.stage_index, run.stage_index) as stage_index,
       coalesce(current_stage.stage_total, run.stage_total) as stage_total,
       run.started_at,
       run.finished_at,
       run.pr_number,
       run.checks_passed,
       run.checks_total,
       run.created_at,
       run.updated_at,
       run.loop_seq,
       run.branch_name,
       run.workflow_version_pin,
       run.simulated,
       run.event_seq,
       run.event_bytes,
       run.event_cap,
       run.event_byte_cap,
       run.events_elided_at,
       run.merge_strategy,
       run.reserved_build_job_id,
       run.event_hint,
       run.change_set_seq,
       run.playbook_id,
       run.events_swept_at,
       run.origin,
       run.queue_item_id,
       run.exec_epoch,
       run.exec_worker,
       run.exec_heartbeat_at,
       run.exec_base_commit,
       run.exec_checkpoint,
       run.exec_checkpoint_at,
       run.started_by,
       run.default_pool_id
  from ouroboros.runs run
  left join ouroboros.run_stage_current current_stage
    on current_stage.run_id = run.id;

comment on view ouroboros.runs_with_stage is
  'runs, with the stage meter resolved from stage history (#298, the amendment on #64, extended by #299, #300, #303, #407, #482, #1313, #91, #160, #1310 and #1834). Identical to runs for a run with no run_stages rows, which is what lets a read move over one at a time and what keeps mockup 02 rendering while the legacy columns are still on the table. Their removal is a later migration.';

-- ---------------------------------------------------------------------------
-- The shipped templates, v2: build and test stages run on the workspace default pool
-- ---------------------------------------------------------------------------
insert into ouroboros.workflow_templates
    (organization_id, slug, version, name, description, stage_dots, effort_range, caption,
     definition, tier, unlock_rule, sort_order)
select null, latest.slug, latest.version + 1, latest.name, latest.description, latest.stage_dots,
       latest.effort_range, latest.caption,
       jsonb_set(latest.definition, '{nodes}',
                 (select jsonb_agg(case
                                     when node->>'type' = 'infra'
                                          and not coalesce(node->'config', '{}'::jsonb) ? 'runner_pool'
                                     then jsonb_set(node, '{config}',
                                                    coalesce(node->'config', '{}'::jsonb)
                                                      || '{"runner_pool": "$default"}'::jsonb)
                                     else node
                                   end
                                   order by position)
                    from jsonb_array_elements(latest.definition->'nodes')
                           with ordinality as nodes(node, position))),
       latest.tier, latest.unlock_rule, latest.sort_order
  from (select distinct on (slug) *
          from ouroboros.workflow_templates
         where organization_id is null
         order by slug, version desc) latest
 where jsonb_path_exists(latest.definition,
                         '$.nodes[*] ? (@.type == "infra" && !exists(@.config.runner_pool))');
