-- seeded-definitions.sql — every seeded workflow definition, printed as the JSON document
-- scripts/workflow-dsl-drift.mjs validates (#137, P.6).
--
-- The read half of ci/db's schema drift check. It prints one JSON array — an entry per stored
-- version R__dev_seed_workflows.sql wrote, one for the live-slice workspace's published
-- workflow and its own tile (R__dev_seed_live_slice.sql, #1314), and one per shipped template
-- version (V068), `{"workflow", "version", "definition"}` — and
-- nothing else, so its output can be redirected straight into the verb:
--
--   psql ... -d <seeded database> -f ouroboros-db/tests/lib/seeded-definitions.sql > seeded.json
--   ouroboros-db/scripts/workflow-dsl-drift.mjs seeded.json
--
-- **Scoped to the seeds' own ids**, `5eed001c...` and `5eed00ac...`, as tests/seed.sql scopes
-- its counts. A
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

--
-- **And every shipped workflow template** (#381, BA.2), labelled `template/<slug>`. Those are
-- V068's global rows (`organization_id` null), so they are in every migrated database, seeded
-- or not, and none of them is a draft. An organization's own override is its data, not the
-- product's, and is left out for the same reason a studio-written row is — except the one the
-- live-slice seed writes (#1314), which is scoped by its own id below.
select coalesce(
         json_agg(json_build_object('workflow',   d.workflow,
                                    'version',    d.version,
                                    'definition', d.definition)
                  order by d.workflow, d.version nulls last),
         '[]'::json)
  from (select org."slug" || '/' || wf.slug as workflow, v.version, v.definition
          from ouroboros.workflow_versions v
          join ouroboros.workflows wf on wf.id = v.workflow_id
          join ouroboros.organization org on org."id" = wf.organization_id
         where v.id::text like '5eed001c-%'
        -- DI.5 (#1314): the live-slice workspace's one published workflow — the slice the
        -- acceptance leg runs, held to the same grammar as the rail's five.
        union all
        select org."slug" || '/' || wf.slug, v.version, v.definition
          from ouroboros.workflow_versions v
          join ouroboros.workflows wf on wf.id = v.workflow_id
          join ouroboros.organization org on org."id" = wf.organization_id
         where v.id::text like '5eed00ac-%'
        -- CC.4 (#558): mockup 20's copilot draft, and that draft with each suggestion's
        -- proposed operations applied — what Apply would store must be a valid workflow too.
        union all
        select org."slug" || '/' || wf.slug, null, v.definition
          from ouroboros.workflow_versions v
          join ouroboros.workflows wf on wf.id = v.workflow_id
          join ouroboros.organization org on org."id" = wf.organization_id
         where wf.id::text like '5eed0089-%' and v.version is null
        union all
        select org."slug" || '/' || wf.slug || '+' || s.rule_id, null,
               ouroboros.dry_run_suggestion_preview(s.id)
          from ouroboros.dry_run_suggestions s
          join ouroboros.dry_runs r on r.id = s.dry_run_id
          join ouroboros.workflows wf on wf.id = r.workflow_id
          join ouroboros.organization org on org."id" = wf.organization_id
         where s.id::text like '5eed008c-%'
        union all
        select 'template/' || t.slug, t.version, t.definition
          from ouroboros.workflow_templates t
         where t.organization_id is null
        -- And the one seeded organization tile (#1314): the live-slice workspace's own, labelled
        -- `template/<workspace>/<slug>` — the seed's data, not a studio-written override.
        union all
        select 'template/' || org."slug" || '/' || t.slug, t.version, t.definition
          from ouroboros.workflow_templates t
          join ouroboros.organization org on org."id" = t.organization_id
         where t.id::text like '5eed00ad-%') as d;
