-- analyzer-corpus.sql — the change-point analyzer's corpus, read out of a seeded database as the
-- engine's `Corpus` JSON (#509, BU.4).
--
-- #509's deepest acceptance criterion is that BV.2's change-point analyzer, run over the seeded
-- rows, *rediscovers* the three duration shifts R__dev_seed_workspace_metrics_analyzer.sql plants
-- — rather than the page reading findings somebody typed in. tests/verify-analyzer-rediscovery.sh
-- runs this against the seeded database, hands the JSON to the engine's own analyzer, and
-- compares what it finds with the change-point findings the seed stored.
--
-- So this file is the corpus reader's **read shape** for the one analyzer that exists, written
-- down where a test holds it. BV.1 (#510) owns corpus assembly; until it lands this is the
-- statement of what its reader has to produce for `change_point`, and when it lands the two must
-- agree or this test says so.
--
-- The window is the latest complete analysis run's: its manifest's `window.from` … `window.to`,
-- UTC days, for acme-robotics/helios-firmware.
--
-- builds   — every `zephyr build` of the repository that **succeeded** and finished inside the
--            window: `{build_id, day, duration_seconds}`, day being the finish's UTC date. The
--            duration series is the firmware build's; a test platform's run (native_sim,
--            qemu_cortex_m3, the HIL rig) is a different job with a different length, and a
--            failed build measures how far it got rather than how long a build takes.
-- events   — the candidate causes attribution ranks, each `{kind, day, label, ref}`:
--   merge          a commit first built on the default branch inside the window; its day is that
--                  first build's queue day, its label that build's title, its ref the sha.
--   policy_version a published version of one of the workspace's workflows; ref workflow_version.
--   infra_event    a runner enrolled (ref runner), a pool's builds starting to run a new image
--                  (ref runner_pool), a time-windowed pool assignment created (ref runner_pool).
--
--   Not emitted: `config_version` and `env_recipe_version`. An attribution candidate must cite
--   evidence V081 can resolve, and V081 has no evidence kind for an env recipe or a config
--   version yet. The knowledge seed's recipe v3 (nine days ago) is therefore not a candidate here,
--   and the test says so rather than pretending it was ranked.
--
-- Usage (psql prints one line, the JSON):
--   psql … -X -A -t -v ON_ERROR_STOP=1 -f ouroboros-db/tests/lib/analyzer-corpus.sql

with run as (
  select r.organization_id, r.repo_ref,
         (r.corpus_manifest #>> '{window,from}')::date as day_from,
         (r.corpus_manifest #>> '{window,to}')::date   as day_to
    from ouroboros.analysis_runs r
    join ouroboros.organization org on org."id" = r.organization_id
   where org."slug" = 'acme-robotics'
     and r.repo_ref = 'acme-robotics/helios-firmware'
     and r.status = 'complete'
   order by r.started_at desc
   limit 1
),
jobs as (
  select job.*, (job.queued_at at time zone 'UTC')::date as queued_day,
         (job.finished_at at time zone 'UTC')::date as finished_day
    from run
    join ouroboros.github_orgs  gh   on gh.organization_id = run.organization_id
                                    and gh.login = split_part(run.repo_ref, '/', 1)
    join ouroboros.github_repos repo on repo.org_id = gh.id
                                    and repo.name = split_part(run.repo_ref, '/', 2)
    join ouroboros.build_jobs   job  on job.organization_id = run.organization_id
                                    and job.github_repo_id = repo.id
),
builds as (
  select jsonb_build_object('build_id', job.id::text,
                            'day', job.finished_day,
                            'duration_seconds',
                              extract(epoch from job.finished_at - job.started_at)::float8) as b
    from jobs job, run
   where job.label = 'zephyr build' and job.status = 'succeeded'
     and job.finished_day between run.day_from and run.day_to
),
first_builds as (
  select distinct on (job.commit_sha) job.commit_sha, job.queued_day, job.title
    from jobs job
   where job.git_ref = 'refs/heads/main' and job.commit_sha is not null
   order by job.commit_sha, job.queued_at, job.number
),
pool_images as (
  select pool.id as pool_id, pool.name, job.image, job.queued_at,
         lag(job.image) over (partition by pool.id order by job.queued_at, job.number) as previous
    from run
    join ouroboros.runner_pools pool on pool.organization_id = run.organization_id
    join ouroboros.build_jobs   job  on job.pool_id = pool.id
),
events as (
  select 'merge' as kind, f.queued_day as day, f.title as label,
         jsonb_build_object('kind', 'merge', 'id', f.commit_sha) as ref
    from first_builds f
  union all
  select 'policy_version', (v.published_at at time zone 'UTC')::date,
         w.slug || ' v' || v.version,
         jsonb_build_object('kind', 'workflow_version', 'id', v.id::text)
    from run
    join ouroboros.workflows w          on w.organization_id = run.organization_id
    join ouroboros.workflow_versions v  on v.workflow_id = w.id and v.version is not null
  union all
  select 'infra_event', (r.enrolled_at at time zone 'UTC')::date, r.name || ' enrolled',
         jsonb_build_object('kind', 'runner', 'id', r.id::text)
    from run
    join ouroboros.runners r on r.organization_id = run.organization_id
  union all
  select 'infra_event', (p.queued_at at time zone 'UTC')::date,
         p.name || ' image ' || regexp_replace(p.image, '^.*/', ''),
         jsonb_build_object('kind', 'runner_pool', 'id', p.pool_id::text)
    from pool_images p
   where p.previous is not null and p.image is distinct from p.previous
  union all
  select 'infra_event', (w.created_at at time zone 'UTC')::date,
         runner.name || ' assigned to ' || pool.name || ' '
           || to_char(w.starts_at, 'HH24:MI') || '–' || to_char(w.ends_at, 'HH24:MI'),
         jsonb_build_object('kind', 'runner_pool', 'id', pool.id::text)
    from run
    join ouroboros.runner_pool_windows w on w.organization_id = run.organization_id
    join ouroboros.runners runner        on runner.id = w.runner_id
    join ouroboros.runner_pools pool     on pool.id = w.pool_id
)
select jsonb_build_object(
         'repo_ref', run.repo_ref,
         'window', jsonb_build_object('from', run.day_from, 'to', run.day_to),
         'builds', coalesce((select jsonb_agg(b order by b ->> 'build_id') from builds), '[]'),
         'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'day', e.day,
                                                                 'label', e.label, 'ref', e.ref)
                                              order by e.day, e.kind, e.label)
                               from events e, run r2
                              where e.day between r2.day_from and r2.day_to), '[]'))
  from run;
