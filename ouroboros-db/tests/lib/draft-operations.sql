-- draft-operations.sql — every stored draft operation, as JSON, for scripts/draft-ops-parity.mjs
-- (#556, CC.2).
--
-- Prints one JSON array: `{"workflow": "<org slug>/<workflow slug>", "base_version",
-- "draft_rev", "seq", "op"}` per row of ouroboros.draft_operations, in replay order. It writes
-- nothing. ci/db pipes it into the parity check against the seeded database:
--
--   psql … -f tests/lib/draft-operations.sql > ops.json
--   ouroboros-db/scripts/draft-ops-parity.mjs ops.json

\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

-- CC.4 (#558) adds the operations a dry-run suggestion *proposes*: Apply will record them in this
-- same log, so they are held to the same schema before anyone presses it. Each is labelled with the
-- suggestion's rule and the draft revision it was computed against.
select coalesce(
         json_agg(json_build_object('workflow',     e.workflow,
                                    'base_version', e.base_version,
                                    'draft_rev',    e.draft_rev,
                                    'seq',          e.seq,
                                    'op',           e.op)
                  order by e.workflow, e.base_version nulls first, e.draft_rev, e.seq),
         '[]'::json)
  from (select org."slug" || '/' || wf.slug as workflow, o.base_version, o.draft_rev, o.seq, o.op
          from ouroboros.draft_operations o
          join ouroboros.workflows wf on wf.id = o.workflow_id
          join ouroboros.organization org on org."id" = o.organization_id
        union all
        select org."slug" || '/' || wf.slug || ' suggestion:' || coalesce(s.rule_id, 'llm'),
               r.base_version, r.draft_rev, x.seq::integer, x.op
          from ouroboros.dry_run_suggestions s
          join ouroboros.dry_runs r on r.id = s.dry_run_id
          join ouroboros.workflows wf on wf.id = r.workflow_id
          join ouroboros.organization org on org."id" = s.organization_id
          cross join lateral jsonb_array_elements(s.proposed_ops) with ordinality as x(op, seq)) e;
