-- ===========================================================================
-- V144 — every workspace has the `estimate` task kind, and a sizing call is metered
-- ===========================================================================
--
-- The issue estimator runs on a model the workspace chooses (O.2's core, #123): ouroboros-rest
-- resolves the workspace's route for the `estimate` task kind (Model routing) and the engine
-- calls that model through the invocation gateway (AF.2). With no route, the estimator uses
-- the workspace's Ollama connection with `llama3.1:8b`; with neither, the heuristic
-- (`heuristic-v0`). For the choice to be the workspace's, every workspace needs the kind to
-- route — as V142 gave every workspace `copilot-workflow` (#1748):
--
--   who                         what it gets                         by
--   ─────────────────────────────────────────────────────────────────────────────────────
--   every existing workspace    the `estimate` task kind             this migration
--   every new workspace         the same                             the trigger below
--   its route and hops          not here                             Model routing's save
--
-- **The kind, not a route.** No route is the state that means *use the default* (Ollama),
-- and a route needs an alias the workspace may not have.
--
-- **Sort order.** One past the workspace's last row, and never below 1001, so it sits after
-- V142's copilot kind (1000) and clear of any matrix a workspace builds. A workspace that
-- already has an `estimate` kind (the development seed's) keeps it.
--
-- **Metering.** A sizing call is attributed to what it sized — a GitHub issue, a canonical
-- ticket or a ticket draft — as `token_usage.subject_kind = 'estimate'` with that row's id,
-- so the invocation gateway can meter it like a run's, a copilot session's, a dry run's or an
-- investigation's call (V139).
--
-- Revert forward:
--   drop trigger organization_seed_estimate_task_kind on ouroboros.organization;
--   drop function ouroboros.organization_seed_estimate_task_kind(),
--                 ouroboros.estimate_task_kind_seed(text);
--   restore V139's token_usage_subject_kind check once no row says 'estimate'.
-- ===========================================================================

create function ouroboros.estimate_task_kind_seed(p_organization_id text)
returns void language sql as $$
  insert into ouroboros.task_kinds (organization_id, name, description, sort_order)
  select p_organization_id,
         'estimate',
         'Size effort XS–XL before queueing',
         greatest(1001, coalesce(max(kind.sort_order), 0) + 1)
    from ouroboros.task_kinds kind
   where kind.organization_id = p_organization_id
  having not exists (select 1 from ouroboros.task_kinds existing
                      where existing.organization_id = p_organization_id
                        and existing.name = 'estimate');
$$;

comment on function ouroboros.estimate_task_kind_seed(text) is
  'Gives a workspace the estimate task kind the issue estimator routes through, unless it already has it (O.2, #123).';

create function ouroboros.organization_seed_estimate_task_kind()
returns trigger language plpgsql as $$
begin
  perform ouroboros.estimate_task_kind_seed(new."id");
  return null;
end;
$$;

comment on function ouroboros.organization_seed_estimate_task_kind() is
  'Gives every new workspace the estimate task kind (O.2, #123).';

create trigger organization_seed_estimate_task_kind
  after insert on ouroboros.organization
  for each row execute function ouroboros.organization_seed_estimate_task_kind();

-- And every workspace that already exists.
select ouroboros.estimate_task_kind_seed("id") from ouroboros.organization;

-- A sizing call's subject.
alter table ouroboros.token_usage
  drop constraint token_usage_subject_kind,
  add constraint token_usage_subject_kind
    check (subject_kind is null
           or subject_kind in ('run', 'copilot_session', 'dry_run', 'investigation', 'estimate'));

comment on constraint token_usage_subject_kind on ouroboros.token_usage is
  'What a non-run call is attributed to: a copilot session, a dry run, an investigation (V139), or an estimate — the GitHub issue, ticket or draft it sized (O.2, #123).';
