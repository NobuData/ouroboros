-- planning-invariants.sql — the planning invariants AL.3 and AL.4 are written against, named
-- (#276, AK.5).
--
-- Three of mockup 09's guarantees are kept by application code, and each has a failure mode
-- that lands in the database without raising anything:
--
--   * **Acyclicity.** AL.4 (#280) refuses a cycle on every write, because finding one means
--     walking a graph. If that check has a bug, the symptom is not an error — it is a batch
--     that can *never* be pushed, because AL.3 (#279) pushes in dependency order and a cycle
--     has no order.
--   * **Push state.** Whether resume works. A draft that reaches `pushed` and returns to
--     `pending` is pushed twice — the duplicate issue decision N6 exists to prevent.
--   * **Month ranges.** The gantt's geometry. A reversed range renders as a negative-width
--     bar; a half-null one renders as nothing at all. Both look like a UI bug, not bad data.
--
-- The rules themselves are asserted behaviourally where the migrations that made them are:
-- constraints.sql's V034, V035 and V036 sections attempt every write the schema must refuse.
-- This fragment is the same list read two other ways, and every assertion's message **starts
-- with the name of the invariant it protects**, so a red build says which guarantee went:
--
--   1. **The rows the database holds.** Every planning row, in every workspace, satisfies
--      every invariant — including the one no constraint can state, that the stored dependency
--      graph has no cycle. This is the half that means something against a *seeded* database:
--      it is what makes AK.4's (#275) seeds a standing witness rather than a one-off insert,
--      and what tests/verify-planning-invariants.sh plants a bad row under to prove red.
--   2. **The catalogue, by name.** Fixture-free, for the reason Y.5's section of constraints.sql
--      gives: a behavioural probe depends on a fixture and can go vacuous, and a name in
--      pg_constraint cannot. The shape is asserted where the shape is the rule — a trigger is
--      checked for being *enabled*, a key for its columns — and no rule body is pinned, because
--      bodies are legitimately rewritten.
--
-- It runs twice, which is why it is kept here rather than in constraints.sql, as CG.5's registry
-- probes are: included as constraints.sql's AK.5 section, and through tests/planning-invariants.sql
-- against the seeded database `ci/db` builds. It therefore carries no transaction control and no
-- helpers of its own — whichever suite includes it owns both — and it writes nothing, so it is
-- safe against any database, a developer's included.
--
-- Cost: one recursive walk over ticket_dependencies and a handful of scans over tables a
-- workspace holds dozens of rows in. Nothing here is measurable next to the suite around it.

-- The walk the acyclicity invariant is asked with, shared with constraints.sql's V035 section so
-- the probe proven there to see a planted cycle is the probe run here.
\ir dependency-cycles.sql

-- ===========================================================================
-- 1. The rows the database holds
-- ===========================================================================

-- --- the stored dependency graph has no cycle ------------------------------------
--
-- No constraint can say this, so this is the only place it is said about stored rows. Every
-- workspace at once: the endpoint trigger keeps each edge inside its own workspace, so one walk
-- over all of them is exact.
select pg_temp.must_hold(
  not pg_temp.dependency_graph_has_cycle(),
  'dependency_graph_acyclic: no stored dependency cycle — a cycle is a batch AL.3 (#279) can never push');

-- --- every dependency endpoint is exactly one kind -------------------------------
--
-- Both set is an end that is a draft and a live ticket at once; neither is an edge attached to
-- nothing. Either makes coalesce(draft, ticket) — the node identity the walk above and AL.3's
-- ordering both use — name the wrong node or no node.
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.ticket_dependencies
               where num_nonnulls(blocker_draft_id, blocker_ticket_id) <> 1
                  or num_nonnulls(blocked_draft_id, blocked_ticket_id) <> 1),
  'ticket_dependencies_one_kind: every stored dependency endpoint references exactly one of a draft or a ticket');

-- --- push state is one of three --------------------------------------------------
--
-- AL.3's resume reads push_state to decide what still has to be created. A fourth word is a
-- draft resume neither skips nor retries.
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.ticket_drafts
               where push_state not in ('pending', 'pushed', 'failed')),
  'ticket_drafts_push_state: every stored draft is pending, pushed or failed');

