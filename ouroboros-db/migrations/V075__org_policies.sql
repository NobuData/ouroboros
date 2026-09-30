-- V075__org_policies.sql — `org_policies`: the workspace's dry-run policy, and the view every
-- reader resolves it through (#382, BA.3, decision O3).
--
-- Mockup 13's subline — *"Ouroboros starts in **dry-run**: it opens draft PRs and never merges
-- until you say so"* — is a promise, and this is where it is kept. `dry_run` is an org-level
-- policy the PR plane consults **below** every surface that could merge: `createPR` is forced to
-- a draft, the merge executor refuses to arm and re-checks at execution, and a workflow whose
-- terminal is `open_pr_automerge` is overridden at evaluation — never rewritten.
--
-- **The shape is V011's**, for V011's reasons: typed columns, one row per workspace keyed by the
-- workspace, and **lazy** row creation. A workspace with no row has never answered, and
-- `org_policies_effective` is what turns "never answered" into an answer, so no reader has to
-- remember a `coalesce`.
--
-- **"Unset" is the absence of the row, and it reads as dry-run off.** The issue's rule is
-- *"default ON at onboarding completion if unset — which is what makes the promise true for the
-- exact population it was made to"*: the promise is the wizard's, so it is the wizard's completion
-- that turns dry-run on. A workspace that existed before this migration and never onboarded keeps
-- merging exactly as it did — nobody's behaviour changes as a side effect of a deploy, in either
-- direction. So the view coalesces an absent row to `false`, while a row written without naming
-- the column — the onboarding default — is `true`, the column default.
--
-- Onboarding completion sets `dry_run = true` *when it is unset* and must not overwrite an
-- explicit `false`. That is one statement, and the primary key is its arbiter:
--
--   insert into ouroboros.org_policies (organization_id, dry_run) values ($1, true)
--   on conflict (organization_id) do nothing;
--
-- The flip (owner/admin, audited as `policy.dry_run_changed`) is the upsert:
--
--   insert into ouroboros.org_policies (organization_id, dry_run, updated_by) values ($1, $2, $3)
--   on conflict (organization_id) do update
--     set dry_run = excluded.dry_run, updated_by = excluded.updated_by;
--
-- **Not the policy document.** #480 (BQ.1) / #481 (BQ.2) generalise this to a per-repo
-- `first_n_loops` rule; the org-wide boolean survives there as the stricter override, so this
-- table is what that migration maps from rather than something it replaces.

create table ouroboros.org_policies (
  -- The workspace, and the key: the upserts in the header conflict on it. Cascade, so a
  -- deleted workspace leaves no policy behind for a reused id to inherit.
  organization_id text        not null primary key
                              references ouroboros.organization ("id")
                              on delete cascade,

  -- The dry-run policy. `not null`: absence of the row is the only "unset". Defaults `true`: a
  -- row is written by onboarding completion or by a person, and completion's answer is dry-run.
  dry_run         boolean     not null default true,

  -- Who last changed it — null for the onboarding default, which no person chose. Set null,
  -- never cascade, for V011's reason: deleting a person must not silently loosen the policy.
  updated_by      text        references ouroboros."user" ("id") on delete set null,

  created_at      timestamptz not null default now(),
  -- Moved by the trigger below, never by the writer.
  updated_at      timestamptz not null default now()
);

comment on table ouroboros.org_policies is
  'Org-level policies the PR plane enforces (#382, decision O3) — one row per workspace, written by onboarding completion or by a person. A workspace with no row has never answered and reads dry-run off through org_policies_effective. Lazy creation, as V011.';
comment on column ouroboros.org_policies.organization_id is
  'The workspace, and the key the onboarding default and the flip both conflict on. Cascades.';
comment on column ouroboros.org_policies.dry_run is
  'Dry-run (#382): while true, PRs open as drafts, merges are refused at arm and at execution, and workflow auto-merge terminals are overridden without being mutated. Defaults true — the answer onboarding completion writes when unset.';
comment on column ouroboros.org_policies.updated_by is
  'Who last changed a policy here, or null for the onboarding default. ON DELETE SET NULL — deleting a person must not revert the policy. Authorization (owner/admin) is the endpoint''s.';
comment on column ouroboros.org_policies.updated_at is
  'When a policy here last changed, moved by the touch_updated_at trigger.';

create trigger org_policies_touch_updated_at
  before update on ouroboros.org_policies
  for each row execute function ouroboros.touch_updated_at();

create view ouroboros.org_policies_effective
  with (security_invoker = true) as
select o."id"                     as organization_id,
       -- Never answered: dry-run off, so a workspace from before V075 keeps merging as it did.
       coalesce(p.dry_run, false) as dry_run,
       -- Whether the workspace has answered, as opposed to what the answer is.
       (p.organization_id is not null) as is_explicit,
       p.updated_at,
       p.updated_by
  from ouroboros.organization o
  left join ouroboros.org_policies p
    on p.organization_id = o."id";

comment on view ouroboros.org_policies_effective is
  'Every organization''s policies with the defaults resolved (#382) — one row per workspace whether or not it has an org_policies row. Read here, write the table.';
comment on column ouroboros.org_policies_effective.dry_run is
  'Whether dry-run is active — false for a workspace that has never answered (no row); onboarding completion writes true.';
comment on column ouroboros.org_policies_effective.is_explicit is
  'Whether the workspace has an org_policies row — a choice, or the onboarding default — rather than the view''s default.';

-- ---------------------------------------------------------------------------
-- The service role's grants
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert, update on ouroboros.org_policies to ouroboros_app;
grant select on ouroboros.org_policies_effective to ouroboros_app;
