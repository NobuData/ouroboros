-- ===========================================================================
-- V142 — every workspace has the copilot's task kind (#1748)
-- ===========================================================================
--
-- The Workflow Copilot routes through the task kind `copilot-workflow` (`COPILOT_TASK_KIND` in
-- ouroboros-rest). Task kinds are registry data (V016, decision M3) and nothing ever gave a
-- workspace this one, so every copilot reply read *"this workspace has no route for the
-- `copilot-workflow` task kind"* and nobody could fix that from the product: the routing API
-- saves onto task kinds that exist.
--
--   who                         what it gets                         by
--   ─────────────────────────────────────────────────────────────────────────────────────
--   every existing workspace    the `copilot-workflow` task kind     this migration
--   every new workspace         the same                             the trigger below
--   its route and hops          not here                             Model routing's save
--
-- **The kind, not a route.** A route is never empty (V016's `route_chain_intact`), a hop names
-- an alias, and a new workspace has none yet — so the route is created by
-- `PUT /api/v1/routing/routes` the first time somebody saves a chain for the kind (#1748),
-- and by `R__dev_seed_routing.sql` for the seeded workspace.
--
-- **Sort order.** `task_kinds.sort_order` is unique per workspace, and the dev seed writes its
-- ten kinds at 1–10 after this kind already exists, so the copilot's row sits clear of any
-- matrix a workspace builds: 1000, or one past the workspace's last row when that is higher.
-- ===========================================================================

create function ouroboros.copilot_task_kind_seed(p_organization_id text)
returns void language sql as $$
  insert into ouroboros.task_kinds (organization_id, name, description, sort_order)
  select p_organization_id,
         'copilot-workflow',
         'Draft and edit workflows in conversation',
         greatest(1000, coalesce(max(kind.sort_order), 0) + 1)
    from ouroboros.task_kinds kind
   where kind.organization_id = p_organization_id
  having not exists (select 1 from ouroboros.task_kinds existing
                      where existing.organization_id = p_organization_id
                        and existing.name = 'copilot-workflow');
$$;

comment on function ouroboros.copilot_task_kind_seed(text) is
  'Gives a workspace the copilot-workflow task kind the Workflow Copilot routes through, unless it already has it (#1748).';

create function ouroboros.organization_seed_copilot_task_kind()
returns trigger language plpgsql as $$
begin
  perform ouroboros.copilot_task_kind_seed(new."id");
  return null;
end;
$$;

comment on function ouroboros.organization_seed_copilot_task_kind() is
  'Gives every new workspace the copilot-workflow task kind (#1748).';

create trigger organization_seed_copilot_task_kind
  after insert on ouroboros.organization
  for each row execute function ouroboros.organization_seed_copilot_task_kind();

-- And every workspace that already exists.
select ouroboros.copilot_task_kind_seed("id") from ouroboros.organization;
