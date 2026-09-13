-- seeded-definitions.sql — every seeded workflow definition, printed as the JSON document
-- scripts/workflow-dsl-drift.mjs validates (#137, P.6).
--
-- The read half of ci/db's schema drift check. It prints one JSON array — an entry per stored
-- version R__dev_seed_workflows.sql wrote, `{"workflow", "version", "definition"}` — and
-- nothing else, so its output can be redirected straight into the verb:
--
--   psql ... -d <seeded database> -f ouroboros-db/tests/lib/seeded-definitions.sql > seeded.json
--   ouroboros-db/scripts/workflow-dsl-drift.mjs seeded.json
--
-- **Scoped to the seed's own ids**, `5eed001c...`, as tests/seed.sql scopes its counts. A
-- developer's database also holds whatever the studio has written there, and an empty `{}`
-- draft is a legal row (V029) that no grammar accepts. What this answers is whether the
-- *seeds* still speak the language, so a row the seed did not write is not its business.
--
-- The rows come out of the database rather than out of the migration's text because that is
-- the only place v2–v13 of `standard-fix` exist: they are a `jsonb_set` over one literal, and
-- no parse of the file sees them.
--
-- Ordered by workflow and then version, drafts last, so the verb's transcript reads like the
-- studio's history list and a failure is easy to find in it.
--
-- It lives in lib/ because it is not a suite: it asserts nothing, and an empty result is the
-- verb's to refuse. It writes nothing either, so it is safe against any database.

\set ON_ERROR_STOP on
-- Quiet before the two \pset lines, which otherwise announce themselves on stdout and put
-- prose in front of the JSON.
\set QUIET on
\pset format unaligned
\pset tuples_only on

select coalesce(
         json_agg(json_build_object('workflow',   org."slug" || '/' || wf.slug,
                                    'version',    v.version,
                                    'definition', v.definition)
                  order by org."slug", wf.slug, v.version nulls last),
         '[]'::json)
  from ouroboros.workflow_versions v
  join ouroboros.workflows wf on wf.id = v.workflow_id
  join ouroboros.organization org on org."id" = wf.organization_id
 where v.id::text like '5eed001c-%';
