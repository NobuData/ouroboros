-- dependency-cycles.sql — the recursive-CTE walk that finds a stored dependency cycle (#276, AK.5).
--
-- Defines pg_temp.dependency_graph_has_cycle(org), in pg_temp so it disappears with the session.
-- Two suites need it, and they need the *same* walk: constraints.sql's V035 section proves it sees
-- a planted cycle and stays quiet on an acyclic graph, and lib/planning-invariants.sql asks it of
-- every row the database holds. A second copy of the query would be a second thing to keep right,
-- and the V035 proof would stop being evidence about the probe AK.5 actually runs.
--
-- `create or replace`, because both of those files include this one and constraints.sql includes
-- the second — so the definition arrives twice in one session, and the second must be a no-op.
--
-- There is no acyclicity constraint in V035, and that is a decision rather than an omission:
-- detecting a cycle means walking the graph, which a CHECK cannot do. AL.4 (#280) refuses a cycle
-- on every write; this finds one that got past it. A cycle is not an error anybody sees — it is a
-- batch that can never be pushed, because AL.3 (#279) pushes in dependency order and a cycle has
-- no order.
--
-- Arguments:
--   org — the workspace whose graph to walk, or null (the default) for every workspace at once.
--         Walking them together is exact rather than approximate, because
--         ticket_dependencies_endpoints_in_organization holds both ends of an edge to the edge's
--         own workspace: no path can leave the workspace it starts in.
--
-- Returns: true when at least one cycle is stored, false when the graph is acyclic.
--
-- Node identity is `coalesce(draft_id, ticket_id)`, which is what makes this one CTE rather than a
-- four-branch join: both are uuid primary keys from two different tables, so one expression names
-- a node whichever kind it is. The walk is depth-bounded, because an unbounded recursion over a
-- graph that *does* contain a cycle never terminates — the bound is what turns non-termination
-- into a finding. The limit that buys: a cycle of more than 64 edges is not reported. That is far
-- past any batch a planner produces — mockup 09's is six drafts — and the bound is one number to
-- raise if that ever stops being true.
create or replace function pg_temp.dependency_graph_has_cycle(org text default null)
returns boolean
language sql as $$
  with recursive edges as (
    select coalesce(blocker_draft_id, blocker_ticket_id) as blocker,
           coalesce(blocked_draft_id, blocked_ticket_id) as blocked
      from ouroboros.ticket_dependencies
     where org is null or organization_id = org
  ),
  walk (start_node, node, depth, closed) as (
    select blocker, blocked, 1, blocker = blocked from edges
    union all
    select w.start_node, e.blocked, w.depth + 1, e.blocked = w.start_node
      from walk w
      join edges e on e.blocker = w.node
     where not w.closed and w.depth < 64
  )
  select exists (select 1 from walk where closed);
$$;
