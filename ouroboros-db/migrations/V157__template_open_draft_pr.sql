-- ===========================================================================
-- V157 — the shipped templates say "Open draft PR" (#1838, FE.5)
-- ===========================================================================
--
-- V068's *Quick fixes* and *Docs & chores* templates end at a node titled *Open PR &
-- auto-merge* whose description promises a merge once checks are green. RC1 only ever opens a
-- draft pull request, so the copy overpromised. This migration retitles the node and rewrites
-- its description; the auto-merge wording returns with #375 in RC2.
--
-- **The action id stays `open_pr_automerge`.** Published workflow versions, and the template
-- versions already instantiated from v1 and v2, store it; renaming it would orphan them. Only
-- the human-readable `title` and `description` change.
--
-- **Old versions still load.** workflow_templates is immutable (V068), so this inserts the next
-- version of each affected global template through the version trigger, as V156 did. A
-- workspace's published versions and an organization's template override are not touched.
--
-- To undo (forward only — for a rehearsal against a copy):
--   delete from workflow_templates where organization_id is null and version = 3;
-- ===========================================================================

insert into ouroboros.workflow_templates
    (organization_id, slug, version, name, description, stage_dots, effort_range, caption,
     definition, tier, unlock_rule, sort_order)
select null, latest.slug, latest.version + 1, latest.name, latest.description, latest.stage_dots,
       latest.effort_range, latest.caption,
       jsonb_set(latest.definition, '{nodes}',
                 (select jsonb_agg(case
                                     when node->'config'->>'action' = 'open_pr_automerge'
                                     then node || jsonb_build_object(
                                            'title', 'Open draft PR',
                                            'description',
                                            'Opens a draft pull request for you to review. Nothing merges until you say so.')
                                     else node
                                   end
                                   order by position)
                    from jsonb_array_elements(latest.definition->'nodes')
                           with ordinality as nodes(node, position))),
       latest.tier, latest.unlock_rule, latest.sort_order
  from (select distinct on (slug) *
          from ouroboros.workflow_templates
         where organization_id is null
         order by slug, version desc) latest
 where jsonb_path_exists(latest.definition,
                         '$.nodes[*] ? (@.config.action == "open_pr_automerge")');
