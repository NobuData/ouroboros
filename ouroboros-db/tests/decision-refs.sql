-- decision-refs.sql — BM.1's (#457) typed refs, asked of the seeded universe.
--
-- tests/constraints.sql proves the decision refs against fixtures it builds. This asks the
-- acceptance criterion as written — *"typed refs resolve against runs, PRs, tickets and paths in
-- the seeded universe"* — of the rows the dev seeds already hold: loop #1847, PR #514 and the
-- canonical #482 of `acme-robotics` (#68, #302, #356), and a file that loop changed. Each ref is
-- looked up by its natural key, never by a seeded uuid, so the suite says what it means.
--
-- Run it against a database migrated **with the seed enabled**:
--
--   PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros \
--     -v ON_ERROR_STOP=1 -f ouroboros-db/tests/decision-refs.sql
--
-- It files items inside a transaction and rolls it back, so the database is left as it was found;
-- `ci/db` re-runs seed.sql afterwards to say so.

\set ON_ERROR_STOP on

\o /dev/null

begin;

\ir lib/assert.sql

-- The seeded universe, by natural key.
create temporary table v093_universe as
select o."id"  as organization_id,
       r.id    as run_id,
       p.id    as pr_id,
       t.id    as ticket_id,
       f.path  as path
  from ouroboros.organization o
  join ouroboros.runs r          on r.organization_id = o."id" and r.loop_seq = 1847
  join ouroboros.pull_requests p on p.organization_id = o."id" and p.external_number = 514
  join ouroboros.tickets t       on t.id = p.ticket_id and t.external_key = '#482'
  join ouroboros.run_files f     on f.run_id = r.id and f.path = 'drivers/can/telemetry_buf.c'
 where o.slug = 'acme-robotics';

select pg_temp.must_hold(
  (select count(*) = 1 from v093_universe),
  'the seeded universe holds loop #1847, PR #514, canonical #482 and drivers/can/telemetry_buf.c in acme-robotics');

-- --- each ref type resolves in its own workspace -----------------------------------------
select pg_temp.must_hold(
  (select ouroboros.decision_ref_resolves(organization_id,
            jsonb_build_object('type', 'run', 'id', run_id::text, 'label', 'loop #1847'))
      and ouroboros.decision_ref_resolves(organization_id,
            jsonb_build_object('type', 'pr', 'id', pr_id::text, 'label', 'PR #514'))
      and ouroboros.decision_ref_resolves(organization_id,
            jsonb_build_object('type', 'ticket', 'id', ticket_id::text, 'label', 'issue #482'))
      and ouroboros.decision_ref_resolves(organization_id,
            jsonb_build_object('type', 'path', 'id', path, 'label', path))
     from v093_universe),
  'a run, a PR, a ticket and a path ref each resolve against the seeded rows of acme-robotics');

select pg_temp.must_hold(
  (select not ouroboros.decision_ref_resolves(o."id",
            jsonb_build_object('type', 'pr', 'id', u.pr_id::text, 'label', 'PR #514'))
      and not ouroboros.decision_ref_resolves(o."id",
            jsonb_build_object('type', 'run', 'id', u.run_id::text, 'label', 'loop #1847'))
      and not ouroboros.decision_ref_resolves(o."id",
            jsonb_build_object('type', 'ticket', 'id', u.ticket_id::text, 'label', 'issue #482'))
     from v093_universe u, ouroboros.organization o
    where o.slug = 'acme-labs'),
  'and none of them resolves from another seeded workspace');

-- --- items filed against them ---------------------------------------------------------
select ouroboros.decision_item_emit(
         organization_id, 'claim_waiver',
         '{"claim": "Flake must not reappear across temperature range",
           "missing_capability": "thermal chamber"}',
         jsonb_build_array(
           jsonb_build_object('type', 'pr',     'id', pr_id::text,     'label', 'PR #514'),
           jsonb_build_object('type', 'run',    'id', run_id::text,    'label', 'loop #1847'),
           jsonb_build_object('type', 'ticket', 'id', ticket_id::text, 'label', 'issue #482')),
         'pr.gates', 'decision-refs:claim')
  from v093_universe;

select ouroboros.decision_item_emit(
         organization_id, 'protected_path_allow_once',
         jsonb_build_object('subject', 'The CAN-bus flake fix', 'edit_summary', 'add one line',
                            'path', path, 'diff_lines', 3),
         jsonb_build_array(
           jsonb_build_object('type', 'run',  'id', run_id::text, 'label', 'loop #1847'),
           jsonb_build_object('type', 'path', 'id', path,         'label', path)),
         'guardrails', 'decision-refs:path')
  from v093_universe;

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.decision_items i, v093_universe u
    where i.organization_id = u.organization_id and i.source_ref like 'decision-refs:%'),
  'a claim waiver and an allow-once file against the seeded refs');

select pg_temp.must_hold(
  (select why = '“Flake must not reappear across temperature range” — the rig has no thermal chamber. Waiving annotates the PR publicly.'
     from ouroboros.decision_items_rendered r
     join ouroboros.decision_items i on i.id = r.id
    where i.source_ref = 'decision-refs:claim'),
  'and render from their facts over the seeded universe');

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.decision_items i, v093_universe u
    where i.refs @> jsonb_build_array(jsonb_build_object('type', 'run', 'id', u.run_id::text))
      and i.source_ref like 'decision-refs:%'),
  'reverse lookup from loop #1847 finds both');

select pg_temp.must_reject(
  $$select ouroboros.decision_item_emit(
            o."id", 'claim_waiver',
            '{"claim": "Flake must not reappear across temperature range", "missing_capability": "thermal chamber"}',
            jsonb_build_array(jsonb_build_object('type', 'pr', 'id', u.pr_id::text, 'label', 'PR #514')),
            'pr.gates', 'decision-refs:foreign')
       from v093_universe u, ouroboros.organization o
      where o.slug = 'acme-labs'$$,
  'acme-labs cannot file a card linking acme-robotics'' PR #514', 'decision_items_refs_resolve');

rollback;

\o
\echo 'decision-refs.sql: all assertions passed'