-- --- a lane's month range runs forwards ------------------------------------------
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.planning_epics where start_month > end_month),
  'planning_epics_months_ordered: no stored lane ends before it starts — a bar with negative width');

-- --- and is both months or neither ----------------------------------------------
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.planning_epics
               where num_nonnulls(start_month, end_month) = 1),
  'planning_epics_months_paired: no stored lane carries half a month range — a lane the gantt cannot draw');

-- --- tint and status are the mockup's --------------------------------------------
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.planning_epics
               where tint not in ('accent', 'model', 'warn', 'ok', 'neutral')),
  'planning_epics_tint: every stored lane uses one of mockup 09''s five tints');

select pg_temp.must_hold(
  not exists (select 1 from ouroboros.planning_epics
               where status not in ('active', 'proposed', 'done', 'unscoped')),
  'planning_epics_status: every stored lane has one of the four lane statuses');

-- --- a local key names one draft within its batch ---------------------------------
--
-- `blocks OTA-3` resolves within its batch; two OTA-3s make that note point at either.
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.ticket_drafts
               group by batch_id, local_key having count(*) > 1),
  'ticket_drafts_batch_local_key_key: no stored batch holds the same local key twice');

-- ===========================================================================
-- 2. The catalogue, by name
-- ===========================================================================

-- --- the two endpoint rules ------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 2 from pg_constraint
    where conrelid = 'ouroboros.ticket_dependencies'::regclass
      and conname in ('ticket_dependencies_blocker_one_kind', 'ticket_dependencies_blocked_one_kind')
      and contype = 'c'),
  'ticket_dependencies_one_kind: both endpoint one-kind checks are still declared');

-- --- the push-state vocabulary, and the trigger that makes pushed terminal ----------
select pg_temp.must_hold(
  (select contype = 'c' from pg_constraint
    where conrelid = 'ouroboros.ticket_drafts'::regclass
      and conname = 'ticket_drafts_push_state'),
  'ticket_drafts_push_state: the push-state vocabulary is still declared');

-- Enabled, not merely present: a disabled trigger is still a row in pg_trigger, and it is the one
-- rule standing between a pushed draft and a second push.
select pg_temp.must_hold(
  (select count(*) = 1 from pg_trigger
    where tgrelid = 'ouroboros.ticket_drafts'::regclass
      and tgname = 'ticket_drafts_push_state_transition'
      and tgfoid = 'ouroboros.ticket_draft_push_state_transition()'::regprocedure
      and tgenabled = 'O'),
  'ticket_drafts_push_state_transition: pushed cannot revert to pending — the trigger is armed');

-- --- the month range -------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 2 from pg_constraint
    where conrelid = 'ouroboros.planning_epics'::regclass
      and conname in ('planning_epics_months_ordered', 'planning_epics_months_paired')
      and contype = 'c'),
  'planning_epics_months_ordered and _paired: both month-range rules are still declared');

-- --- the two lane vocabularies ---------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 2 from pg_constraint
    where conrelid = 'ouroboros.planning_epics'::regclass
      and conname in ('planning_epics_tint', 'planning_epics_status')
      and contype = 'c'),
  'planning_epics_tint and _status: both lane vocabularies are still closed');

-- --- the local key, on the columns that make it per batch ---------------------------
--
-- By columns and in order, because a key on local_key alone would still be called this and would
-- refuse the second batch's OTA-1 — the ordinary case.
select pg_temp.must_hold(
  (select array_agg(a.attname::text order by k.ord) = array['batch_id', 'local_key']
     from pg_constraint c
     join unnest(c.conkey) with ordinality as k(attnum, ord) on true
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.conrelid = 'ouroboros.ticket_drafts'::regclass
      and c.conname = 'ticket_drafts_batch_local_key_key'
      and c.contype = 'u'),
  'ticket_drafts_batch_local_key_key: one local key per batch, keyed on (batch_id, local_key)');
