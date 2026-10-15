-- ===========================================================================
-- V146 — live-run admission: confirmation and the concurrency ceiling (#1312, DI.4)
-- ===========================================================================
--
-- V145 gave the engine a claim. Whether an item may be claimed is ouroboros-rest's decision at
-- claim time (the deployment switch, the workspace's pause, the repository's dry-run policy,
-- the pinned workflow, the route); two of its inputs need somewhere to live:
--
--   1. **`queue_items.confirmed_at` / `confirmed_by`** — a person holding `can_approve_loops`
--      said this item may become a live run (decision L5: no automatic pickup). Stamped at
--      enqueue when the deployment switch is on and the enqueuer holds the capability, or later
--      by `POST /api/v1/queue/{id}/confirm`. Every row that predates this migration is null, so
--      an item queued months ago to exercise the simulator waits until someone re-confirms it.
--   2. **`workspace_settings.live_run_ceiling`** — how many live runs may execute at once in
--      the workspace: 1 … 100, default 1 (decision L10). The deployment's own maximum
--      (`OURO_LIVE_RUN_CEILING_MAX`) bounds what the endpoint accepts; the check here is only
--      the absolute range.
--
-- To undo (forward only — for a rehearsal against a copy):
--   create or replace view ouroboros.workspace_settings_effective … (V126's body);
--   alter table ouroboros.workspace_settings drop column live_run_ceiling;
--   alter table ouroboros.queue_items drop column confirmed_at, drop column confirmed_by;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Confirmation.
-- ---------------------------------------------------------------------------
alter table ouroboros.queue_items
  add column confirmed_at timestamptz,
  add column confirmed_by text references ouroboros."user" ("id") on delete set null,
  -- A confirmer without a confirmation is meaningless; a confirmation whose confirmer was
  -- deleted keeps its time.
  add constraint queue_items_confirmed_by_needs_at
    check (confirmed_by is null or confirmed_at is not null);

comment on column ouroboros.queue_items.confirmed_at is
  'When a member holding can_approve_loops made this item claimable by a live run (#1312). Null until then: the claim skips it with needs_confirmation.';
comment on column ouroboros.queue_items.confirmed_by is
  'Who confirmed the item, or null once that user is deleted (the time is kept).';

-- ---------------------------------------------------------------------------
-- 2. The workspace's live-run ceiling.
-- ---------------------------------------------------------------------------
alter table ouroboros.workspace_settings
  add column live_run_ceiling integer not null default 1
    constraint workspace_settings_live_run_ceiling_bounded
      check (live_run_ceiling between 1 and 100);

comment on column ouroboros.workspace_settings.live_run_ceiling is
  'How many live runs may execute at once in the workspace (#1312, DI.4): 1–100, default 1. OURO_LIVE_RUN_CEILING_MAX bounds what the settings endpoint accepts.';

create or replace view ouroboros.workspace_settings_effective
  with (security_invoker = true) as
select o."id"                                     as organization_id,
       coalesce(s.auto_merge_on_checks, false)    as auto_merge_on_checks,
       (s.organization_id is not null)            as is_explicit,
       s.updated_at,
       s.updated_by,
       coalesce(s.runner_bearer_fallback, false)  as runner_bearer_fallback,
       coalesce(s.guardrail_exception_max_ttl_minutes, 1440) as guardrail_exception_max_ttl_minutes,
       coalesce(s.action_token_ttl_minutes, 2880)            as action_token_ttl_minutes,
       coalesce(s.research_start_role, 'member')  as research_start_role,
       coalesce(s.dry_run_cap_cents, 1000)        as dry_run_cap_cents,

       -- Appended, as V126's column was; the default restated here is asserted equal to the
       -- column's in constraints.sql.
       coalesce(s.live_run_ceiling, 1)            as live_run_ceiling
  from ouroboros.organization o
  left join ouroboros.workspace_settings s
    on s.organization_id = o."id";

comment on column ouroboros.workspace_settings_effective.live_run_ceiling is
  'How many live runs may execute at once (#1312): 1 for a workspace that has never set it. Bound to the column default by constraints.sql.';
