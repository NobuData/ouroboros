-- V123__research_start_role.sql — who may start an investigation, per workspace (#625, CM.6).
--
-- Mockup 22's composer starts an investigation, and an investigation spends money. The
-- lifecycle API (`POST /api/v1/research/investigations`) lets a workspace decide who may do
-- that: every contributor (owner, admin, member — the default), or administrators only. A
-- `viewer` never starts one, whatever is stored here.
--
-- One column on `workspace_settings` (V011), read through `workspace_settings_effective` so a
-- workspace that never chose reads the default from the database, as it does for every other
-- setting there:
--
--   research_start_role  member | admin   default member
--
-- `member` means "member and above"; `admin` means "admin and above". There is no `owner`
-- value: owners and admins are one tier everywhere else in the product (ADMINISTRATORS).
--
-- To undo (forward only — for a rehearsal against a copy):
--   create or replace view ouroboros.workspace_settings_effective … (V096's body), then
--   alter table ouroboros.workspace_settings drop column research_start_role;

alter table ouroboros.workspace_settings
  add column research_start_role text not null default 'member'
    constraint workspace_settings_research_start_role
      check (research_start_role in ('member', 'admin'));

comment on column ouroboros.workspace_settings.research_start_role is
  'The lowest role that may start an investigation (#625, CM.6): member (owner, admin and member — the default) or admin (owner and admin). A viewer never may.';

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

       -- Appended, as V041's and V096's columns were; the default restated here is asserted
       -- equal to the column's in constraints.sql.
       coalesce(s.research_start_role, 'member')  as research_start_role
  from ouroboros.organization o
  left join ouroboros.workspace_settings s
    on s.organization_id = o."id";

comment on column ouroboros.workspace_settings_effective.research_start_role is
  'The lowest role that may start an investigation (#625): member for a workspace that has never set it. Bound to the column default by constraints.sql.';
