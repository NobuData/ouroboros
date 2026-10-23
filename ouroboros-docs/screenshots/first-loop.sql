-- The first loop, live (BD.1, #396) — the state `user-guide.first-loop.timeline` and
-- `user-guide.first-loop.review` are captured in.
--
-- **Throwaway stacks only.** Apply it to the isolated seeded stack (a freshly seeded
-- `postgres:17-alpine`, never a database anybody keeps) before capturing those two ids:
--
--   PGPASSWORD=… psql -h localhost -p <port> -U ouroboros -d ouroboros -f screenshots/first-loop.sql
--
-- The dev seed draws mockup 13's wizard at step 3, before any loop: the `acme-onboarding`
-- workspace has picked `quick-fixes` and #488 and run nothing. A first loop cannot be produced
-- by the seed — it needs live execution — so this does by hand what the product does on a
-- deployment that runs loops:
--
--   1. instantiates `quick-fixes` from its shipped template, as step 3's tile does;
--   2. opens #488's first run, twenty minutes ago, its stages taken from that definition — the
--      first model stage finished at 1:04, the rest by 3:00, the run now `review`;
--   3. links the draft pull request it opened at 3:11, as DI.3's publisher does.
--
-- Idempotent: every row is keyed, and a second application changes nothing.

begin;

-- 1. The workflow `quick-fixes`, v1, from the newest shipped template.
insert into ouroboros.workflows (id, organization_id, slug, name, status, template_slug, template_version)
select '5eed00d1-0000-4000-8000-000000000488'::uuid, org."id", 'quick-fixes', template.name, 'active',
       template.slug, template.version
  from ouroboros.organization org
  join lateral (select * from ouroboros.workflow_templates t
                 where t.slug = 'quick-fixes' and t.organization_id is null
                 order by t.version desc limit 1) template on true
 where org."slug" = 'acme-onboarding'
on conflict do nothing;

insert into ouroboros.workflow_versions (id, workflow_id, version, definition, published_at)
select '5eed00d2-0000-4000-8000-000000000488'::uuid, wf.id, 1, template.definition, now()
  from ouroboros.workflows wf
  join lateral (select * from ouroboros.workflow_templates t
                 where t.slug = 'quick-fixes' and t.organization_id is null
                 order by t.version desc limit 1) template on true
 where wf.id = '5eed00d1-0000-4000-8000-000000000488'
on conflict do nothing;

update ouroboros.workflows set current_version = 1
 where id = '5eed00d1-0000-4000-8000-000000000488' and current_version is null;

-- 2. #488's first run.
insert into ouroboros.runs (id, organization_id, github_repo_id, issue_number, issue_title,
                            workflow_tag, model, status, stage_label, stage_index, stage_total,
                            started_at, branch_name, workflow_version_pin)
select '5eed00d3-0000-4000-8000-000000000488'::uuid, org."id", repo.id, 488, issue.title,
       'quick-fixes', 'coder-std', 'review', 'Open PR', 3, 3,
       now() - interval '20 minutes', 'loop/488-typo-sweep', 1
  from ouroboros.organization org
  join ouroboros.github_orgs gho on gho.organization_id = org."id"
  join ouroboros.github_repos repo on repo.org_id = gho.id and repo.name = 'helios-firmware'
  join ouroboros.github_issues issue on issue.github_repo_id = repo.id and issue.number = 488
 where org."slug" = 'acme-onboarding'
on conflict do nothing;

-- Its stages, one per non-trigger node in document order: the first model stage done at 1:04,
-- each after it a minute apart, all succeeded.
insert into ouroboros.run_stages (id, run_id, stage_key, stage_label, position, attempt, status,
                                  started_at, finished_at)
select ('5eed00d4-0000-4000-8000-000000000' || lpad(node.position::text, 3, '0'))::uuid,
       run.id, node.value ->> 'id', node.value ->> 'title', node.position, 1, 'succeeded',
       run.started_at + make_interval(secs => case when node.position = 1 then 2 else 4 + 60 * (node.position - 1) end),
       run.started_at + make_interval(secs => case when node.position = 1 then 64 else 64 + 60 * (node.position - 1) end)
  from ouroboros.runs run
  join ouroboros.workflow_versions version on version.id = '5eed00d2-0000-4000-8000-000000000488'
  cross join lateral (
    select value, row_number() over () as position
      from jsonb_array_elements(version.definition -> 'nodes') value
     where value ->> 'type' <> 'trigger'
  ) node
 where run.id = '5eed00d3-0000-4000-8000-000000000488'
   and node.position <= 3
on conflict do nothing;

-- 3. The draft pull request it opened at 3:11.
insert into ouroboros.pull_requests (id, organization_id, source_id, external_number, external_url,
                                     title, head_branch, base_branch, state, draft, run_id,
                                     ticket_id, created_at)
select '5eed00d5-0000-4000-8000-000000000488'::uuid, org."id", ticket.source_id, 1488,
       'https://github.com/acme-robotics/helios-firmware/pull/1488',
       'docs: typo sweep in operator manual and pairing guide', run.branch_name, 'main', 'open',
       true, run.id, ticket.id, run.started_at + interval '191 seconds'
  from ouroboros.organization org
  join ouroboros.runs run on run.id = '5eed00d3-0000-4000-8000-000000000488'
  join ouroboros.tickets ticket on ticket.organization_id = org."id" and ticket.external_key = '#488'
 where org."slug" = 'acme-onboarding'
on conflict do nothing;

commit;
