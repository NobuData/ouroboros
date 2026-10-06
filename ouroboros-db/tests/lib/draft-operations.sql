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

select coalesce(
         json_agg(json_build_object('workflow',     org."slug" || '/' || wf.slug,
                                    'base_version', o.base_version,
                                    'draft_rev',    o.draft_rev,
                                    'seq',          o.seq,
                                    'op',           o.op)
                  order by org."slug", wf.slug, o.base_version nulls first, o.draft_rev, o.seq),
         '[]'::json)
  from ouroboros.draft_operations o
  join ouroboros.workflows wf on wf.id = o.workflow_id
  join ouroboros.organization org on org."id" = o.organization_id;
