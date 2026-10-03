-- V088__analyzer_actions.sql — what the Build Analyzer's Apply composes, and what it leaves behind
-- (#514, BV.5, decisions A4/A5).
--
-- The analyzer never mutates another plane's tables. Every Apply hands a change to the plane that
-- owns it, through that plane's API, and this migration adds the three things those planes were
-- missing, plus the analyzer's own record of what it asked for:
--
--   1. **A draft may carry a proposed change note.** *"Draft as v16"* creates a real WF-P.3 draft
--      whose note cites the finding, so the person who publishes it reads why it exists. V029
--      reserved `change_note` for publishes; a draft's note is now a proposal the publisher keeps or
--      replaces — publishing still sets `published_by`, and publishing is still a person's act.
--   2. **The `queue_wait` metric** — the runner-move suggestion predicts a queue wait, and BU.3's
--      measurement row must name the metric its baseline is read from.
--   3. **Farm job hooks** — *"re-warm ccache right after deps-refresh merges"* registers a job the
--      farm submits on every matching merge into a repository.
--   4. **`analysis_suggestion_applications`** — one row per apply: the payload executed, the preview
--      the person confirmed, where the change landed, and what its undo would be (BX.3's
--      auto-apply needs the reversal; the MVP UI does not read it).

-- ---------------------------------------------------------------------------
-- 1. A draft may carry a proposed change note.
-- ---------------------------------------------------------------------------
alter table ouroboros.workflow_versions
  drop constraint workflow_versions_draft_unattributed,
  add constraint workflow_versions_draft_unattributed
    check (published_at is not null or published_by is null);

comment on constraint workflow_versions_draft_unattributed on ouroboros.workflow_versions is
  'A draft has no publisher (#132): nobody has published it. Since #514 a draft may carry a proposed change_note — the Build Analyzer''s draft cites the finding it came from — which the publisher keeps or replaces at publish.';
comment on column ouroboros.workflow_versions.change_note is
  'Why this version exists. On a published version, the publisher''s note; on the draft, a proposed note (#514 — e.g. the Build Analyzer citing its finding) that publishing keeps or replaces.';

-- ---------------------------------------------------------------------------
-- 2. The queue-wait metric family.
--
-- One metric, `queue_wait`: how long farm jobs that started on the day waited between being
-- queued and starting, per pool. A median row keeps the day's samples (V078's rule), so a window
-- pools them — and so the measurement job can read any percentile of the window, including the
-- p95 the runner-move suggestion predicts, from the same retained samples.
-- ---------------------------------------------------------------------------
alter table ouroboros.metric_definitions
  drop constraint metric_definitions_dimension_kind_known,
  add constraint metric_definitions_dimension_kind_known
    check (dimension_kind in ('stage', 'suite', 'effort', 'cause', 'task_kind', 'job_label',
                              'pool'));

comment on column ouroboros.metric_definitions.dimension_kind is
  'What a dimensioned metric''s rows are broken out by — stage, suite, effort, cause, task_kind, job_label or pool — or null for an undimensioned metric. metric_daily_shape_guard holds every row to it.';

insert into ouroboros.metric_definitions
  (metric_id, family, title, formula_text, source_planes, caveats, unit, is_rate, proxy,
   aggregation, dimension_kind)
values
  ('queue_wait', 'queue_wait', 'Queue wait',
   'The median time build-farm jobs that started on this day waited between being queued and starting, per pool. A window''s median pools every job in the window, never averaging daily medians; its samples answer any other percentile the same way.',
   '{builds}',
   'Jobs that never started (canceled while queued) are not timed. A retry waits again and is timed again.',
   'duration_ms', false, false, 'median', 'pool');

-- ---------------------------------------------------------------------------
-- 3. farm_job_hooks — a job the farm submits when something happens to a repository.
--
-- `merge` is the one event: a pull request into the repository merged. `title_contains`
-- narrows it — *"after every deps-refresh merge"* is the merges whose title contains
-- `deps-refresh`. The hook's job runs `command` in `pool_id` against the repository's default
-- branch, exactly as a person submitting it through the farm would.
-- ---------------------------------------------------------------------------
create table ouroboros.farm_job_hooks (
  id              uuid        primary key default gen_random_uuid(),

  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The repository whose merges fire it, and the pool its job runs in.
  github_repo_id  uuid        not null
                              references ouroboros.github_repos (id) on delete cascade,
  pool_id         uuid        not null,

  event           text        not null default 'merge'
                              constraint farm_job_hooks_event_known
                                check (event in ('merge')),

  -- Only merges whose pull-request title contains this, case-insensitively; null is every merge.
  title_contains  text
                  constraint farm_job_hooks_title_contains_present
                    check (btrim(title_contains) <> '' and length(title_contains) <= 256),

  -- The job: the label the runners table prints, its title, and its command.
  label           text        not null
                              constraint farm_job_hooks_label_present
                                check (btrim(label) <> '' and length(label) <= 128),
  title           text        not null
                              constraint farm_job_hooks_title_present
                                check (btrim(title) <> '' and length(title) <= 512),
  command         text        not null
                              constraint farm_job_hooks_command_present
                                check (btrim(command) <> '' and length(command) <= 4096),

  enabled         boolean     not null default true,

  created_by      text        references ouroboros."user" ("id") on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint farm_job_hooks_id_organization_key unique (id, organization_id),

  constraint farm_job_hooks_pool_fk
    foreign key (pool_id, organization_id)
    references ouroboros.runner_pools (id, organization_id) on delete cascade
);

