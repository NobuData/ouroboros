-- stored-policy-documents.sql — every stored org-policy version, printed as the JSON document
-- scripts/org-policy-schema.mjs validates (#480, BQ.1).
--
-- The read half of ci/db's policy schema check. It prints one JSON array — an entry per
-- org_policy_versions row, `{"organization", "version", "document"}`, the organization named by
-- its slug — and nothing else, so its output can be redirected straight into the verb:
--
--   psql ... -d <seeded database> -f ouroboros-db/tests/lib/stored-policy-documents.sql > policies.json
--   ouroboros-db/scripts/org-policy-schema.mjs policies.json
--
-- **Every row, not only the seed's.** A version is immutable, so a stored document the schema
-- refuses can never be corrected — only outlived — and that is worth knowing about any row.
--
-- It lives in lib/ because it is not a suite: it asserts nothing and writes nothing.

\set ON_ERROR_STOP on
-- Quiet before the two \pset lines, which otherwise announce themselves on stdout.
\set QUIET on
\pset format unaligned
\pset tuples_only on

select coalesce(
         json_agg(json_build_object('organization', org."slug",
                                    'version',      v.version,
                                    'document',     v.document)
                  order by org."slug", v.version),
         '[]'::json)
  from ouroboros.org_policy_versions v
  join ouroboros.organization org on org."id" = v.organization_id;