-- Registering the same hook twice is one hook — a retried apply does not double the jobs.
create unique index farm_job_hooks_identity_idx
  on ouroboros.farm_job_hooks
     (organization_id, github_repo_id, pool_id, event, command, coalesce(title_contains, ''));

create index farm_job_hooks_repo_idx
  on ouroboros.farm_job_hooks (github_repo_id, event)
  where enabled;

create trigger farm_job_hooks_touch_updated_at
  before update on ouroboros.farm_job_hooks
  for each row execute function ouroboros.touch_updated_at();

comment on table ouroboros.farm_job_hooks is
  'Jobs the farm submits on a repository event (#514): on every merge into github_repo_id whose title contains title_contains (all merges when null), submit command in pool_id. The Build Analyzer''s "re-warm ccache right after deps-refresh merges" registers one through the farm''s API; it never writes this table itself.';
comment on column ouroboros.farm_job_hooks.title_contains is
  'Narrows the event to merges whose pull-request title contains this, case-insensitively. Null fires on every merge.';

grant select, insert, update, delete on ouroboros.farm_job_hooks to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 4. analysis_suggestion_applications — what one Apply composed, and how to undo it.
--
--   plane      — the binding's plane, as applied
--   change     — the resolved payload the plane was handed (ids, not names)
--   preview    — the consequence sentence the person confirmed; generated from `change`
--   target     — where it landed: {kind, id, …} — a pool window, a job hook, a workflow draft
--   reversal   — {action, target}: the call that would undo it (BX.3's auto-apply)
--
-- Written by the analyzer after the owning plane accepted the change and the apply was audited,
-- in the statement that moves the suggestion to `applied`. Immutable.
-- ---------------------------------------------------------------------------
create table ouroboros.analysis_suggestion_applications (
  suggestion_id    uuid        primary key,
  organization_id  text        not null,
  repo_ref         ouroboros.repo_ref not null,

  plane            text        not null
                               constraint analysis_suggestion_applications_plane_known
                                 check (plane in ('farm_config', 'job_hook', 'workflow')),
  change           jsonb       not null
                               constraint analysis_suggestion_applications_change_object
                                 check (jsonb_typeof(change) = 'object'),
  preview          text        not null
                               constraint analysis_suggestion_applications_preview_present
                                 check (btrim(preview) <> '' and length(preview) <= 2048),
  target           jsonb       not null
                               constraint analysis_suggestion_applications_target_shape
                                 check (coalesce(jsonb_typeof(target) = 'object'
                                        and ouroboros.analysis_json_text(target -> 'kind') is not null
                                        and ouroboros.analysis_json_text(target -> 'id') is not null,
                                        false)),
  reversal         jsonb       not null
                               constraint analysis_suggestion_applications_reversal_shape
                                 check (coalesce(jsonb_typeof(reversal) = 'object'
                                        and ouroboros.analysis_json_text(reversal -> 'action') is not null
                                        and jsonb_typeof(reversal -> 'target') = 'object',
                                        false)),

  -- Cascade: the trail is append-only, so only a workspace's removal deletes its events, and the
  -- cascades of that one statement reach the event and this row in no promised order.
  applied_event_id uuid        not null references ouroboros.audit_events (id) on delete cascade,
  applied_by       text        references ouroboros."user" ("id") on delete set null,
  applied_at       timestamptz not null default now(),

  constraint analysis_suggestion_applications_suggestion_fkey
    foreign key (suggestion_id, organization_id, repo_ref)
    references ouroboros.analysis_suggestions (id, organization_id, repo_ref) on delete cascade
);

-- An application is a record: what was applied is what was applied.
create function ouroboros.analysis_suggestion_applications_frozen()
returns trigger language plpgsql as $$
begin
  if (new.suggestion_id, new.organization_id, new.repo_ref, new.plane, new.change, new.preview,
      new.target, new.reversal, new.applied_event_id, new.applied_at)
     is distinct from
     (old.suggestion_id, old.organization_id, old.repo_ref, old.plane, old.change, old.preview,
      old.target, old.reversal, old.applied_event_id, old.applied_at)
     or (new.applied_by is not null and new.applied_by is distinct from old.applied_by) then
    raise exception 'the application of suggestion % is a record; it is not revised', old.suggestion_id
      using errcode = 'check_violation', constraint = 'analysis_suggestion_applications_frozen';
  end if;
  return new;
end;
$$;

comment on function ouroboros.analysis_suggestion_applications_frozen() is
  'An application row (#514) never changes once written; applied_by may only go null by its foreign key.';

create trigger analysis_suggestion_applications_frozen
  before update on ouroboros.analysis_suggestion_applications
  for each row execute function ouroboros.analysis_suggestion_applications_frozen();

comment on table ouroboros.analysis_suggestion_applications is
  'One Build Analyzer apply (#514, BV.5): the plane, the resolved payload handed to it, the preview the person confirmed (generated from that payload), where the change landed and the reversal that would undo it (for BX.3). Immutable.';
comment on column ouroboros.analysis_suggestion_applications.reversal is
  '{action, target} — the owning plane''s call that undoes this apply, e.g. {"action": "farm.pool_window.delete", "target": {"id": …}}. Unused by the MVP UI; BX.3''s auto-apply requires it.';

grant select, insert, update on ouroboros.analysis_suggestion_applications to ouroboros_app;
